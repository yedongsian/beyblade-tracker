// Optional Telegram Bot notifier. Sends nothing (and never crashes) when the
// bot token or chat id is not configured.
import { postJsonWithRetry } from './http.js';

export class TelegramNotifier {
  constructor({ token, chatId, timeoutMs, maxRetries, fetchImpl, sleepFn, randomFn } = {}) {
    this.name = 'telegram';
    this.token = token || '';
    this.chatId = chatId || '';
    this.requestOptions = { timeoutMs, maxRetries, fetchImpl, sleepFn, randomFn };
  }

  isConfigured() { return Boolean(this.token && this.chatId); }

  async send({ title, body }) {
    if (!this.isConfigured()) return { status: 'skipped', detail: 'telegram not configured' };
    const text = `*${title}*\n${body}`;
    try {
      const res = await postJsonWithRetry(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        { chat_id: this.chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true },
        this.requestOptions
      );
      if (!res.ok) return { status: 'failed', detail: `telegram HTTP ${res.status}` };
      return { status: 'sent', detail: 'telegram ok' };
    } catch (err) {
      return { status: 'failed', detail: `telegram error: ${err.message}` };
    }
  }
}
