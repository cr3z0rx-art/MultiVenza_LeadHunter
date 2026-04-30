-- Migration 003: Add missing columns to leads table
-- Run this in Supabase SQL Editor if the initial migration was not fully applied.
-- All statements use IF NOT EXISTS / safe defaults — safe to run multiple times.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS county              TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS zip_code            TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS roof_age            INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS roof_classification TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS permit_status       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS market_note         TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS exact_address       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_name          TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone               TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contractor_name     TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS permit_date         DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS government_source   TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS processed_at        TIMESTAMPTZ;

-- Refresh PostgREST schema cache so the new columns are visible immediately
NOTIFY pgrst, 'reload schema';
