-- Migration 004: Update CHECK constraints for new tiers, states, and project types
-- Run this in Supabase SQL Editor BEFORE the next sync.
-- These ALTER TABLE commands drop the old constraint and add a new one.

-- ── 1. Tier: diamond/premium/standard → diamante/oro/plata ────────────────────
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_tier_check;
ALTER TABLE leads ADD CONSTRAINT leads_tier_check
  CHECK (tier IN ('diamante', 'oro', 'plata'));

-- Update any existing leads with old tier names
UPDATE leads SET tier = 'diamante' WHERE tier = 'diamond';
UPDATE leads SET tier = 'oro'      WHERE tier = 'premium';
UPDATE leads SET tier = 'plata'    WHERE tier = 'standard';

-- ── 2. State: add TX, AZ, NC ─────────────────────────────────────────────────
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_state_check;
ALTER TABLE leads ADD CONSTRAINT leads_state_check
  CHECK (state IN ('FL', 'GA', 'IL', 'TX', 'AZ', 'NC'));

-- ── 3. Project type: add Electrical ──────────────────────────────────────────
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_project_type_check;
ALTER TABLE leads ADD CONSTRAINT leads_project_type_check
  CHECK (project_type IN (
    'Roofing', 'Flooring', 'HVAC', 'Electrical',
    'New Construction', 'CGC', 'Remodel', 'Home Builder'
  ));

-- ── 4. Refresh PostgREST schema cache ────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── 5. Verification query (run after to confirm) ─────────────────────────────
-- SELECT tier, state, project_type, COUNT(*) FROM leads GROUP BY 1,2,3 ORDER BY 1,2,3;
