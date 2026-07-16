import { logger } from '../util/logger.js';

// Always-available notifier that prints summaries to the log.
export class ConsoleNotifier {
  constructor() { this.name = 'console'; }

  // eslint-disable-next-line class-methods-use-this
  isConfigured() { return true; }

  async send({ title, body }) {
    logger.info(`🔔 ${title}\n${body}`);
    return { status: 'sent', detail: 'printed to console' };
  }
}
