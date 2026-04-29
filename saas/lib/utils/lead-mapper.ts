import type { Lead, LeadTier, LeadState, ProjectType } from '@/lib/types/lead'

function computeScore(tier: LeadTier, valuation: number): number {
  let score = 10
  if (tier === 'diamond') score += 55
  else if (tier === 'premium') score += 30
  if (valuation >= 250_000) score += 20
  else if (valuation >= 50_000) score += 10
  return Math.min(score, 100)
}

export function toFrontendLead(row: Record<string, unknown>): Lead {
  const tier = (row.tier as LeadTier) ?? 'standard'
  const valuation = (row.estimated_valuation as number) ?? 0

  return {
    id:                   row.id as string,
    city:                 (row.city as string) ?? '',
    zip_code:             (row.zip_code as string) ?? null,
    state:                (row.state as LeadState) ?? 'FL',
    county:               null,
    project_type:         (row.project_type as ProjectType) ?? 'Remodel',
    estimated_valuation:  valuation,
    projected_profit:     Math.round(valuation * 0.35),
    tier,
    score:                computeScore(tier, valuation),
    tags:                 [],
    no_gc:                false,
    roof_age:             null,
    roof_classification:  null,
    permit_status:        null,
    permit_number:        (row.permit_number as string) ?? '',
    permit_date:          (row.created_at as string) ?? null,
    government_source:    null,
    market_note:          null,
    created_at:           (row.created_at as string) ?? '',
    is_unlocked:          !(row.is_locked as boolean),
    unlocked_at:          null,
    exact_address:        (row.exact_address as string) ?? null,
    owner_name:           (row.owner_name as string) ?? null,
    phone:                (row.phone as string) ?? null,
    contractor_name:      null,
  }
}
