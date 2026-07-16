import { BaseConnector } from './base.js';
import { parseProductPage } from './parse.js';
import { fetchText } from '../net/http.js';
import { fetchPublicText } from '../net/public-http.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Generic connector for public product pages exposing JSON-LD (with optional
 * CSS-selector fallback). Configured entirely from the sources file:
 *
 * {
 *   "key": "example",
 *   "name": "Example Store",
 *   "connector": "jsonld",
 *   "config": {
 *     "pages": ["https://store.example/products/beyblade-bx-38"],
 *     "selectors": { "title": "h1", "price": ".price", "buyButton": "button.add-to-cart" }
 *   }
 * }
 */
export class JsonLdConnector extends BaseConnector {
  async fetchListings() {
    const cfg = this.config || {};
    const pages = cfg.pages || (cfg.url ? [cfg.url] : []);
    const selectors = cfg.selectors || {};
    const listings = [];
    for (const page of pages) {
      const fetcher = this.source.managed_by === 'ui' ? fetchPublicText : fetchText;
      const { body, url } = await fetcher(page, {
        ...this.deps.http,
        ...(cfg.http || {}),
      });
      const listing = parseProductPage(body, { url, selectors });
      // Persist raw HTML only in debug mode or when parsing failed to extract
      // anything useful, so failures can be diagnosed later.
      const parseFailed = !listing || (!listing.title && listing.price == null && !listing.availabilityRaw && !listing.availabilityText);
      if (this.deps.debug?.saveHtml || parseFailed) this.#saveDebug(page, body, parseFailed);
      if (listing) listings.push(listing);
    }
    return listings;
  }

  #saveDebug(page, body, parseFailed = false) {
    try {
      const dir = this.deps.debug?.dir || 'runtime/debug';
      mkdirSync(dir, { recursive: true });
      const tag = parseFailed ? 'PARSEFAIL' : 'debug';
      const safe = page.replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
      writeFileSync(join(dir, `${Date.now()}_${tag}_${safe}.html`), body);
    } catch { /* debug best-effort */ }
  }
}
