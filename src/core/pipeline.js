import {
  detectTaxInclusion, extractModel, normalizePrice, normalizeReleaseDate, normalizeUrl,
  normalizeWhitespace,
} from './normalize.js';
import { computeAvailability, exclusionReason, isPurchasable, STATES } from './classify.js';
import { computeOfferEvents } from './events.js';
import {
  findOrCreateProduct, findOffer, insertOffer, updateOffer,
  insertObservation, createEvent, recordListingExclusion,
} from './store.js';
import { logger } from '../util/logger.js';
import { isUsableListing } from '../connectors/parse.js';
import {
  linkProductToCatalog, matchAvailabilityOverride, queueTerminologyReview,
} from './catalog.js';
import { evaluateWatchlistsForProduct } from './watchlist.js';
import { isExclusionAllowed } from './exclusion-review.js';

function normalizeModel(listing) {
  if (listing.model) {
    const m = extractModel(listing.model) || String(listing.model).toUpperCase().trim();
    return m;
  }
  return extractModel(listing.sku) || extractModel(listing.title);
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

function stableAvailability(prevOffer, observedState, confirmations) {
  if (!prevOffer || prevOffer.availability === observedState || confirmations <= 1) {
    return { state: observedState, candidate: null, candidateCount: 0 };
  }
  const candidateCount = prevOffer.availability_candidate === observedState
    ? Number(prevOffer.availability_candidate_count || 0) + 1 : 1;
  if (candidateCount >= confirmations) {
    return { state: observedState, candidate: null, candidateCount: 0 };
  }
  return { state: prevOffer.availability, candidate: observedState, candidateCount };
}

function isTerminalListing(listing) {
  return /(?:discontinued|販売終了|終売|廃番|已停產|已停售)/i.test(
    [listing.availabilityText, listing.availabilityRaw, listing.rawText].filter(Boolean).join(' ')
  );
}

/**
 * A parsed listing is only usable if the parser recovered at least one field
 * that identifies or prices a product. A row with only boilerplate (no title,
 * model, sku, or price) is a parser failure, not a real product.
 */
/**
 * Process a single normalized-ish listing within a transaction-friendly
 * context. Returns a small result object for aggregation/reporting.
 */
export function processListing(db, source, rawListing, opts, crawlRunId = null) {
  if (!rawListing || !rawListing.url) {
    return { invalid: true, reason: 'missing-url' };
  }
  const url = normalizeUrl(rawListing.url, source.url || rawListing.url);
  if (!url) {
    return { invalid: true, reason: 'missing-url' };
  }
  if (!isUsableListing(rawListing)) {
    return { invalid: true, reason: 'no-product-fields' };
  }
  const title = normalizeWhitespace(rawListing.title);
  const model = normalizeModel({ ...rawListing, title });
  const { price, currency } = normalizePrice(rawListing.price, rawListing.currency);

  const listing = {
    ...rawListing, url, title, model, price, currency,
    releaseDate: normalizeReleaseDate(rawListing.releaseDate) || undefined,
  };
  const priceTaxIncluded = rawListing.priceTaxIncluded ?? detectTaxInclusion(
    rawListing.price, rawListing.priceText, rawListing.rawText
  );

  const reason = isExclusionAllowed(db, source.id, url) ? null : exclusionReason(listing);
  if (reason) {
    recordListingExclusion(db, source.id, listing, reason, crawlRunId);
    logger.debug(`excluded (${reason}): ${title || url}`);
    return { excluded: true, reason };
  }

  const override = matchAvailabilityOverride(db, listing);
  const classified = override || computeAvailability(listing);
  const observedState = classified.state;
  const confidence = classified.confidence;
  const availabilityRawText = normalizeWhitespace(rawListing.availabilityText || rawListing.availabilityRaw);
  const availabilityLocale = classified.locale || null;

  if (observedState === STATES.UNKNOWN && rawListing.availabilityText) {
    queueTerminologyReview(db, {
      kind: 'availability', rawValue: rawListing.availabilityText,
      locale: availabilityLocale || undefined,
      context: { sourceId: Number(source.id), url, title },
    });
  }

  // An existing Offer is an explicit identity decision (including manual
  // split/merge), so it must win over automatic product matching on rescans.
  const prevOffer = findOffer(db, source.id, url);
  const existingProduct = prevOffer ? db.get('SELECT * FROM products WHERE id=?', [prevOffer.product_id]) : null;
  const matched = existingProduct ? { product: existingProduct, created: false } : findOrCreateProduct(db, listing);
  const { product, created: productCreated } = matched;
  const catalog = linkProductToCatalog(db, product, listing, source);

  const stable = stableAvailability(prevOffer, observedState, Number(opts.stabilityConfirmations || 1));
  const state = stable.state;
  const purchasable = isPurchasable(state, opts);
  let offer;
  let offerCreated = false;
  let stateChanged = false;
  let priceChanged = false;

  if (!prevOffer) {
    offer = insertOffer(db, {
      productId: product.id, sourceId: source.id, url, title,
      price, currency, availability: state, confidence, purchasable,
      availabilityRawText, availabilityLocale,
      priceTaxIncluded,
    });
    offerCreated = true;
  } else {
    stateChanged = prevOffer.availability !== state;
    priceChanged = priceIsSignificant(prevOffer.price, price, opts.priceChangeThreshold);
    offer = updateOffer(db, prevOffer.id, {
      title, price, currency, availability: state, confidence, purchasable,
      availabilityRawText, availabilityLocale,
      priceTaxIncluded,
      availabilityCandidate: stable.candidate,
      availabilityCandidateCount: stable.candidateCount,
      last_stable_at: prevOffer.last_stable_at,
      last_changed_at: prevOffer.last_changed_at,
    }, { changed: stateChanged });
  }

  insertObservation(db, {
    offerId: offer.id, crawlRunId, price, currency, availability: observedState, confidence,
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
  const watchlist = evaluateWatchlistsForProduct(db, {
    productId: product.id, catalogProductId: catalog?.id, offerId: offer.id,
    state, events, listing,
  });

  return {
    excluded: false, productId: product.id, offerId: offer.id,
    state, observedState, purchasable, stateChanged, priceChanged, events,
    terminal: isTerminalListing(rawListing), watchlist,
  };
}

/**
 * Run one crawl for a single source. Isolated: throwing connectors are caught
 * by the caller so other sources continue. Returns per-source stats.
 */
export async function crawlSource(db, source, connector, opts, crawlRunId) {
  const listings = await connector.fetchListings();
  const stats = {
    itemsParsed: 0, itemsSeen: 0, itemsInvalid: 0, itemsExcluded: 0,
    itemsFailed: 0, eventsCreated: 0, events: [],
    seenOfferIds: [], terminalOfferIds: [],
    // Page-level parse outcomes reported by the connector (null for connectors
    // that do not fetch pages, e.g. the offline fixture connector).
    parse: connector?.parseStats ? { ...connector.parseStats } : null,
  };
  for (const raw of listings) {
    // Count everything the parser handed us so callers can compare parsed vs.
    // invalid and flag a parser failure when too many rows are unusable.
    stats.itemsParsed += 1;
    let result;
    try {
      result = processListing(db, source, raw, opts, crawlRunId);
    } catch (err) {
      // A single bad item must not abort the whole source.
      stats.itemsFailed += 1;
      logger.warn(`failed to process item from ${source.key}: ${err.message}`);
      continue;
    }
    if (result.invalid) {
      // Missing URL or no meaningful product fields: never processed further.
      stats.itemsInvalid += 1;
      logger.warn(`invalid listing from ${source.key} (${result.reason}), skipped`);
      continue;
    }
    stats.itemsSeen += 1;
    if (result.excluded) { stats.itemsExcluded += 1; continue; }
    stats.eventsCreated += result.events.length;
    stats.events.push(...result.events);
    stats.seenOfferIds.push(result.offerId);
    if (result.terminal) stats.terminalOfferIds.push(result.offerId);
  }
  return stats;
}

export { STATES };
