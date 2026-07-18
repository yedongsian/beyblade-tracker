const now = () => new Date().toISOString();

export function getNetworkState(db, config = {}) {
  const row = db.get('SELECT enabled,reason,updated_at FROM network_control WHERE id=1');
  const environmentEnabled = config.network?.enabled !== false;
  const userEnabled = row ? Boolean(row.enabled) : true;
  return {
    enabled: environmentEnabled && userEnabled,
    environmentEnabled,
    userEnabled,
    reason: !environmentEnabled ? 'NETWORK_ENABLED=0' : (row?.reason || null),
    updatedAt: row?.updated_at || null,
  };
}

export function setNetworkEnabled(db, enabled, { reason = null, config = {} } = {}) {
  if (enabled && config.network?.enabled === false) {
    throw new Error('環境設定 NETWORK_ENABLED=0，必須先由系統管理者解除。');
  }
  const ts = now();
  db.run(`INSERT INTO network_control (id,enabled,reason,updated_at) VALUES (1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,reason=excluded.reason,updated_at=excluded.updated_at`,
  [enabled ? 1 : 0, enabled ? null : String(reason || '使用者暫停所有外部連線').slice(0, 500), ts]);
  return getNetworkState(db, config);
}

export function assertNetworkEnabled(db, config = {}) {
  const state = getNetworkState(db, config);
  if (!state.enabled) throw new Error(`所有外部連線已暫停${state.reason ? `：${state.reason}` : ''}。`);
  return state;
}
