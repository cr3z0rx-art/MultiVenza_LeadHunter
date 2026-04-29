import { LeadFilters } from '@/components/leads/LeadFilters'
import { LeadFeed } from '@/components/leads/LeadFeed'
import { fetchLeads } from '@/app/actions'
import type { LeadFilters as Filters, LeadTier, LeadState, ProjectType } from '@/lib/types/lead'

interface PageProps {
  searchParams: {
    state?:         string
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
    tier:          (searchParams.tier         as LeadTier)     || 'all',
    project_type:  (searchParams.project_type as ProjectType)  || 'all',
    min_valuation: searchParams.min_valuation ? Number(searchParams.min_valuation) : undefined,
    max_valuation: searchParams.max_valuation ? Number(searchParams.max_valuation) : undefined,
    no_gc_only:    searchParams.no_gc === 'true',
  }

  const { leads: initialLeads, count } = await fetchLeads(filters, 0, PAGE_SIZE - 1)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <LeadFilters activeFilters={filters} totalCount={count} />
      <LeadFeed
        initialLeads={initialLeads}
        totalCount={count}
        filters={filters}
        pageSize={PAGE_SIZE}
      />
    </div>
  )
}
