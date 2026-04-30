import { DashboardShell } from '@/components/layout/DashboardShell'
import { fetchLeads, fetchDailyStats, fetchHotLeads } from '@/app/actions'
import type { LeadFilters as Filters, LeadTier, LeadState, ProjectType } from '@/lib/types/lead'

interface PageProps {
  searchParams: {
    state?:         string
    county?:        string
    tier?:          string
    project_type?:  string
    min_valuation?: string
    max_valuation?: string
    no_gc?:         string
  }
}

const PAGE_SIZE = 20

export default async function DashboardPage({ searchParams }: PageProps) {
  const filters: Filters = {
    state:         (searchParams.state        as LeadState)    || 'all',
    county:        (searchParams.county       as string)       || 'all',
    tier:          (searchParams.tier         as LeadTier)     || 'all',
    project_type:  (searchParams.project_type as ProjectType)  || 'all',
    min_valuation: searchParams.min_valuation ? Number(searchParams.min_valuation) : undefined,
    max_valuation: searchParams.max_valuation ? Number(searchParams.max_valuation) : undefined,
    no_gc_only:    searchParams.no_gc === 'true',
  }

  const [{ leads: initialLeads, count }, dailyStats, hotLeads] = await Promise.all([
    fetchLeads(filters, 0, PAGE_SIZE - 1),
    fetchDailyStats(),
    fetchHotLeads(),
  ])

  return (
    <DashboardShell
      filters={filters}
      initialLeads={initialLeads}
      totalCount={count}
      pageSize={PAGE_SIZE}
      dailyStats={dailyStats}
      hotLeads={hotLeads}
    />
  )
}
