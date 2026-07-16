import { STATES } from './classify.js';

/**
 * Pure function: given the previous and new state of an offer, decide which
 * events should be emitted. Returns an array of event descriptors
 * { type, fromState, toState, price?, currency?, message? }.
 *
 * Only meaningful transitions produce events; repeated identical states never
 * do. Transitions into `unknown` are intentionally ignored to avoid noise
 * from pages that temporarily fail to expose availability.
 */
export function computeOfferEvents({
  prevOffer,
  productCreated,
  offerCreated,
  newState,
  price,
  currency,
  priceChanged,
  title,
}) {
  const events = [];
  const fromState = prevOffer ? prevOffer.availability : null;

  if (productCreated) {
    events.push({ type: 'product_discovered', fromState: null, toState: newState,
      price, currency, message: `Discovered: ${title || ''}`.trim() });
  }

  if (offerCreated) {
    // A brand-new offer for an already-known product (e.g. a second store).
    if (!productCreated) {
      const t = firstSightEvent(newState);
      if (t) events.push({ type: t, fromState: null, toState: newState, price, currency });
    }
    // Do not also emit transition events for a just-created offer.
    return events;
  }

  if (fromState && fromState !== newState) {
    const t = transitionEvent(fromState, newState);
    if (t) events.push({ type: t, fromState, toState: newState, price, currency });
  }

  if (priceChanged && (newState === STATES.IN_STOCK || newState === STATES.PREORDER)) {
    events.push({ type: 'price_change', fromState, toState: newState, price, currency,
      message: `Price now ${price ?? '?'} ${currency ?? ''}`.trim() });
  }

  return events;
}

function firstSightEvent(state) {
  switch (state) {
    case STATES.IN_STOCK: return 'became_available';
    case STATES.PREORDER: return 'preorder_open';
    case STATES.COMING_SOON: return 'coming_soon';
    default: return null;
  }
}

function transitionEvent(from, to) {
  if (to === STATES.IN_STOCK) {
    if (from === STATES.OUT_OF_STOCK || from === STATES.UNKNOWN || from === STATES.DISCOVERED) {
      return 'back_in_stock';
    }
    return 'became_available'; // from coming_soon / preorder
  }
  if (to === STATES.PREORDER) return 'preorder_open';
  if (to === STATES.COMING_SOON) return 'coming_soon';
  if (to === STATES.OUT_OF_STOCK) {
    if (from === STATES.IN_STOCK || from === STATES.PREORDER) return 'out_of_stock';
  }
  return null; // ignore transitions into unknown, etc.
}
