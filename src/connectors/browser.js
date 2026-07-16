import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseConnector } from './base.js';
import { parseProductPage } from './parse.js';

/**
 * Browser-backed connector for public pages that reject ordinary HTTP clients
 * or require JavaScript rendering. It uses the locally installed Google Chrome
 * through playwright-core and does not attempt to bypass CAPTCHA/login checks.
 */
export class BrowserConnector extends BaseConnector {
  async fetchListings() {
    const cfg = this.config || {};
    const pages = cfg.pages || (cfg.url ? [cfg.url] : []);
    if (!pages.length) return [];

    const launch = {
      headless: cfg.headless !== false,
      channel: cfg.channel || 'chrome',
    };
    if (cfg.offscreen && cfg.headless === false) {
      launch.args = ['--window-position=-32000,-32000', '--window-size=900,700'];
    }
    if (cfg.executablePath) {
      launch.executablePath = cfg.executablePath;
      delete launch.channel;
    }

    const browser = await chromium.launch(launch);
    const listings = [];
    try {
      const context = await browser.newContext({ locale: cfg.locale || 'ja-JP' });
      for (const requestedUrl of pages) {
        const page = await context.newPage();
        try {
          const timeout = Number(cfg.timeoutMs || this.deps.http?.timeoutMs || 30000);
          await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout });
          if (cfg.waitForSelector) {
            await page.waitForSelector(cfg.waitForSelector, { state: 'attached', timeout });
          }
          const html = await page.content();
          const listing = parseProductPage(html, {
            url: page.url(),
            selectors: cfg.selectors || {},
          });
          const parseFailed = !listing || (
            !listing.title && listing.price == null &&
            !listing.availabilityRaw && !listing.availabilityText
          );
          if (this.deps.debug?.saveHtml || parseFailed) {
            this.#saveDebug(requestedUrl, html, parseFailed);
          }
          if (parseFailed) throw new Error(`browser page parsed no product data: ${requestedUrl}`);
          listings.push(listing);
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
    return listings;
  }

  #saveDebug(url, html, parseFailed) {
    try {
      const dir = this.deps.debug?.dir || 'runtime/debug';
      mkdirSync(dir, { recursive: true });
      const safe = url.replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
      const tag = parseFailed ? 'PARSEFAIL' : 'browser';
      writeFileSync(join(dir, `${Date.now()}_${tag}_${safe}.html`), html);
    } catch {
      // Debug output must never fail a crawl.
    }
  }
}
