'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import type { Lead, LeadFilters, DailyStats } from '@/lib/types/lead'
import { toFrontendLead } from '@/lib/utils/lead-mapper'

export type { DailyStats }

export async function fetchDailyStats(): Promise<DailyStats> {
  const supabase = createAdminClient()
  const cutoff   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('leads')
    .select('estimated_valuation, projected_profit')
    .gte('created_at', cutoff)

  if (error || !data) return { tpv24h: 0, count24h: 0, profit24h: 0 }

  return {
    tpv24h:    data.reduce((s, r) => s + (r.estimated_valuation ?? 0), 0),
    profit24h: data.reduce((s, r) => s + (r.projected_profit    ?? 0), 0),
    count24h:  data.length,
  }
}

export async function fetchHotLeads(): Promise<Lead[]> {
  const supabase = createAdminClient()
  const cutoff   = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  let { data, error } = await supabase
    .from('leads')
    .select('*')
    .gte('permit_date', cutoff)
    .order('projected_profit', { ascending: false })
    .limit(5)

  if (error || !data?.length) {
    const fallback = await supabase
      .from('leads')
      .select('*')
      .gte('created_at', cutoff) // Fallback to created_at if permit_date fails
      .order('projected_profit', { ascending: false })
      .limit(5)
    data = fallback.data
  }

  return (data ?? []).map(toFrontendLead)
}

export async function fetchLeads(
  filters: LeadFilters,
  from: number,
  to: number,
): Promise<{ leads: Lead[]; count: number }> {
  const supabase = createAdminClient()

  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  let q = supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .gte('permit_date', cutoff30d) // Filtro estricto de 30 días para HotRadar
    .order('estimated_valuation', { ascending: false })
    .order('created_at',          { ascending: false })
    .range(from, to)

  if (filters.state        && filters.state        !== 'all') q = q.eq('state', filters.state)
  if (filters.county       && filters.county       !== 'all') q = q.eq('county', filters.county)
  if (filters.tier         && filters.tier         !== 'all') q = q.eq('tier',  filters.tier)
  if (filters.project_type && filters.project_type !== 'all') q = q.eq('project_type', filters.project_type)
  if (filters.min_valuation) q = q.gte('estimated_valuation', filters.min_valuation)
  if (filters.max_valuation) q = q.lte('estimated_valuation', filters.max_valuation)
  if (filters.no_gc_only)    q = q.eq('no_gc', true)

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
