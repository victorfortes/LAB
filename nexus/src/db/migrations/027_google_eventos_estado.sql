-- Estado de retentativa da agenda; 025 já aplicada permanece imutável.
ALTER TABLE google_eventos ADD COLUMN IF NOT EXISTS erro TEXT;
