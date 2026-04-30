import type { Lead, LeadTier, LeadState, ProjectType, RoofClass } from '@/lib/types/lead'

function computeScore(tier: LeadTier, valuation: number): number {
  let score = 10
  if (tier === 'diamante') score += 55
  else if (tier === 'oro') score += 30
  if (valuation >= 250_000) score += 20
  else if (valuation >= 50_000) score += 10
  return Math.min(score, 100)
}

export function toFrontendLead(row: Record<string, unknown>): Lead {
  const tier      = (row.tier as LeadTier) ?? 'plata'
  const valuation = (row.estimated_valuation as number) ?? 0

  return {
    id:                   (row.id as string)              ?? '',
    city:                 (row.city as string)            ?? '',
    zip_code:             (row.zip_code as string)        ?? null,
    state:                (row.state as LeadState)        ?? 'FL',
    county:               (row.county as string)          ?? null,
    project_type:         (row.project_type as ProjectType) ?? 'Remodel',
    estimated_valuation:  valuation,
    projected_profit:     (row.projected_profit as number) ?? Math.round(valuation * 0.35),
    tier,
    score:                (row.score as number)           ?? computeScore(tier, valuation),
    tags:                 Array.isArray(row.tags) ? (row.tags as string[]) : [],
    no_gc:                (row.no_gc as boolean)          ?? false,
    roof_age:             (row.roof_age as number)        ?? null,
    roof_classification:  (row.roof_classification as RoofClass) ?? null,
    permit_status:        (row.permit_status as string)   ?? null,
    permit_number:        (row.permit_number as string)   ?? '',
    permit_date:          (row.permit_date as string)     ?? null,
    government_source:    (row.government_source as string) ?? null,
    market_note:          (row.market_note as string)     ?? null,
    created_at:           (row.created_at as string)      ?? '',
    is_unlocked:          (row.is_unlocked as boolean)    ?? false,
    unlocked_at:          (row.unlocked_at as string)     ?? null,
    exact_address:        (row.exact_address as string)   ?? null,
    owner_name:           (row.owner_name as string)      ?? null,
    phone:                (row.phone as string)           ?? null,
    contractor_name:      (row.contractor_name as string) ?? null,
  }
}
