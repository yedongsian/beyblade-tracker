import { ConsoleNotifier } from './console.js';
import { TelegramNotifier } from './telegram.js';
import { DiscordNotifier } from './discord.js';

/**
 * Build the list of notifiers from config. Console is always present; the
 * external ones are included but stay inert until credentials are provided.
 */
export function buildNotifiers(config) {
  return [
    new ConsoleNotifier(),
    new TelegramNotifier(config.notify?.telegram),
    new DiscordNotifier(config.notify?.discord),
  ];
}

export { ConsoleNotifier, TelegramNotifier, DiscordNotifier };
