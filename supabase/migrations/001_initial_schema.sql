-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─────────────────────────────────────────────────────────────────────────────
-- Core leads table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE leads (
  id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- PUBLIC fields (visible to all authenticated users)
  city                 TEXT         NOT NULL,
  zip_code             TEXT,
  state                TEXT         NOT NULL CHECK (state IN ('FL', 'GA', 'IL')),
  county               TEXT,
  project_type         TEXT         NOT NULL
                         CHECK (project_type IN (
                           'Roofing', 'Flooring', 'HVAC',
                           'New Construction', 'CGC', 'Remodel', 'Home Builder'
                         )),
  estimated_valuation  DECIMAL(12,2) DEFAULT 0,
  projected_profit     DECIMAL(12,2) GENERATED ALWAYS AS
                         (ROUND(estimated_valuation * 0.40, 2)) STORED,
  tier                 TEXT         NOT NULL DEFAULT 'standard'
                         CHECK (tier IN ('diamond', 'premium', 'standard')),
  score                INTEGER      DEFAULT 0,
  tags                 TEXT[]       DEFAULT '{}',
  no_gc                BOOLEAN      DEFAULT false,
  roof_age             INTEGER,
  roof_classification  TEXT,
  permit_status        TEXT,
  market_note          TEXT,

  -- PROTECTED fields — masked at view level unless lead is unlocked by user
  exact_address        TEXT,
  owner_name           TEXT,
  phone                TEXT,
  contractor_name      TEXT,

  -- Permit metadata (populated by Python scrapers)
  permit_number        TEXT         UNIQUE NOT NULL,
  permit_date          DATE,
  government_source    TEXT,

  -- Timestamps
  created_at           TIMESTAMPTZ  DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  DEFAULT NOW(),
  processed_at         TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Per-user lead unlocks (payment junction table)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE lead_unlocks (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id           UUID        NOT NULL REFERENCES leads(id)      ON DELETE CASCADE,
  unlocked_at       TIMESTAMPTZ DEFAULT NOW(),
  payment_reference TEXT,
  amount_paid       DECIMAL(10,2),
  UNIQUE (user_id, lead_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Sync logs (batch upload tracking — written by service role only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sync_logs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id         TEXT,
  source_state     TEXT,
  records_inserted INTEGER     DEFAULT 0,
  records_updated  INTEGER     DEFAULT 0,
  records_skipped  INTEGER     DEFAULT 0,
  scraper_source   TEXT,
  synced_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX idx_leads_state         ON leads(state);
CREATE INDEX idx_leads_tier          ON leads(tier);
CREATE INDEX idx_leads_city          ON leads(city);
CREATE INDEX idx_leads_score         ON leads(score DESC);
CREATE INDEX idx_leads_valuation     ON leads(estimated_valuation DESC);
CREATE INDEX idx_leads_created_at    ON leads(created_at DESC);
CREATE INDEX idx_leads_permit_date   ON leads(permit_date DESC);
CREATE INDEX idx_leads_no_gc         ON leads(no_gc) WHERE no_gc = true;
CREATE INDEX idx_leads_project_type  ON leads(project_type);
CREATE INDEX idx_unlocks_user        ON lead_unlocks(user_id);
CREATE INDEX idx_unlocks_lead        ON lead_unlocks(lead_id);

-- Full-text search index on city + address
CREATE INDEX idx_leads_fts ON leads
  USING GIN (to_tsvector('english', coalesce(city,'') || ' ' || coalesce(exact_address,'')));

-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-update trigger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs    ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all leads (protected fields handled by view)
CREATE POLICY "leads_select_authenticated"
  ON leads FOR SELECT TO authenticated USING (true);

-- Only service role can insert/update leads (scrapers use service key)
CREATE POLICY "leads_upsert_service_role"
  ON leads FOR ALL TO service_role USING (true);

-- Users manage only their own unlocks
CREATE POLICY "unlocks_select_own"
  ON lead_unlocks FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "unlocks_insert_own"
  ON lead_unlocks FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Only service role writes sync logs
CREATE POLICY "sync_logs_service_only"
  ON sync_logs FOR ALL TO service_role USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- View: leads with per-user unlock status + masked protected fields
-- Uses security_invoker so RLS + auth.uid() resolve for the calling user
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW leads_for_user
  WITH (security_invoker = true) AS
SELECT
  l.id,
  l.city,
  l.zip_code,
  l.state,
  l.county,
  l.project_type,
  l.estimated_valuation,
  l.projected_profit,
  l.tier,
  l.score,
  l.tags,
  l.no_gc,
  l.roof_age,
  l.roof_classification,
  l.permit_status,
  l.permit_number,
  l.permit_date,
  l.government_source,
  l.market_note,
  l.created_at,
  -- Unlock metadata
  (lu.id IS NOT NULL)              AS is_unlocked,
  lu.unlocked_at,
  -- Protected fields — null until unlocked
  CASE WHEN lu.id IS NOT NULL THEN l.exact_address   ELSE NULL END AS exact_address,
  CASE WHEN lu.id IS NOT NULL THEN l.owner_name       ELSE NULL END AS owner_name,
  CASE WHEN lu.id IS NOT NULL THEN l.phone            ELSE NULL END AS phone,
  CASE WHEN lu.id IS NOT NULL THEN l.contractor_name  ELSE NULL END AS contractor_name
FROM leads l
LEFT JOIN lead_unlocks lu
  ON lu.lead_id = l.id
 AND lu.user_id = auth.uid();

-- Grant view access to authenticated users
GRANT SELECT ON leads_for_user TO authenticated;
