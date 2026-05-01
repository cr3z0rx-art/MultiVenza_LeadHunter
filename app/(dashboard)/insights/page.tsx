import { createAdminClient } from '@/lib/supabase/admin'
import { Building2, TrendingUp, MapPin, AlertTriangle, BarChart3, Users, Shield } from 'lucide-react'

export const metadata = {
  title: 'Market Insights | MultiVenza LeadHunter',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyZone {
  contractor_name: string
  permits:         number
  valuation:       number
  share_pct:       number
  monopoly:        boolean   // share >= 20%
}

interface ZoneData {
  zone:        string   // city or ZIP
  state:       string
  total:       number
  companies:   CompanyZone[]
}

interface VolumeMetrics {
  totalPermits90d:    number
  totalValuation90d:  number
  noGcOpportunities:  number
  noGcRate:           number
  byState: { state: string; permits: number; opportunities: number }[]
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getVolumeMetrics(): Promise<VolumeMetrics> {
  const supabase = createAdminClient()
  const cutoff   = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [compRes, leadsRes, noGcRes] = await Promise.all([
    supabase
      .from('competitor_analysis')
      .select('state, valuation')
      .gte('permit_date', cutoff),
    supabase
      .from('leads')
      .select('state', { count: 'exact' })
      .limit(1),
    supabase
      .from('leads')
      .select('state', { count: 'exact' })
      .eq('no_gc', true)
      .limit(1),
  ])

  const compData   = compRes.data  ?? []
  const totalPermits90d   = compData.length
  const totalValuation90d = compData.reduce((s, r) => s + (Number(r.valuation) || 0), 0)
  const noGcOpportunities = noGcRes.count  ?? 0
  const totalLeads        = leadsRes.count ?? 0
  const noGcRate          = totalLeads > 0 ? Math.round((noGcOpportunities / totalLeads) * 100) : 0

  // Per-state breakdown
  const stateMap: Record<string, { permits: number }> = {}
  for (const r of compData) {
    const s = r.state || 'Unknown'
    stateMap[s] = { permits: (stateMap[s]?.permits ?? 0) + 1 }
  }

  const [leadsStateRes] = await Promise.all([
    supabase.from('leads').select('state, no_gc'),
  ])

  const oppByState: Record<string, number> = {}
  for (const r of leadsStateRes.data ?? []) {
    if (r.no_gc) oppByState[r.state] = (oppByState[r.state] ?? 0) + 1
  }

  const byState = Object.entries(stateMap).map(([state, { permits }]) => ({
    state,
    permits,
    opportunities: oppByState[state] ?? 0,
  })).sort((a, b) => b.permits - a.permits)

  return { totalPermits90d, totalValuation90d, noGcOpportunities, noGcRate, byState }
}

async function getTerritoryData(): Promise<ZoneData[]> {
  const supabase = createAdminClient()
  const cutoff   = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data } = await supabase
    .from('competitor_analysis')
    .select('city, state, contractor_name, valuation')
    .gte('permit_date', cutoff)
    .not('contractor_name', 'is', null)
    .not('city', 'is', null)
    .limit(5000)

  if (!data?.length) return []

  // Group by city
  const cityMap: Record<string, { state: string; companies: Record<string, { permits: number; valuation: number }> }> = {}

  for (const r of data) {
    const city = (r.city as string).trim()
    const name = (r.contractor_name as string).trim().toUpperCase()
    const val  = Number(r.valuation) || 0

    if (!cityMap[city]) cityMap[city] = { state: r.state ?? '', companies: {} }
    if (!cityMap[city].companies[name]) cityMap[city].companies[name] = { permits: 0, valuation: 0 }
    cityMap[city].companies[name].permits++
    cityMap[city].companies[name].valuation += val
  }

  return Object.entries(cityMap)
    .map(([zone, { state, companies }]) => {
      const total = Object.values(companies).reduce((s, c) => s + c.permits, 0)
      const sorted = Object.entries(companies)
        .map(([name, { permits, valuation }]) => ({
          contractor_name: name,
          permits,
          valuation,
          share_pct: Math.round((permits / total) * 100),
          monopoly:  (permits / total) >= 0.20,
        }))
        .sort((a, b) => b.permits - a.permits)
        .slice(0, 10)

      return { zone, state, total, companies: sorted }
    })
    .filter(z => z.total >= 5)              // min 5 permits for meaningful analysis
    .sort((a, b) => b.total - a.total)
    .slice(0, 20)                           // top 20 cities
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`
  return `$${n.toLocaleString()}`
}

function stateIcon(s: string) {
  const icons: Record<string, string> = { FL: '🌊', GA: '🍑', IL: '🏙️', TX: '🌵', AZ: '☀️', NC: '🌲' }
  return icons[s] ?? '📍'
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function InsightsPage() {
  const [volume, territories] = await Promise.all([
    getVolumeMetrics(),
    getTerritoryData(),
  ])

  const monopolyZones = territories.filter(z => z.companies[0]?.monopoly)

  return (
    <div className="min-h-screen bg-navy-950/50">
      <div className="p-6 md:p-10 max-w-[1400px] mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-navy-800 pb-8">
          <div>
            <h1 className="text-3xl font-black text-white flex items-center gap-3 tracking-tight">
              <BarChart3 className="w-8 h-8 text-gold-400" />
              Market Insights
            </h1>
            <p className="text-slate-400 mt-2 max-w-xl text-sm leading-relaxed">
              Inteligencia competitiva en tiempo real — dominio por zona, análisis de monopolios
              y termómetro de oportunidades No-GC vs mercado total.
            </p>
          </div>
          <div className="px-4 py-2 rounded-xl bg-navy-800/50 border border-navy-700 text-[10px] uppercase tracking-[0.2em] font-bold text-slate-500">
            90 días · {new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        </header>

        {/* ── Volume Metrics ─────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-600 mb-4">
            Termómetro del Mercado — Últimos 90 Días
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Total Permits */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="w-4 h-4 text-slate-500" />
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-600">
                  Permisos Totales
                </span>
              </div>
              <p className="text-4xl font-black text-white tabular-nums tracking-tighter">
                {volume.totalPermits90d.toLocaleString()}
              </p>
              <p className="text-xs text-slate-600 mt-1">emitidos en los últimos 90 días</p>
            </div>

            {/* No-GC Opportunities */}
            <div className="bg-navy-900/60 border rounded-2xl p-5"
                 style={{ borderColor: 'rgba(0,212,232,0.18)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4" style={{ color: '#00D4E8' }} />
                <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: '#00A3AD' }}>
                  Oportunidades No-GC
                </span>
              </div>
              <p className="text-4xl font-black text-white tabular-nums tracking-tighter">
                {volume.noGcOpportunities.toLocaleString()}
              </p>
              <p className="text-xs mt-1" style={{ color: '#00D4E8' }}>
                dueños sin contratista asignado
              </p>
            </div>

            {/* Market Open Rate */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-600">
                  Tasa de Apertura
                </span>
              </div>
              <p className="text-4xl font-black text-emerald-400 tabular-nums tracking-tighter">
                {volume.noGcRate}%
              </p>
              <p className="text-xs text-slate-600 mt-1">del mercado total son No-GC</p>
            </div>

            {/* Total Market TPV */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-gold-400" />
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-600">
                  TPV del Mercado
                </span>
              </div>
              <p className="text-4xl font-black text-white tabular-nums tracking-tighter">
                {fmt$(volume.totalValuation90d)}
              </p>
              <p className="text-xs text-slate-600 mt-1">valuación con GC activo</p>
            </div>
          </div>

          {/* Per-state breakdown */}
          {volume.byState.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
              {volume.byState.map(s => (
                <div key={s.state} className="bg-navy-900/40 border border-navy-800 rounded-xl p-3 text-center">
                  <p className="text-lg font-black text-white">{stateIcon(s.state)} {s.state}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    <span className="text-white font-bold">{s.permits}</span> permisos
                  </p>
                  {s.opportunities > 0 && (
                    <p className="text-[10px] mt-0.5" style={{ color: '#00D4E8' }}>
                      {s.opportunities} No-GC
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Monopoly Alert ─────────────────────────────────────────────────── */}
        {monopolyZones.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <h2 className="text-[11px] font-bold uppercase tracking-[0.3em] text-amber-400">
                Análisis de Monopolio — Compañías con ≥20% del Mercado Local
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {monopolyZones.slice(0, 6).map(zone => {
                const top5 = zone.companies.filter(c => c.monopoly).slice(0, 5)
                return (
                  <div key={zone.zone}
                       className="rounded-2xl border overflow-hidden"
                       style={{ background: 'rgba(251,191,36,0.03)', borderColor: 'rgba(251,191,36,0.15)' }}>
                    <div className="px-4 py-3 flex items-center justify-between border-b"
                         style={{ borderColor: 'rgba(251,191,36,0.10)' }}>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-amber-400" />
                        <span className="font-bold text-sm text-white">{zone.zone}</span>
                        <span className="text-xs text-slate-600">{stateIcon(zone.state)} {zone.state}</span>
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                            style={{ background: 'rgba(251,191,36,0.12)', color: '#FBB724' }}>
                        {zone.total} permisos
                      </span>
                    </div>

                    <div className="p-3 space-y-2">
                      {top5.map((c, i) => (
                        <div key={c.contractor_name} className="flex items-center gap-3">
                          <span className="text-[10px] text-slate-700 w-4 text-right">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-slate-200 truncate">{c.contractor_name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <div className="flex-1 h-1 bg-navy-800 rounded-full overflow-hidden">
                                <div className="h-full rounded-full"
                                     style={{
                                       width: `${c.share_pct}%`,
                                       background: c.share_pct >= 30 ? '#EF4444' : '#FBB724',
                                     }} />
                              </div>
                              <span className="text-[10px] font-bold tabular-nums"
                                    style={{ color: c.share_pct >= 30 ? '#EF4444' : '#FBB724' }}>
                                {c.share_pct}%
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-600 tabular-nums">{c.permits}p</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── Territory Domination ───────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-slate-500" />
            <h2 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-600">
              Dominio por Zona — Top 10 GCs por Ciudad
            </h2>
          </div>

          {territories.length === 0 ? (
            <div className="bg-navy-900/40 border border-navy-800 rounded-2xl p-12 text-center">
              <Building2 className="w-8 h-8 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Sin datos de contratistas en los últimos 90 días.</p>
              <p className="text-slate-600 text-xs mt-1">
                Corre el script <code className="text-gold-500">run_historical_90d.js</code> para poblar esta sección.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {territories.map(zone => (
                <div key={zone.zone}
                     className="bg-navy-900/40 border border-navy-800 rounded-2xl overflow-hidden hover:border-navy-700/50 transition-all">
                  {/* Zone header */}
                  <div className="bg-navy-800/40 px-5 py-4 border-b border-navy-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-navy-900 flex items-center justify-center border border-navy-700">
                        <MapPin className="w-4 h-4 text-slate-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">{zone.zone}</h3>
                        <p className="text-[10px] text-slate-600">{stateIcon(zone.state)} {zone.state} · {zone.total} permisos</p>
                      </div>
                    </div>
                    {zone.companies[0]?.monopoly && (
                      <span className="text-[9px] font-bold px-2 py-1 rounded-full uppercase tracking-wider"
                            style={{ background: 'rgba(251,191,36,0.12)', color: '#FBB724' }}>
                        ⚠ Monopolio
                      </span>
                    )}
                  </div>

                  {/* Companies list */}
                  <div className="p-4 space-y-2">
                    {zone.companies.map((c, i) => (
                      <div key={c.contractor_name}
                           className="flex items-center gap-3 p-3 rounded-xl border transition-all"
                           style={{
                             background:   c.monopoly ? 'rgba(251,191,36,0.04)' : 'rgba(13,20,32,0.5)',
                             borderColor:  c.monopoly ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.03)',
                           }}>
                        <span className="text-[10px] text-slate-600 font-mono w-4 text-right">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-slate-200 truncate">
                            {c.contractor_name}
                          </p>
                          <div className="flex items-center gap-3 mt-1">
                            <div className="flex items-center gap-1.5 flex-1">
                              <div className="flex-1 h-1 bg-navy-800 rounded-full overflow-hidden max-w-[80px]">
                                <div className="h-full rounded-full"
                                     style={{
                                       width: `${c.share_pct}%`,
                                       background: c.monopoly
                                         ? (c.share_pct >= 35 ? '#EF4444' : '#FBB724')
                                         : 'rgba(0,212,232,0.5)',
                                     }} />
                              </div>
                              <span className="text-[10px] font-bold tabular-nums"
                                    style={{
                                      color: c.monopoly
                                        ? (c.share_pct >= 35 ? '#EF4444' : '#FBB724')
                                        : '#00D4E8',
                                    }}>
                                {c.share_pct}%
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-600 tabular-nums">
                              {c.permits} perm · {fmt$(c.valuation)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
