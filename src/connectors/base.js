/**
 * Connector interface.
 *
 * Every connector exposes:
 *   - type: string           unique connector type name
 *   - create(source, config, deps) -> connector instance
 *
 * A connector instance exposes:
 *   - async fetchListings() -> Listing[]
 *
 * A Listing is a plain object with the normalized-ish shape below. The
 * pipeline performs full normalization, so connectors may return raw-ish
 * values; missing fields are fine.
 *
 * Listing = {
 *   url: string,              // product/offer page url (required)
 *   title?: string,
 *   brand?: string,
 *   series?: string,
 *   model?: string,           // e.g. "BX-38" (pipeline will also try to infer)
 *   barcode?: string,         // gtin/ean/upc
 *   sku?: string,
 *   price?: number|string,
 *   currency?: string,
 *   availabilityRaw?: string, // schema.org ItemAvailability
 *   availabilityText?: string,
 *   hasBuyButton?: boolean,
 *   image?: string,
 *   releaseDate?: string,
 *   rawText?: string,         // small text blob for classification
 *   rawSummary?: object,      // tiny structured summary persisted with observation
 * }
 *
 * Connectors MUST NOT throw for a single bad item; instead skip it. They MAY
 * throw for a whole-source failure (network/parse) — the pipeline isolates
 * that so other sources keep running.
 */
export class BaseConnector {
  constructor(source, config = {}, deps = {}) {
    this.source = source;
    this.config = config;
    this.deps = deps;
    // Page-level parse outcomes accumulated during fetchListings(), read by the
    // pipeline for observability. A fresh connector is created per crawl, so
    // these counters describe exactly one crawl of this source.
    this.parseStats = { pages: 0, ok: 0, empty: 0, maintenance: 0, failed: 0 };
  }

  /**
   * Record one page-level parse outcome ('ok' | 'empty' | 'maintenance' |
   * 'failed'). Only 'ok' pages should be turned into listings; the rest signal a
   * page-level failure so no invalid result enters the crawl pipeline.
   */
  recordPageResult(status) {
    this.parseStats.pages += 1;
    if (status === 'ok') this.parseStats.ok += 1;
    else if (status === 'maintenance') this.parseStats.maintenance += 1;
    else if (status === 'failed') this.parseStats.failed += 1;
    else this.parseStats.empty += 1;
    return status;
  }

  // eslint-disable-next-line class-methods-use-this
  async fetchListings() {
    throw new Error('fetchListings() not implemented');
  }
}
