-- Parser item/page counters for local error-ratio SLOs (BT-P1-002-FIX-07).
ALTER TABLE operation_events ADD COLUMN valid_count INTEGER;
ALTER TABLE operation_events ADD COLUMN invalid_count INTEGER;
ALTER TABLE operation_events ADD COLUMN failed_count INTEGER;
ALTER TABLE operation_events ADD COLUMN page_count INTEGER;
