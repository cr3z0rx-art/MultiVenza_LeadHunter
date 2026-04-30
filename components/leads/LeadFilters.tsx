'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { SlidersHorizontal, X, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LeadFilters, LeadState, LeadTier, ProjectType, DailyStats } from '@/lib/types/lead'

interface LeadFiltersProps {
  activeFilters: LeadFilters
  totalCount:    number
  dailyStats:    DailyStats
  onClose?:      () => void
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`
  return `$${n.toLocaleString()}`
}

type Opt<T> = { value: T; label: string }

const STATES: Opt<LeadState | 'all'>[] = [
  { value: 'all', label: 'Todos' },
  { value: 'FL',  label: '🌊 FL' },
  { value: 'GA',  label: '🍑 GA' },
  { value: 'IL',  label: '🏙️ IL' },
  { value: 'TX',  label: '🌵 TX' },
  { value: 'AZ',  label: '☀️ AZ' },
  { value: 'NC',  label: '🌲 NC' },
]

const COUNTIES: Opt<string | 'all'>[] = [
  { value: 'all',        label: 'Todos' },
  { value: 'Hillsborough', label: 'Hillsborough' },
  { value: 'Sarasota',   label: 'Sarasota' },
  { value: 'Miami-Dade', label: 'Miami-Dade' },
  { value: 'Orange',     label: 'Orange' },
  { value: 'Palm Beach', label: 'Palm Beach' },
  { value: 'Fulton',     label: 'Fulton' },
]

const TIERS: Opt<LeadTier | 'all'>[] = [
  { value: 'all',      label: 'Todos'    },
  { value: 'diamante', label: '💎 Diamante' },
  { value: 'oro',      label: '⭐ Oro'  },
  { value: 'plata',    label: '🥈 Plata'   },
]

const TYPES: Opt<ProjectType | 'all'>[] = [
  { value: 'all',              label: 'Todos'      },
  { value: 'Roofing',          label: '🏠 Roofing' },
  { value: 'CGC',              label: '🏗️ CGC'     },
  { value: 'New Construction', label: '🔨 Obra'    },
  { value: 'HVAC',             label: '❄️ HVAC'    },
  { value: 'Flooring',         label: '🪵 Piso'    },
  { value: 'Remodel',          label: '🔧 Remodel' },
]

const VALUATIONS = [
  { label: 'Todos',   min: undefined },
  { label: '>$15k',  min: 15_000    },
  { label: '>$50k',  min: 50_000    },
  { label: '>$100k', min: 100_000   },
  { label: '>$250k', min: 250_000   },
]

export function LeadFilters({ activeFilters, totalCount, dailyStats, onClose }: LeadFiltersProps) {
  const router   = useRouter()
  const pathname = usePathname()

  const setParam = useCallback((key: string, value: string | undefined) => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
    if (value && value !== 'all') params.set(key, value)
    else params.delete(key)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname])

  const clearAll = () => router.push(pathname, { scroll: false })

  const hasFilters = Boolean(
    (activeFilters.state        && activeFilters.state        !== 'all') ||
    (activeFilters.county       && activeFilters.county       !== 'all') ||
    (activeFilters.tier         && activeFilters.tier         !== 'all') ||
    (activeFilters.project_type && activeFilters.project_type !== 'all') ||
    activeFilters.min_valuation ||
    activeFilters.no_gc_only,
  )

  return (
    <section className="space-y-2.5">

      {/* ── Pipeline 24h stat card ─────────────────────────────────────────── */}
      <div
        className="rounded-lg p-3 border"
        style={{
          background:  'rgba(0,212,232,0.04)',
          borderColor: 'rgba(0,212,232,0.14)',
        }}
      >
        <div className="flex items-center gap-1.5 mb-2">
          <TrendingUp className="w-3 h-3 flex-shrink-0" style={{ color: '#00D4E8' }} />
          <span className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: '#00A3AD' }}>
            Pipeline · 24h
          </span>
        </div>

        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="tabular-nums font-bold text-[17px] leading-none text-white">
            {formatCompact(dailyStats.tpv24h)}
          </span>
          <span className="text-[10px] text-slate-600 font-medium">TPV</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-emerald-400 font-medium tabular-nums">
            {formatCompact(dailyStats.profit24h)} profit
          </span>
          <span className="text-[10px] text-slate-600 tabular-nums">
            {dailyStats.count24h} leads
          </span>
        </div>
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-sm font-semibold text-slate-300">Filtros</span>
          <span className="text-xs text-slate-700 tabular-nums">
            ({totalCount.toLocaleString()})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button
              onClick={clearAll}
              className="text-xs text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors"
            >
              <X className="w-3 h-3" />
              Limpiar
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Cerrar filtros"
              className="w-6 h-6 rounded-lg bg-navy-800 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Estado ────────────────────────────────────────────────────────── */}
      <FilterRow label="Estado">
        {STATES.map(o => (
          <Chip
            key={o.value}
            label={o.label}
            active={activeFilters.state === o.value || (!activeFilters.state && o.value === 'all')}
            onClick={() => setParam('state', o.value)}
          />
        ))}
      </FilterRow>

      {/* ── Condado ───────────────────────────────────────────────────────── */}
      <FilterRow label="Condado">
        {COUNTIES.map(o => (
          <Chip
            key={o.value}
            label={o.label}
            active={activeFilters.county === o.value || (!activeFilters.county && o.value === 'all')}
            onClick={() => setParam('county', o.value)}
          />
        ))}
      </FilterRow>

      {/* ── Tier ──────────────────────────────────────────────────────────── */}
      <FilterRow label="Tier">
        {TIERS.map(o => (
          <Chip
            key={o.value}
            label={o.label}
            active={activeFilters.tier === o.value || (!activeFilters.tier && o.value === 'all')}
            onClick={() => setParam('tier', o.value)}
            gold={o.value === 'diamante'}
          />
        ))}
      </FilterRow>

      {/* ── Tipo ──────────────────────────────────────────────────────────── */}
      <FilterRow label="Tipo">
        {TYPES.map(o => (
          <Chip
            key={o.value}
            label={o.label}
            active={activeFilters.project_type === o.value || (!activeFilters.project_type && o.value === 'all')}
            onClick={() => setParam('project_type', o.value)}
          />
        ))}
      </FilterRow>

      {/* ── Valuación ─────────────────────────────────────────────────────── */}
      <FilterRow label="Valuación mín.">
        {VALUATIONS.map(o => (
          <Chip
            key={o.label}
            label={o.label}
            active={activeFilters.min_valuation === o.min}
            onClick={() => setParam('min_valuation', o.min?.toString())}
          />
        ))}
      </FilterRow>

      {/* ── No-GC toggle ──────────────────────────────────────────────────── */}
      <button
        onClick={() => setParam('no_gc', activeFilters.no_gc_only ? undefined : 'true')}
        className="flex items-center gap-2.5 group w-full text-left"
      >
        <div className={cn(
          'relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0',
          activeFilters.no_gc_only ? 'bg-gold-500' : 'bg-navy-700',
        )}>
          <div className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
            activeFilters.no_gc_only ? 'translate-x-4' : 'translate-x-0.5',
          )} />
        </div>
        <span className="text-sm text-slate-500 group-hover:text-slate-300 transition-colors leading-none">
          Solo <span className="text-emerald-500 font-semibold">No-GC</span>
          <span className="text-slate-700 text-xs ml-1">(acceso directo al dueño)</span>
        </span>
      </button>

      <div className="h-px bg-navy-800 mt-1" />
    </section>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-slate-700 uppercase tracking-widest mb-1.5 font-medium">{label}</p>
      <div className="flex gap-1.5 flex-wrap">{children}</div>
    </div>
  )
}

function Chip({
  label, active, onClick, gold = false,
}: {
  label: string; active: boolean; onClick: () => void; gold?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all duration-150 border',
        active
          ? gold
            ? 'bg-gold-500/15 text-gold-400 border-gold-500/50'
            : 'bg-slate-700/80 text-white border-slate-600'
          : 'bg-navy-900 text-slate-600 border-navy-700 hover:border-navy-600 hover:text-slate-400',
      )}
    >
      {label}
    </button>
  )
}
