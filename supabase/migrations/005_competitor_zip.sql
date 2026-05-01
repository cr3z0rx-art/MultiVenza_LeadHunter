-- Migration 005: Add zip_code to competitor_analysis for ZIP-level territory analysis
-- Run in Supabase SQL Editor

ALTER TABLE competitor_analysis ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE competitor_analysis ADD COLUMN IF NOT EXISTS state    TEXT;

-- Index for territory queries
CREATE INDEX IF NOT EXISTS idx_comp_city       ON competitor_analysis(city);
CREATE INDEX IF NOT EXISTS idx_comp_state_city ON competitor_analysis(state, city);
CREATE INDEX IF NOT EXISTS idx_comp_contractor ON competitor_analysis(contractor_name);
CREATE INDEX IF NOT EXISTS idx_comp_date       ON competitor_analysis(permit_date DESC);

NOTIFY pgrst, 'reload schema';
