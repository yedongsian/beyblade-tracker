const now = () => new Date().toISOString();

export function listExclusions(db, { status = 'all', limit = 200 } = {}) {
  const where = status === 'all' ? '' : 'WHERE le.review_status=?';
  const params = status === 'all' ? [Number(limit)] : [status, Number(limit)];
  return db.all(`SELECT le.*,s.name source_name FROM listing_exclusions le
    JOIN sources s ON s.id=le.source_id ${where} ORDER BY le.last_seen_at DESC,le.id DESC LIMIT ?`, params);
}

export function isExclusionAllowed(db, sourceId, url) {
  return Boolean(db.get("SELECT id FROM listing_exclusion_overrides WHERE source_id=? AND url=? AND action='allow'", [sourceId, url]));
}

export function reviewExclusion(db, id, { action, note } = {}) {
  if (!['confirm', 'allow', 'reopen'].includes(action)) throw new Error('不支援的排除審核操作。');
  const row = db.get('SELECT * FROM listing_exclusions WHERE id=?', [id]);
  if (!row) throw new Error('找不到排除紀錄。');
  const ts = now();
  if (action === 'allow') {
    db.run(`INSERT INTO listing_exclusion_overrides (source_id,url,action,reason,created_at,updated_at)
      VALUES (?,?,'allow',?,?,?) ON CONFLICT(source_id,url) DO UPDATE SET
      action='allow',reason=excluded.reason,updated_at=excluded.updated_at`,
    [row.source_id, row.url, String(note || '人工判定允許追蹤').slice(0, 500), ts, ts]);
  } else {
    db.run('DELETE FROM listing_exclusion_overrides WHERE source_id=? AND url=?', [row.source_id, row.url]);
  }
  const status = action === 'reopen' ? 'pending' : action === 'allow' ? 'allowed' : 'confirmed';
  db.run('UPDATE listing_exclusions SET review_status=?,review_note=?,reviewed_at=?,updated_at=? WHERE id=?',
    [status, note || null, action === 'reopen' ? null : ts, ts, id]);
  return db.get('SELECT * FROM listing_exclusions WHERE id=?', [id]);
}
