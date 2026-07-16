// Optional Discord webhook notifier. Sends nothing (and never crashes) when
// the webhook url is not configured.
export class DiscordNotifier {
  constructor({ webhook } = {}) {
    this.name = 'discord';
    this.webhook = webhook || '';
  }

  isConfigured() { return Boolean(this.webhook); }

  async send({ title, body }) {
    if (!this.isConfigured()) return { status: 'skipped', detail: 'discord not configured' };
    try {
      const res = await fetch(this.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `**${title}**\n${body}`.slice(0, 1900) }),
      });
      if (!res.ok) return { status: 'failed', detail: `discord HTTP ${res.status}` };
      return { status: 'sent', detail: 'discord ok' };
    } catch (err) {
      return { status: 'failed', detail: `discord error: ${err.message}` };
    }
  }
}
