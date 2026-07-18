import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

const PROVIDER = 'windows-dpapi-current-user';
const ENTROPY = 'BeybladeTracker/secrets/v1';

function powershellDpapi(mode, value) {
  const operation = mode === 'protect' ? 'Protect' : 'Unprotect';
  const script = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;` +
    `$raw=[Console]::In.ReadToEnd();$bytes=[Convert]::FromBase64String($raw);` +
    `$entropy=[Text.Encoding]::UTF8.GetBytes('${ENTROPY}');` +
    `$out=[Security.Cryptography.ProtectedData]::${operation}($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);` +
    `[Console]::Out.Write([Convert]::ToBase64String($out))`;
  const input = Buffer.from(String(value), mode === 'protect' ? 'utf8' : 'base64').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input, encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  if (result.status !== 0) throw new Error('Windows 憑證保護失敗，請確認目前使用者設定檔可用。');
  const output = String(result.stdout || '').trim();
  return mode === 'protect' ? output : Buffer.from(output, 'base64').toString('utf8');
}

export class SecretStore {
  constructor(path, { platform = process.platform, protect, unprotect } = {}) {
    this.path = path;
    this.platform = platform;
    this.protect = protect || ((value) => powershellDpapi('protect', value));
    this.unprotect = unprotect || ((value) => powershellDpapi('unprotect', value));
  }

  #readDocument() {
    if (!existsSync(this.path)) return { version: 1, provider: PROVIDER, values: {} };
    const doc = JSON.parse(readFileSync(this.path, 'utf8'));
    if (doc.version !== 1 || doc.provider !== PROVIDER || !doc.values) {
      throw new Error('加密憑證檔格式不受支援。');
    }
    return doc;
  }

  #writeDocument(doc) {
    if (this.platform !== 'win32') throw new Error('OS 憑證儲存目前只支援 Windows。');
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(doc, null, 2), { mode: 0o600 });
    rmSync(this.path, { force: true });
    renameSync(temp, this.path);
  }

  readNotifications() {
    const doc = this.#readDocument();
    const get = (key) => doc.values[key] ? this.unprotect(doc.values[key]) : '';
    return {
      telegram: { token: get('telegram.token'), chatId: get('telegram.chatId') },
      discord: { webhook: get('discord.webhook') },
    };
  }

  status() {
    const doc = this.#readDocument();
    return {
      provider: PROVIDER,
      telegram: {
        configured: Boolean(doc.values['telegram.token'] && doc.values['telegram.chatId']),
        tokenStored: Boolean(doc.values['telegram.token']),
        chatIdStored: Boolean(doc.values['telegram.chatId']),
      },
      discord: { configured: Boolean(doc.values['discord.webhook']) },
    };
  }

  saveTelegram({ token, chatId }) {
    if (!String(token || '').trim() || !String(chatId || '').trim()) {
      throw new Error('Telegram Bot Token 與 Chat ID 都必須填寫。');
    }
    const doc = this.#readDocument();
    doc.values['telegram.token'] = this.protect(String(token).trim());
    doc.values['telegram.chatId'] = this.protect(String(chatId).trim());
    doc.updatedAt = new Date().toISOString();
    this.#writeDocument(doc);
    return this.status();
  }

  clearTelegram() {
    const doc = this.#readDocument();
    delete doc.values['telegram.token'];
    delete doc.values['telegram.chatId'];
    doc.updatedAt = new Date().toISOString();
    this.#writeDocument(doc);
    return this.status();
  }
}

export function createSecretStore(path, options) {
  return new SecretStore(path, options);
}
