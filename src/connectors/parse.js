import * as cheerio from 'cheerio';

// Recursively collect objects of a given @type from a JSON-LD tree.
function collectByType(node, typeName, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectByType(item, typeName, acc);
    return acc;
  }
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.map((t) => String(t).toLowerCase()).includes(typeName.toLowerCase())) {
    acc.push(node);
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectByType(value, typeName, acc);
  }
  return acc;
}

export function extractJsonLd(html) {
  const $ = cheerio.load(html);
  const blocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || !raw.trim()) return;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Some sites embed multiple JSON objects or trailing commas; try a
      // lenient recovery by splitting on "}{" boundaries.
      const cleaned = raw.trim().replace(/^﻿/, '');
      try { blocks.push(JSON.parse(cleaned)); } catch { /* skip */ }
    }
  });
  return blocks;
}

function offerFrom(offerNode) {
  if (!offerNode) return {};
  // Handle AggregateOffer (lowOffer / offers) and single Offer.
  let node = offerNode;
  if (Array.isArray(node)) node = node[0];
  const type = String(node['@type'] || '').toLowerCase();
  if (type === 'aggregateoffer') {
    const inner = node.offers ? offerFrom(node.offers) : {};
    return {
      price: node.lowPrice ?? node.price ?? inner.price,
      currency: node.priceCurrency ?? inner.currency,
      availabilityRaw: node.availability ?? inner.availabilityRaw,
    };
  }
  return {
    price: node.price ?? node.lowPrice,
    currency: node.priceCurrency,
    availabilityRaw: node.availability,
    url: node.url,
  };
}

/**
 * Count buy buttons that are actually actionable. A button is treated as a
 * purchasable signal only when it is enabled: `disabled` and
 * `aria-disabled="true"` markers are excluded so a greyed-out "Sold out"
 * button never looks like an in-stock signal.
 */
export function enabledBuyButtonCount($, selector) {
  if (!selector) return 0;
  let count = 0;
  $(selector).each((_, el) => {
    const $el = $(el);
    if ($el.is('[disabled]')) return;
    if (String($el.attr('aria-disabled') || '').trim().toLowerCase() === 'true') return;
    count += 1;
  });
  return count;
}

// Convenience wrapper for callers/tests that only have raw HTML.
export function hasEnabledBuyButton(html, selector) {
  if (!selector) return false;
  const $ = cheerio.load(html);
  return enabledBuyButtonCount($, selector) > 0;
}

/**
 * A parsed listing is only usable if the parser recovered at least one field
 * that identifies or prices the product. A row with only boilerplate is a
 * page-level parse failure, not a real product, and must never be handed to the
 * pipeline as if it were a valid listing.
 */
export function isUsableListing(listing) {
  if (!listing) return false;
  return Boolean(
    listing.title
    || listing.model
    || listing.sku
    || listing.barcode
    || listing.price != null
    || listing.priceText
    || listing.availabilityRaw
    || listing.availabilityText
  );
}

// Multilingual "site is down for maintenance" markers. Kept intentionally
// specific so an ordinary product page never trips them.
const MAINTENANCE_PATTERNS = /(?:under\s+maintenance|scheduled\s+maintenance|site\s+maintenance|we['’]?ll\s+be\s+back|temporarily\s+unavailable|service\s+temporarily\s+unavailable|service\s+unavailable|メンテナンス|ただいま[^。]{0,20}(?:メンテ|調整)|臨時休業|システム[^。]{0,10}(?:停止|メンテ)|系統維護|網站維護|服務維護|維護中|暫停(?:服務|營業)|施工中)/i;

/**
 * Detect a maintenance/temporarily-unavailable page from its visible text so a
 * transient outage is reported distinctly from a genuine parse failure.
 */
export function detectMaintenance(html) {
  if (!html) return false;
  const $ = cheerio.load(html);
  const title = $('title').text() || '';
  const heading = $('h1, h2').first().text() || '';
  const body = ($('body').text() || '').slice(0, 2000);
  return MAINTENANCE_PATTERNS.test(`${title} ${heading} ${body}`);
}

/**
 * Classify a fetched page's parse outcome so connectors can signal a page-level
 * result to the pipeline instead of pushing a bogus listing:
 *   'ok'          -> at least one usable product field was recovered
 *   'maintenance' -> nothing usable and the page reads as a maintenance notice
 *   'empty'       -> nothing usable (blocked, layout change, or truly empty)
 */
export function classifyParsedPage(html, listing) {
  if (isUsableListing(listing)) return 'ok';
  if (detectMaintenance(html)) return 'maintenance';
  return 'empty';
}

function firstString(v) {
  if (v == null) return undefined;
  if (Array.isArray(v)) return firstString(v[0]);
  if (typeof v === 'object') return v.name || v.url || undefined;
  return String(v);
}

/**
 * Parse a product page's HTML into a Listing using JSON-LD first, then CSS
 * selector fallbacks from the source config.
 *
 * selectors config shape:
 *   { title, price, currency, availabilityText, image, buyButton }
 */
export function parseProductPage(html, { url, selectors = {} } = {}) {
  const listing = { url, rawText: '' };

  const blocks = extractJsonLd(html);
  const products = [];
  for (const b of blocks) collectByType(b, 'Product', products);
  const product = products[0];

  if (product) {
    listing.title = firstString(product.name) || listing.title;
    listing.brand = firstString(product.brand);
    listing.image = firstString(product.image);
    listing.barcode = product.gtin13 || product.gtin || product.gtin12 || product.gtin14 || product.gtin8 || undefined;
    listing.sku = product.sku || product.mpn || undefined;
    listing.releaseDate = product.releaseDate || undefined;
    const off = offerFrom(product.offers);
    if (off.price != null) listing.price = off.price;
    if (off.currency) listing.currency = off.currency;
    if (off.availabilityRaw) listing.availabilityRaw = off.availabilityRaw;
    listing.rawSummary = {
      source: 'json-ld',
      name: listing.title,
      price: listing.price,
      currency: listing.currency,
      availability: listing.availabilityRaw,
    };
  }

  // CSS selector fallback for anything JSON-LD did not provide.
  const needFallback = !product || !listing.title || listing.price == null || !listing.availabilityRaw;
  if (needFallback && (selectors.title || selectors.price || selectors.availabilityText || selectors.buyButton)) {
    const $ = cheerio.load(html);
    const pick = (sel) => (sel ? $(sel).first().text().trim() : '');
    if (!listing.title && selectors.title) listing.title = pick(selectors.title) || listing.title;
    if (listing.price == null && selectors.price) {
      const t = pick(selectors.price);
      if (t) listing.price = t; // pipeline will normalize the string
    }
    if (!listing.currency && selectors.currency) listing.currency = pick(selectors.currency) || undefined;
    if (selectors.availabilityText) listing.availabilityText = pick(selectors.availabilityText) || listing.availabilityText;
    if (selectors.image && !listing.image) {
      listing.image = $(selectors.image).first().attr('src') || $(selectors.image).first().attr('content') || undefined;
    }
    if (selectors.buyButton) listing.hasBuyButton = enabledBuyButtonCount($, selectors.buyButton) > 0;
    if (!listing.rawSummary) {
      listing.rawSummary = { source: 'css', title: listing.title, price: listing.price };
    }
  }

  // A small text blob helps text-based classification/exclusion.
  if (product) {
    listing.rawText = [listing.title, product.description ? String(product.description).slice(0, 300) : '']
      .filter(Boolean).join(' ');
  } else {
    const $ = cheerio.load(html);
    listing.rawText = $('title').text().trim();
  }

  return listing;
}
