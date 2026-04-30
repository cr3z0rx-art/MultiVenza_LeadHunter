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
    <div className="flex min-h-[calc(100vh-65px)] bg-navy-950/20">

      {/* ── Left sidebar — desktop ──────────────────────────────────────────── */}
      <aside
        className="hidden lg:flex lg:flex-col sticky top-[65px] self-start h-[calc(100vh-65px)] overflow-y-auto w-[300px] flex-shrink-0 bg-navy-950/50 backdrop-blur-md"
        style={{ borderRight: '1px solid rgba(0,212,232,0.08)' }}
      >
        <div className="p-6">
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
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className="absolute left-0 top-0 bottom-0 w-[300px] bg-navy-950 overflow-y-auto z-10 shadow-2xl animate-in slide-in-from-left duration-300"
            style={{ borderRight: '1px solid rgba(0,212,232,0.12)' }}
          >
            <div className="p-6">
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
      <main className="flex-1 min-w-0 px-6 py-8 md:px-10 md:py-10 bg-navy-900/30">
        <div className="max-w-[1200px] mx-auto">
          {/* Mobile filter button */}
          <div className="mb-6 lg:hidden">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-navy-800 border text-slate-300 hover:text-white transition-all shadow-lg active:scale-95"
              style={{ borderColor: 'rgba(0,212,232,0.15)' }}
              aria-label="Abrir filtros"
            >
              <Menu className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold uppercase tracking-wider">Filtros</span>
              <span className="text-slate-500 tabular-nums text-xs bg-navy-900 px-1.5 py-0.5 rounded">
                {totalCount.toLocaleString()}
              </span>
            </button>
          </div>

          <div className="flex flex-col xl:flex-row gap-10">
            {/* Lead feed */}
            <div className="flex-1 min-w-0 max-w-[800px]">
              <LeadFeed
                initialLeads={initialLeads}
                totalCount={totalCount}
                filters={filters}
                pageSize={pageSize}
              />
            </div>

            {/* Hot Radar — Right side on XL, below on LG and smaller */}
            <aside className="w-full xl:w-[320px] flex-shrink-0">
              <div className="sticky top-[95px] space-y-6">
                <HotRadar leads={hotLeads} />
              </div>
            </aside>
          </div>
        </div>
      </main>

    </div>
  )
}
