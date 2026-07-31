-- Keep page failures separate from item failures (BT-P1-002-FIX-11).
ALTER TABLE operation_events ADD COLUMN page_failed_count INTEGER;
