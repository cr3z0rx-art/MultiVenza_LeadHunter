'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { LeadFilters } from '@/components/leads/LeadFilters'
import { LeadFeed }    from '@/components/leads/LeadFeed'
import { HotRadar }    from '@/components/leads/HotRadar'
import type { Lead, LeadFilters as Filters, DailyStats } from '@/lib/types/lead'

interface DashboardShellProps {
  filters:      Filters
  initialLeads: Lead[]
  totalCount:   number
  pageSize:     number
  dailyStats:   DailyStats
  hotLeads:     Lead[]
}

export function DashboardShell({
  filters, initialLeads, totalCount, pageSize, dailyStats, hotLeads,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-[calc(100vh-57px)]">

      {/* ── Left sidebar — desktop ──────────────────────────────────────────── */}
      <aside
        className="hidden lg:flex lg:flex-col sticky top-[57px] self-start h-[calc(100vh-57px)] overflow-y-auto w-[260px] flex-shrink-0 bg-navy-950"
        style={{ borderRight: '1px solid rgba(0,212,232,0.07)' }}
      >
        <div className="p-4">
          <LeadFilters
            activeFilters={filters}
            totalCount={totalCount}
            dailyStats={dailyStats}
          />
        </div>
      </aside>

      {/* ── Left sidebar — mobile overlay ──────────────────────────────────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className="absolute left-0 top-0 bottom-0 w-[260px] bg-navy-950 overflow-y-auto z-10"
            style={{ borderRight: '1px solid rgba(0,212,232,0.07)' }}
          >
            <div className="p-4">
              <LeadFilters
                activeFilters={filters}
                totalCount={totalCount}
                dailyStats={dailyStats}
                onClose={() => setSidebarOpen(false)}
              />
            </div>
          </aside>
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 px-5 py-5 bg-navy-900">
        {/* Mobile filter button */}
        <div className="mb-4 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-navy-800 border text-slate-400 hover:text-white transition-colors text-xs font-medium"
            style={{ borderColor: 'rgba(0,212,232,0.10)' }}
            aria-label="Abrir filtros"
          >
            <Menu className="w-3.5 h-3.5" />
            Filtros
            <span className="text-slate-600 tabular-nums">({totalCount.toLocaleString()})</span>
          </button>
        </div>

        {/* Lead feed — max width for readability */}
        <div className="max-w-[700px]">
          <LeadFeed
            initialLeads={initialLeads}
            totalCount={totalCount}
            filters={filters}
            pageSize={pageSize}
          />
        </div>

        {/* Hot Radar — below feed on mobile/tablet (xl hidden in right sidebar) */}
        <div
          className="xl:hidden mt-6 pt-5 border-t"
          style={{ borderColor: 'rgba(0,212,232,0.07)', maxWidth: '700px' }}
        >
          <HotRadar leads={hotLeads} />
        </div>
      </main>

      {/* ── Right sidebar — Radar (xl+) ─────────────────────────────────────── */}
      <aside
        className="hidden xl:flex xl:flex-col sticky top-[57px] self-start h-[calc(100vh-57px)] overflow-y-auto w-[240px] flex-shrink-0 bg-navy-950"
        style={{ borderLeft: '1px solid rgba(0,212,232,0.07)' }}
      >
        <div className="p-4">
          <HotRadar leads={hotLeads} />
        </div>
      </aside>

    </div>
  )
}
