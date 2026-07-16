import { BaseConnector } from './base.js';
import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * Fully offline connector that replays deterministic listing snapshots.
 *
 * config = {
 *   "frames": [[listing, ...], [listing, ...]],   // inline, or
 *   "file": "fixtures/beyblade-x.json",            // { "frames": [...] }
 *   "frame": 0                                     // which frame to return
 * }
 *
 * The active frame can also be overridden at runtime via deps.frameIndex or
 * the FIXTURE_FRAME environment variable, which lets a single command replay
 * a whole new -> out_of_stock -> restock sequence step by step.
 */
export class FixtureConnector extends BaseConnector {
  #loadFrames() {
    const cfg = this.config || {};
    if (Array.isArray(cfg.frames)) return cfg.frames;
    if (cfg.file) {
      const path = isAbsolute(cfg.file) ? cfg.file : join(process.cwd(), cfg.file);
      if (!existsSync(path)) throw new Error(`fixture file not found: ${cfg.file}`);
      const data = JSON.parse(readFileSync(path, 'utf8'));
      if (Array.isArray(data)) return data.map((f) => (Array.isArray(f) ? f : [f]));
      if (Array.isArray(data.frames)) return data.frames;
      throw new Error('fixture file must be an array or {"frames": [...]}');
    }
    if (Array.isArray(cfg.listings)) return [cfg.listings];
    throw new Error('fixture connector requires frames, file, or listings');
  }

  async fetchListings() {
    const frames = this.#loadFrames();
    if (frames.length === 0) return [];
    let idx = this.deps?.frameIndex;
    if (idx == null && process.env.FIXTURE_FRAME != null) idx = Number(process.env.FIXTURE_FRAME);
    if (idx == null) idx = this.config?.frame ?? 0;
    idx = Math.max(0, Math.min(frames.length - 1, Number(idx) || 0));
    // Return a deep copy so downstream mutation never touches fixture data.
    return frames[idx].map((l) => ({ ...l }));
  }
}
