import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseConnector } from './base.js';
import { parseProductPage, classifyParsedPage } from './parse.js';

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

    const browserLib = this.deps.chromium || chromium;
    const browser = await browserLib.launch(launch);
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
          // Signal a page-level parse result and keep crawling the remaining
          // pages. A single maintenance/empty page must neither abort the whole
          // source nor enter the pipeline as an invalid listing.
          const status = this.recordPageResult(classifyParsedPage(html, listing));
          const usable = status === 'ok';
          if (this.deps.debug?.saveHtml || !usable) {
            this.#saveDebug(requestedUrl, html, !usable);
          }
          if (usable) listings.push(listing);
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
