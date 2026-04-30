'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { LeadFilters } from '@/components/leads/LeadFilters'
import { LeadFeed } from '@/components/leads/LeadFeed'
import type { Lead, LeadFilters as Filters } from '@/lib/types/lead'
import type { DailyStats } from '@/app/actions'

interface DashboardShellProps {
  filters:      Filters
  initialLeads: Lead[]
  totalCount:   number
  pageSize:     number
  dailyStats:   DailyStats
}

export function DashboardShell({ filters, initialLeads, totalCount, pageSize, dailyStats }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-[calc(100vh-57px)]">

      {/* ── Desktop sidebar ───────────────────────────────────────────────────── */}
      <aside className="hidden lg:block sticky top-[57px] self-start h-[calc(100vh-57px)] overflow-y-auto w-72 flex-shrink-0 border-r border-navy-800">
        <div className="p-5">
          <LeadFilters activeFilters={filters} totalCount={totalCount} dailyStats={dailyStats} />
        </div>
      </aside>

      {/* ── Mobile sidebar overlay ────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-navy-950 border-r border-navy-800 overflow-y-auto z-10">
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

      {/* ── Main content ──────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 px-4 py-6 lg:px-8">
        <div className="mb-5 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-navy-800 border border-navy-700 text-slate-400 hover:text-white hover:border-navy-600 transition-colors text-sm font-medium"
            aria-label="Abrir filtros"
          >
            <Menu className="w-4 h-4" />
            Filtros
            <span className="text-slate-600 text-xs tabular-nums">
              ({totalCount.toLocaleString()})
            </span>
          </button>
        </div>

        <LeadFeed
          initialLeads={initialLeads}
          totalCount={totalCount}
          filters={filters}
          pageSize={pageSize}
        />
      </main>

    </div>
  )
}
