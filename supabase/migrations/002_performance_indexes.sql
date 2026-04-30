-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — Performance indexes for dashboard filters
-- Run in: Supabase Dashboard → SQL Editor, or via `supabase db push`
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. County index (missing from 001)
--    Used for future county-level filtering
CREATE INDEX IF NOT EXISTS idx_leads_county
  ON leads(county);

-- 2. Composite indexes matching the exact dashboard query pattern:
--    ORDER BY estimated_valuation DESC, created_at DESC
--    + optional equality filters on state / tier / project_type

-- state + valuation (most common filter combo)
CREATE INDEX IF NOT EXISTS idx_leads_state_valuation
  ON leads(state, estimated_valuation DESC, created_at DESC);

-- tier + valuation
CREATE INDEX IF NOT EXISTS idx_leads_tier_valuation
  ON leads(tier, estimated_valuation DESC, created_at DESC);

-- project_type + valuation  (replaces single-column idx_leads_project_type
--   for queries that also ORDER BY valuation)
CREATE INDEX IF NOT EXISTS idx_leads_type_valuation
  ON leads(project_type, estimated_valuation DESC, created_at DESC);

-- no_gc partial + valuation  (extends existing partial index to include sort)
CREATE INDEX IF NOT EXISTS idx_leads_nogc_valuation
  ON leads(estimated_valuation DESC, created_at DESC)
  WHERE no_gc = true;

-- 3. Composite for fetchDailyStats: WHERE created_at >= ? covering projected_profit
--    Allows index-only scan: no table hit needed
CREATE INDEX IF NOT EXISTS idx_leads_createdat_profit
  ON leads(created_at DESC, estimated_valuation, projected_profit);
