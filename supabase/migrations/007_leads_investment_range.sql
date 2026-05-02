-- Migration 007: Add investment_range to leads + delete audit test record
-- Safe to run multiple times.

-- 1. Add investment_range column to leads (matches competitor_analysis)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS investment_range TEXT;

-- 2. Back-fill investment_range from estimated_valuation
UPDATE leads
SET investment_range = CASE
  WHEN estimated_valuation < 15000                    THEN 'Small'
  WHEN estimated_valuation BETWEEN 15000 AND 100000   THEN 'Medium'
  ELSE 'High'
END
WHERE investment_range IS NULL;

-- 3. Remove audit test record inserted during system health check
DELETE FROM leads WHERE permit_number = 'AUDIT-TEST-DO-NOT-KEEP';

-- 4. Ensure projected_profit column exists (used by fetchDailyStats)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS projected_profit NUMERIC DEFAULT 0;

-- 5. Back-fill projected_profit where missing (35% of estimated_valuation)
UPDATE leads
SET projected_profit = ROUND(estimated_valuation * 0.35)
WHERE (projected_profit IS NULL OR projected_profit = 0)
  AND estimated_valuation > 0;

NOTIFY pgrst, 'reload schema';
