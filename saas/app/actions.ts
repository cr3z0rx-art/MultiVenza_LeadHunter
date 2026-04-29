'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import type { Lead, LeadFilters } from '@/lib/types/lead'
import { toFrontendLead } from '@/lib/utils/lead-mapper'

export async function fetchLeads(
  filters: LeadFilters,
  from: number,
  to: number,
): Promise<{ leads: Lead[]; count: number }> {
  const supabase = createAdminClient()

  let q = supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .order('estimated_valuation', { ascending: false })
    .order('created_at',          { ascending: false })
    .range(from, to)

  if (filters.state        && filters.state        !== 'all') q = q.eq('state', filters.state)
  if (filters.tier         && filters.tier         !== 'all') q = q.eq('tier',  filters.tier)
  if (filters.project_type && filters.project_type !== 'all') q = q.eq('project_type', filters.project_type)
  if (filters.min_valuation) q = q.gte('estimated_valuation', filters.min_valuation)
  if (filters.max_valuation) q = q.lte('estimated_valuation', filters.max_valuation)

  const { data, count, error } = await q

  if (error) {
    console.error('[fetchLeads]', error.message)
    return { leads: [], count: 0 }
  }

  return {
    leads: (data ?? []).map(toFrontendLead),
    count: count ?? 0,
  }
}
