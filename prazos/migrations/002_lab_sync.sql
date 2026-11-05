-- Outbox survives restarts; only read-back-confirmed Astrea schedules are enqueued.
CREATE TABLE lab_sync_outbox (
 key TEXT PRIMARY KEY,
 record_id TEXT NOT NULL REFERENCES records(id),
 status TEXT NOT NULL CHECK(status IN ('pending','sent')),
 data JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lab_sync_pending ON lab_sync_outbox(status,updated_at);
