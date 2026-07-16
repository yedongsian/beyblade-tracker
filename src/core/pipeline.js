import { normalizeUrl, normalizeWhitespace, extractModel, normalizePrice } from './normalize.js';
import { computeAvailability, exclusionReason, isPurchasable, STATES } from './classify.js';
import { computeOfferEvents } from './events.js';
import {
  findOrCreateProduct, findOffer, insertOffer, updateOffer,
  insertObservation, createEvent,
} from './store.js';
import { logger } from '../util/logger.js';

function normalizeModel(listing) {
  if (listing.model) {
    const m = extractModel(listing.model) || String(listing.model).toUpperCase().trim();
    return m;
  }
  return extractModel(listing.title);
}

function priceIsSignificant(prev, next, threshold) {
  const a = Number.isFinite(prev) ? prev : null;
  const b = Number.isFinite(next) ? next : null;
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  if (a === b) return false;
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base > 0 && Math.abs(a - b) / base >= threshold;
}

/**
 * Process a single normalized-ish listing within a transaction-friendly
 * context. Returns a small result object for aggregation/reporting.
 */
export function processListing(db, source, rawListing, opts, crawlRunId = null) {
  const url = normalizeUrl(rawListing.url, source.url || rawListing.url);
  const title = normalizeWhitespace(rawListing.title);
  const model = normalizeModel({ ...rawListing, title });
  const { price, currency } = normalizePrice(rawListing.price, rawListing.currency);

  const listing = { ...rawListing, url, title, model, price, currency };

  const reason = exclusionReason(listing);
  if (reason) {
    logger.debug(`excluded (${reason}): ${title || url}`);
    return { excluded: true, reason };
  }

  const { state, confidence } = computeAvailability(listing);
  const purchasable = isPurchasable(state, opts);

  const { product, created: productCreated } = findOrCreateProduct(db, listing);

  const prevOffer = findOffer(db, source.id, url);
  let offer;
  let offerCreated = false;
  let stateChanged = false;
  let priceChanged = false;

  if (!prevOffer) {
    offer = insertOffer(db, {
      productId: product.id, sourceId: source.id, url, title,
      price, currency, availability: state, confidence, purchasable,
    });
    offerCreated = true;
  } else {
    stateChanged = prevOffer.availability !== state;
    priceChanged = priceIsSignificant(prevOffer.price, price, opts.priceChangeThreshold);
    offer = updateOffer(db, prevOffer.id, {
      title, price, currency, availability: state, confidence, purchasable,
      last_changed_at: prevOffer.last_changed_at,
    }, { changed: stateChanged });
  }

  insertObservation(db, {
    offerId: offer.id, crawlRunId, price, currency, availability: state, confidence,
    rawSummary: rawListing.rawSummary,
  });

  const descriptors = computeOfferEvents({
    prevOffer, productCreated, offerCreated, newState: state,
    price, currency, priceChanged, title,
  });

  const events = [];
  for (const d of descriptors) {
    const row = createEvent(db, {
      productId: product.id, offerId: offer.id, sourceId: source.id, ...d,
    }, { cooldownSeconds: opts.eventCooldownSeconds });
    if (row) events.push(row);
  }

  return {
    excluded: false, productId: product.id, offerId: offer.id,
    state, purchasable, stateChanged, priceChanged, events,
  };
}

/**
 * Run one crawl for a single source. Isolated: throwing connectors are caught
 * by the caller so other sources continue. Returns per-source stats.
 */
export async function crawlSource(db, source, connector, opts, crawlRunId) {
  const listings = await connector.fetchListings();
  const stats = { itemsSeen: 0, itemsExcluded: 0, eventsCreated: 0, events: [] };
  for (const raw of listings) {
    if (!raw || !raw.url) { logger.warn(`listing without url from ${source.key}, skipped`); continue; }
    stats.itemsSeen += 1;
    let result;
    try {
      result = processListing(db, source, raw, opts, crawlRunId);
    } catch (err) {
      // A single bad item must not abort the whole source.
      logger.warn(`failed to process item from ${source.key}: ${err.message}`);
      continue;
    }
    if (result.excluded) { stats.itemsExcluded += 1; continue; }
    stats.eventsCreated += result.events.length;
    stats.events.push(...result.events);
  }
  return stats;
}

export { STATES };
