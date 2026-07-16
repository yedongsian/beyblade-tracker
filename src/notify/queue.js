import { logger } from '../util/logger.js';
import { STATES } from '../core/classify.js';

const now = () => new Date().toISOString();

const TYPE_LABEL = {
  product_discovered: '🆕 New product',
  became_available: '✅ Available',
  back_in_stock: '🔁 Back in stock',
  preorder_open: '📦 Pre-order open',
  coming_soon: '🔜 Coming soon',
  out_of_stock: '⛔ Out of stock',
  price_change: '💲 Price change',
};

// Ordering weight: in-stock offers first.
function stateRank(state) {
  if (state === STATES.IN_STOCK) return 0;
  if (state === STATES.PREORDER) return 1;
  if (state === STATES.COMING_SOON) return 2;
  return 3;
}

function buildSummary(db, productId, events) {
  const product = db.get('SELECT * FROM products WHERE id = ?', [productId]);
  const enriched = events.map((e) => {
    const offer = e.offer_id ? db.get('SELECT * FROM offers WHERE id = ?', [e.offer_id]) : null;
    const source = e.source_id ? db.get('SELECT * FROM sources WHERE id = ?', [e.source_id]) : null;
    return { event: e, offer, source };
  });

  // Sort: in-stock first, then by price asc, then by source name.
  enriched.sort((a, b) => {
    const ra = stateRank(a.event.to_state);
    const rb = stateRank(b.event.to_state);
    if (ra !== rb) return ra - rb;
    const pa = Number.isFinite(a.offer?.price) ? a.offer.price : Infinity;
    const pb = Number.isFinite(b.offer?.price) ? b.offer.price : Infinity;
    if (pa !== pb) return pa - pb;
    return (a.source?.name || '').localeCompare(b.source?.name || '');
  });

  const lines = enriched.map(({ event, offer, source }) => {
    const label = TYPE_LABEL[event.type] || event.type;
    const store = source?.name || 'unknown store';
    const price = Number.isFinite(offer?.price) ? ` — ${offer.price} ${offer.currency || ''}`.trimEnd() : '';
    const url = offer?.url ? `\n    ${offer.url}` : '';
    return `  ${label} @ ${store}${price}${url}`;
  });

  const title = `${product?.name || 'Product'}${product?.model ? ` (${product.model})` : ''}`;
  const body = lines.join('\n');
  return { product, title, body };
}

/**
 * Aggregate pending events into per-product summaries and dispatch them to
 * every configured notifier. Events are grouped so multiple stores collapse
 * into one message. Idempotent per (channel, dedup_key).
 */
export async function flushNotifications(db, notifiers, { dryRun = false } = {}) {
  const allPending = db.all('SELECT * FROM events WHERE notified = 0 ORDER BY created_at ASC, id ASC');
  const stale = [];
  const pending = allPending.filter((event) => {
    if (!event.offer_id || !['in_stock', 'preorder'].includes(event.to_state)) return true;
    const offer = db.get('SELECT freshness_status,archived_at FROM offers WHERE id=?', [event.offer_id]);
    if (!offer || (!offer.archived_at && !['stale', 'archived'].includes(offer.freshness_status))) return true;
    stale.push(event.id);
    return false;
  });
  if (stale.length) {
    db.run(`UPDATE events SET notified=1 WHERE id IN (${stale.map(() => '?').join(',')})`, stale);
  }
  if (pending.length === 0) {
    return { groups: 0, sent: 0, skipped: 0, failed: 0, staleSuppressed: stale.length };
  }

  const byProduct = new Map();
  for (const e of pending) {
    if (!byProduct.has(e.product_id)) byProduct.set(e.product_id, []);
    byProduct.get(e.product_id).push(e);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const [productId, events] of byProduct) {
    const { title, body } = buildSummary(db, productId, events);
    const ids = events.map((e) => e.id).sort((a, b) => a - b);
    const dedupKey = `${productId}:${ids.join(',')}`;

    // Events are only marked notified once every *configured* channel has
    // delivered them. A failed configured channel keeps the events pending so
    // a later flush retries just that channel; already-sent channels are
    // skipped by their existing 'sent' row and never resend. Unconfigured
    // channels and a dry run never mark events as delivered, but a failing
    // configured channel is the only thing that blocks completion for retry.
    let blockCompletion = false;

    for (const notifier of notifiers) {
      if (!notifier.isConfigured()) {
        // Recorded for inspection but never blocks completion.
        upsertNotification(db, notifier.name, dedupKey, productId, ids, title, body, 'skipped', 'not configured');
        skipped += 1;
        continue;
      }

      const existing = db.get('SELECT status FROM notifications WHERE channel = ? AND dedup_key = ?', [notifier.name, dedupKey]);
      if (existing && existing.status === 'sent') {
        // Already delivered on a previous flush; do not resend.
        skipped += 1;
        continue;
      }

      if (dryRun) {
        // Preview only: do not send and do not consume the events.
        skipped += 1;
        blockCompletion = true;
        continue;
      }

      let result;
      try {
        result = await notifier.send({ title, body });
      } catch (err) {
        result = { status: 'failed', detail: `notifier threw: ${err.message}` };
      }
      upsertNotification(db, notifier.name, dedupKey, productId, ids, title, body, result.status, result.detail);
      if (result.status === 'sent') {
        sent += 1;
      } else if (result.status === 'failed') {
        failed += 1;
        blockCompletion = true; // retry this channel on a later flush
      } else {
        // A configured channel that self-skips is recorded but, unlike a
        // failure, does not block completion (avoids an unretryable loop).
        skipped += 1;
      }
    }

    if (!blockCompletion) {
      const placeholders = events.map(() => '?').join(',');
      db.run(`UPDATE events SET notified = 1 WHERE id IN (${placeholders})`, ids);
    }
  }

  return { groups: byProduct.size, sent, skipped, failed, staleSuppressed: stale.length };
}

// Insert a notification row, or update the existing (channel, dedup_key) row on
// retry. Updating in place lets a previously 'failed' row flip to 'sent'
// without violating the UNIQUE(channel, dedup_key) constraint.
function upsertNotification(db, channel, dedupKey, productId, ids, title, body, status, detail) {
  try {
    db.run(
      `INSERT INTO notifications (channel, dedup_key, product_id, event_ids, title, body, status, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel, dedup_key) DO UPDATE SET
         status = excluded.status,
         detail = excluded.detail,
         event_ids = excluded.event_ids,
         title = excluded.title,
         body = excluded.body`,
      [channel, dedupKey, productId, JSON.stringify(ids), title, body, status, detail || null, now()]
    );
  } catch (err) {
    logger.debug(`notification record skipped: ${err.message}`);
  }
}
