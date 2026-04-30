'use client'

import { Flame, TrendingUp } from 'lucide-react'
import type { Lead } from '@/lib/types/lead'
import { stateFlag } from '@/lib/utils'

interface HotRadarProps {
  leads: Lead[]
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`
  return `$${n.toLocaleString()}`
}

// The 4 target niches for this run
const TARGET_NICHES = new Set<string>(['Roofing', 'HVAC', 'CGC', 'New Construction'])

function isHighPriority(lead: Lead): boolean {
  // Highest signal: niche + No-GC (both conditions met)
  if (TARGET_NICHES.has(lead.project_type) && lead.no_gc) return true

  // Diamond tier always qualifies
  if (lead.tier === 'diamante') return true

  // Urgency tags
  if (lead.tags.some(t => /emergency|urgente|urgent|critical/i.test(t))) return true

  return false
}

export function HotRadar({ leads }: HotRadarProps) {
  const totalTPV    = leads.reduce((s, l) => s + l.estimated_valuation, 0)
  const totalProfit = leads.reduce((s, l) => s + l.projected_profit,    0)

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3.5">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,130,0,0.12)' }}
        >
          <Flame className="w-3.5 h-3.5" style={{ color: '#FF8200' }} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-white tracking-tight leading-none">
            Radar · Hot Leads
          </div>
          <div className="text-[9px] text-slate-600 uppercase tracking-widest mt-0.5">
            Top 5 Net Profit
          </div>
        </div>
      </div>

      {/* ── Lead list ─────────────────────────────────────────────────────────── */}
      {leads.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-[11px] text-slate-600">Sin leads disponibles</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {leads.map((lead, i) => {
            const priority = isHighPriority(lead)
            return (
              <div
                key={lead.id}
                className="rounded-lg p-2.5 border"
                style={{
                  background:  priority
                    ? 'rgba(255,130,0,0.04)'
                    : 'rgba(13,20,32,0.7)',
                  borderColor: priority
                    ? 'rgba(255,130,0,0.18)'
                    : 'rgba(0,212,232,0.07)',
                }}
              >
                {/* Row 1: rank + priority */}
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] text-slate-600 font-mono tabular-nums w-3">
                    {i + 1}
                  </span>
                  {priority && (
                    <span
                      className="text-[8px] font-bold px-1.5 py-0.5 rounded leading-none"
                      style={{
                        background: 'rgba(255,80,0,0.14)',
                        color:      '#FF8200',
                      }}
                    >
                      ALTA PRIORIDAD
                    </span>
                  )}
                  {lead.tier === 'diamante' && (
                    <span
                      className="text-[8px] font-bold px-1.5 py-0.5 rounded leading-none"
                      style={{
                        background: 'rgba(0,212,232,0.10)',
                        color:      '#00D4E8',
                      }}
                    >
                      DIAMANTE
                    </span>
                  )}
                </div>

                {/* Row 2: city + type */}
                <div className="text-[11px] font-semibold text-slate-200 truncate leading-tight">
                  {stateFlag(lead.state)} {lead.city}
                </div>
                <div className="text-[10px] text-slate-500 truncate mb-2">
                  {lead.project_type}
                  {lead.no_gc && (
                    <span className="ml-1 text-emerald-500 font-medium">· No-GC</span>
                  )}
                </div>

                {/* Row 3: values */}
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-600 uppercase tracking-wider">Net Profit</span>
                  <span className="text-[12px] font-bold text-emerald-400 tabular-nums">
                    {formatCompact(lead.projected_profit)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[9px] text-slate-600 uppercase tracking-wider">TPV</span>
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {formatCompact(lead.estimated_valuation)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── TPV Summary ───────────────────────────────────────────────────────── */}
      {leads.length > 0 && (
        <div
          className="mt-3 pt-3 border-t"
          style={{ borderColor: 'rgba(0,212,232,0.08)' }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3 h-3" style={{ color: '#00D4E8' }} />
            <span className="text-[9px] text-slate-600 uppercase tracking-widest font-medium">
              Radar TPV Total
            </span>
          </div>
          <div className="text-[16px] font-bold text-white tabular-nums leading-none">
            {formatCompact(totalTPV)}
          </div>
          <div className="text-[10px] text-emerald-400 tabular-nums mt-0.5">
            {formatCompact(totalProfit)} net profit
          </div>
          <div className="text-[9px] text-slate-600 mt-0.5">
            en {leads.length} leads
          </div>
        </div>
      )}
    </div>
  )
}
