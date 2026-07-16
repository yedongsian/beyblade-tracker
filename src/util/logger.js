// Minimal logger that redacts obvious secrets before writing to stdout/stderr.

const SECRET_PATTERNS = [
  /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g,               // telegram bot token
  /https?:\/\/discord(?:app)?\.com\/api\/webhooks\/[^\s"']+/gi, // discord webhook
  /\b[A-Za-z0-9_-]{32,}\b/g,                       // long opaque tokens
];

export function redact(input) {
  let text = typeof input === 'string' ? input : JSON.stringify(input);
  if (text == null) return text;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[REDACTED]');
  }
  return text;
}

function stamp() {
  return new Date().toISOString();
}

function format(level, args) {
  const parts = args.map((a) =>
    typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()
  );
  return `${stamp()} [${level}] ${redact(parts.join(' '))}`;
}

export const logger = {
  info: (...args) => console.log(format('info', args)),
  warn: (...args) => console.warn(format('warn', args)),
  error: (...args) => console.error(format('error', args)),
  debug: (...args) => {
    if (process.env.DEBUG) console.log(format('debug', args));
  },
};
