// Optional Discord webhook notifier. Sends nothing (and never crashes) when
// the webhook url is not configured.
import { postJsonWithRetry } from './http.js';

export class DiscordNotifier {
  constructor({ webhook, timeoutMs, maxRetries, fetchImpl, sleepFn, randomFn } = {}) {
    this.name = 'discord';
    this.webhook = webhook || '';
    this.requestOptions = { timeoutMs, maxRetries, fetchImpl, sleepFn, randomFn };
  }

  isConfigured() { return Boolean(this.webhook); }

  async send({ title, body }) {
    if (!this.isConfigured()) return { status: 'skipped', detail: 'discord not configured' };
    try {
      const res = await postJsonWithRetry(
        this.webhook,
        { content: `**${title}**\n${body}`.slice(0, 1900) },
        this.requestOptions
      );
      if (!res.ok) return { status: 'failed', detail: `discord HTTP ${res.status}` };
      return { status: 'sent', detail: 'discord ok' };
    } catch (err) {
      return { status: 'failed', detail: `discord error: ${err.message}` };
    }
  }
}
