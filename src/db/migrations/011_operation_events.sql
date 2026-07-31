-- Local-first structured operational events (BT-P1-002).
-- One row per source/parser/notification/update operation. Fields are bounded
-- and safe by construction: no credentials, no full URLs, no raw messages, no
-- product history. error_class is a short enum-like label, never a message.

CREATE TABLE operation_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  correlation_id TEXT NOT NULL,
  component      TEXT NOT NULL,   -- source|parser|notification|update|discovery|monitor
  operation      TEXT NOT NULL,   -- specific operation name within the component
  source_key     TEXT,            -- source/channel key when applicable
  status         TEXT NOT NULL,   -- success|failed|skipped
  duration_ms    INTEGER,
  error_class    TEXT,            -- bounded safe label (e.g. timeout, http_404, parse)
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_operation_events_recent ON operation_events(created_at DESC, id DESC);
CREATE INDEX idx_operation_events_component ON operation_events(component, id DESC);
CREATE INDEX idx_operation_events_source ON operation_events(source_key, id DESC);
