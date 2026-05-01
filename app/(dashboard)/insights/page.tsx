import { createAdminClient } from '@/lib/supabase/admin'
import { Building2, TrendingUp, MapPin, AlertTriangle, BarChart3, Users, Shield, Zap, Clock, Activity, Star, Flame } from 'lucide-react'
import USHeatMap from '@/components/insights/USHeatMap'
import type { StateMapData } from '@/components/insights/USHeatMap'

export const metadata = {
  title: 'Market Insights | MultiVenza LeadHunter',
}

export const dynamic = 'force-dynamic'

// ── Constants ─────────────────────────────────────────────────────────────────

const OVERLOAD_THRESHOLD = 5
const STALE_DAYS         = 30
const FINALED_STATUSES   = ['finaled', 'closed', 'completed', 'co issued', 'final', 'expired']

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyZone {
  contractor_name: string
  permits:         number
  valuation:       number
  share_pct:       number
  monopoly:        boolean
  permits_per_mo:  number
}

interface ZoneData {
  zone:      string
  state:     string
  total:     number
  companies: CompanyZone[]
}

interface VolumeMetrics {
  totalPermits90d:    number
  totalValuation90d:  number
  noGcOpportunities:  number
  noGcRate:           number
  byState: { state: string; permits: number; opportunities: number }[]
}

interface OverloadedContractor {
  contractor_name: string
  zip_code:        string
  city:            string
  state:           string
  permit_count:    number
}

interface RescueLead {
  id:            string
  city:          string
  state:         string
  project_type:  string
  permit_number: string
  permit_date:   string
  permit_status: string | null
  days_stale:    number
  no_gc:         boolean
  tier:          string
}

interface ZipHeatEntry {
  zip_code: string
  city:     string
  state:    string
  count:    number
  pct:      number
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchAll(queryFn: (from: number, to: number) => any) {
  let allData: any[] = []
  const PAGE_SIZE = 1000
  let page = 0
  let hasMore = true

  // Fetch in parallel chunks for speed (up to 15,000 records = 15 chunks)
  const chunks = await Promise.all(
    Array.from({ length: 15 }).map((_, i) => {
      const from = i * PAGE_SIZE
      const to   = from + PAGE_SIZE - 1
      return queryFn(from, to)
    })
  )

  for (const res of chunks) {
    if (res.data && res.data.length > 0) {
      allData = allData.concat(res.data)
    }
  }

  return allData
}

async function getVolumeMetrics(): Promise<VolumeMetrics> {
  const supabase = createAdminClient()
  const cutoff   = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [compData, leadsRes, noGcRes] = await Promise.all([
    fetchAll((from, to) => supabase.from('competitor_analysis').select('state, valuation').range(from, to)),
    supabase.from('leads').select('state', { count: 'exact', head: true }),
    supabase.from('leads').select('state', { count: 'exact', head: true }).eq('no_gc', true),
  ])

  const totalPermits90d   = compData.length
  const totalValuation90d = compData.reduce((s, r) => s + (Number(r.valuation) || 0), 0)
  const noGcOpportunities = noGcRes.count  ?? 0
  const totalLeads        = leadsRes.count ?? 0
  const noGcRate          = totalLeads > 0 ? Math.round((noGcOpportunities / totalLeads) * 100) : 0

  const stateMap: Record<string, { permits: number }> = {}
  for (const r of compData) {
    const s = r.state || 'Unknown'
    stateMap[s] = { permits: (stateMap[s]?.permits ?? 0) + 1 }
  }

  const { data: leadsAll } = await supabase.from('leads').select('state, no_gc')
  const oppByState: Record<string, number> = {}
  for (const r of leadsAll ?? []) {
    if (r.no_gc) oppByState[r.state] = (oppByState[r.state] ?? 0) + 1
  }

  const byState = Object.entries(stateMap).map(([state, { permits }]) => ({
    state, permits, opportunities: oppByState[state] ?? 0,
  })).sort((a, b) => b.permits - a.permits)

  return { totalPermits90d, totalValuation90d, noGcOpportunities, noGcRate, byState }
}

async function getMapData(): Promise<StateMapData[]> {
  const supabase = createAdminClient()
  const cutoff   = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const cutoff30 = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [compData, diamanteData, staleData] = await Promise.all([
    fetchAll((from, to) => supabase.from('competitor_analysis').select('state, contractor_name').range(from, to)),
    fetchAll((from, to) => supabase.from('leads').select('state').or('tier.eq.diamante,no_gc.eq.true').range(from, to)),
    fetchAll((from, to) => supabase.from('leads').select('state, permit_status').not('permit_date', 'is', null).range(from, to)),
  ])

  const stateMap: Record<string, StateMapData> = {}
  const contractorByState: Record<string, Record<string, number>> = {}

  function ensure(s: string) {
    if (!stateMap[s]) stateMap[s] = { state: s, permits90d: 0, diamante: 0, overloaded: 0, stale: 0, topGC: null }
  }

  for (const r of compData) {
    const s = (r.state as string) || ''
    if (!s) continue
    ensure(s)
    stateMap[s].permits90d++

    const gc = ((r.contractor_name as string) || '').trim()
    if (gc) {
      if (!contractorByState[s]) contractorByState[s] = {}
      contractorByState[s][gc] = (contractorByState[s][gc] ?? 0) + 1
    }
  }

  for (const [s, contractors] of Object.entries(contractorByState)) {
    const sorted = Object.entries(contractors).sort((a, b) => b[1] - a[1])
    if (stateMap[s]) {
      stateMap[s].topGC      = sorted[0]?.[0] ?? null
      stateMap[s].overloaded = sorted.filter(([, count]) => count >= 15).length
    }
  }

  for (const r of diamanteData) {
    const s = (r.state as string) || ''
    if (!s) continue
    ensure(s)
    stateMap[s].diamante++
  }

  for (const r of staleData) {
    const s      = (r.state as string) || ''
    const status = ((r.permit_status as string) || '').toLowerCase()
    if (!s || FINALED_STATUSES.some(f => status.includes(f))) continue
    ensure(s)
    stateMap[s].stale++
  }

  return Object.values(stateMap)
}

async function getSaturationData(): Promise<OverloadedContractor[]> {
  const supabase = createAdminClient()
  const cutoff   = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const data = await fetchAll((from, to) => 
    supabase
      .from('competitor_analysis')
      .select('contractor_name, zip_code, city, state')
      .not('contractor_name', 'is', null)
      .not('zip_code', 'is', null)
      .range(from, to)
  )

  if (!data.length) return []

  const map: Record<string, OverloadedContractor> = {}
  for (const r of data) {
    const key = `${r.contractor_name}||${r.zip_code}`
    if (!map[key]) map[key] = {
      contractor_name: (r.contractor_name as string).trim().toUpperCase(),
      zip_code:  r.zip_code as string,
      city:      (r.city    as string) || '',
      state:     (r.state   as string) || '',
      permit_count: 0,
    }
    map[key].permit_count++
  }

  return Object.values(map)
    .filter(c => c.permit_count >= OVERLOAD_THRESHOLD)
    .sort((a, b) => b.permit_count - a.permit_count)
    .slice(0, 20)
}

async function getRescueLeads(): Promise<RescueLead[]> {
  const supabase = createAdminClient()
  const cutoff30 = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data } = await supabase
    .from('leads')
    .select('id, city, state, project_type, permit_number, permit_date, permit_status, no_gc, tier')
    .lte('permit_date', cutoff30)
    .not('permit_date', 'is', null)

  if (!data?.length) return []

  return data
    .filter(r => {
      const status = ((r.permit_status as string) || '').toLowerCase().trim()
      return !FINALED_STATUSES.some(s => status.includes(s))
    })
    .map(r => ({
      id:            r.id as string,
      city:          (r.city as string) || '',
      state:         (r.state as string) || '',
      project_type:  (r.project_type as string) || '',
      permit_number: (r.permit_number as string) || '',
      permit_date:   (r.permit_date as string) || '',
      permit_status: (r.permit_status as string | null),
      days_stale:    Math.floor((Date.now() - new Date(r.permit_date as string).getTime()) / 86_400_000),
      no_gc:         (r.no_gc as boolean) ?? false,
      tier:          (r.tier as string) || 'plata',
    }))
    .sort((a, b) => {
      if (a.no_gc && !b.no_gc) return -1
      if (!a.no_gc && b.no_gc) return 1
      return b.days_stale - a.days_stale
    })
    .slice(0, 20)
}

async function getZipHeatData(): Promise<ZipHeatEntry[]> {
  const supabase = createAdminClient()
  const cutoff   = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const data = await fetchAll((from, to) =>
    supabase
      .from('competitor_analysis')
      .select('zip_code, city, state')
      .not('zip_code', 'is', null)
      .range(from, to)
  )

  if (!data.length) return []

  const map: Record<string, { city: string; state: string; count: number }> = {}
  for (const r of data) {
    const zip = r.zip_code as string
    if (!map[zip]) map[zip] = { city: (r.city as string) || '', state: (r.state as string) || '', count: 0 }
    map[zip].count++
  }

  const sorted = Object.entries(map)
    .map(([zip_code, { city, state, count }]) => ({ zip_code, city, state, count, pct: 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 36)

  const max = sorted[0]?.count ?? 1
  for (const e of sorted) e.pct = Math.round((e.count / max) * 100)

  return sorted
}

async function getTerritoryData(): Promise<ZoneData[]> {
  const supabase = createAdminClient()
  const cutoff   = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const data = await fetchAll((from, to) =>
    supabase
      .from('competitor_analysis')
      .select('city, state, contractor_name, valuation')
      .not('contractor_name', 'is', null)
      .not('city', 'is', null)
      .range(from, to)
  )

  if (!data.length) return []

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
      const total  = Object.values(companies).reduce((s, c) => s + c.permits, 0)
      const sorted = Object.entries(companies)
        .map(([name, { permits, valuation }]) => ({
          contractor_name: name,
          permits,
          valuation,
          share_pct:      Math.round((permits / total) * 100),
          monopoly:       (permits / total) >= 0.20,
          permits_per_mo: Math.round((permits / 3) * 10) / 10,
        }))
        .sort((a, b) => b.permits - a.permits)
        .slice(0, 10)
      return { zone, state, total, companies: sorted }
    })
    .filter(z => z.total >= 5)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20)
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

function tierColor(tier: string): string {
  if (tier === 'diamante') return '#00D4E8'
  if (tier === 'oro')      return '#FBB724'
  return '#64748b'
}

function staleUrgency(days: number): { color: string; label: string } {
  if (days >= 90) return { color: '#EF4444', label: 'Crítico' }
  if (days >= 60) return { color: '#F97316', label: 'Alto' }
  return { color: '#FBB724', label: 'Medio' }
}

function heatFill(pct: number): string {
  if (pct >= 80) return 'rgba(239,68,68,0.18)'
  if (pct >= 55) return 'rgba(249,115,22,0.15)'
  if (pct >= 30) return 'rgba(251,191,36,0.12)'
  return 'rgba(0,212,232,0.07)'
}

function heatBorder(pct: number): string {
  if (pct >= 80) return 'rgba(239,68,68,0.35)'
  if (pct >= 55) return 'rgba(249,115,22,0.28)'
  if (pct >= 30) return 'rgba(251,191,36,0.22)'
  return 'rgba(0,212,232,0.14)'
}

function heatText(pct: number): string {
  if (pct >= 80) return '#EF4444'
  if (pct >= 55) return '#F97316'
  if (pct >= 30) return '#FBB724'
  return '#00D4E8'
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function InsightsPage() {
  const [volume, mapData, saturation, rescueLeads, territories, zipHeat] = await Promise.all([
    getVolumeMetrics(),
    getMapData(),
    getSaturationData(),
    getRescueLeads(),
    getTerritoryData(),
    getZipHeatData(),
  ])

  const monopolyZones  = territories.filter(z => z.companies[0]?.monopoly)
  const ownerPriority  = rescueLeads.filter(l => l.no_gc)

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
              Inteligencia competitiva — mapa de calor nacional, saturación territorial,
              leads de rescate y análisis de dominio por zona.
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
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="w-4 h-4 text-slate-500" />
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-600">Permisos Totales</span>
              </div>
              <p className="text-4xl font-black text-white tabular-nums tracking-tighter">
                {volume.totalPermits90d.toLocaleString()}
              </p>
              <p className="text-xs text-slate-600 mt-1">emitidos en los últimos 90 días</p>
            </div>

            <div className="bg-navy-900/60 border rounded-2xl p-5" style={{ borderColor: 'rgba(0,212,232,0.18)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4" style={{ color: '#00D4E8' }} />
                <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: '#00A3AD' }}>
                  Oportunidades No-GC
                </span>
              </div>
              <p className="text-4xl font-black text-white tabular-nums tracking-tighter">
                {volume.noGcOpportunities.toLocaleString()}
              </p>
              <p className="text-xs mt-1" style={{ color: '#00D4E8' }}>dueños sin contratista asignado</p>
            </div>

            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-600">Tasa de Apertura</span>
              </div>
              <p className="text-4xl font-black text-emerald-400 tabular-nums tracking-tighter">
                {volume.noGcRate}%
              </p>
              <p className="text-xs text-slate-600 mt-1">del mercado total son No-GC</p>
            </div>

            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-gold-400" />
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-600">TPV del Mercado</span>
              </div>
              <p className="text-4xl font-black text-white tabular-nums tracking-tighter">
                {fmt$(volume.totalValuation90d)}
              </p>
              <p className="text-xs text-slate-600 mt-1">valuación con GC activo</p>
            </div>
          </div>

          {volume.byState.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
              {volume.byState.map(s => (
                <div key={s.state} className="bg-navy-900/40 border border-navy-800 rounded-xl p-3 text-center">
                  <p className="text-lg font-black text-white">{stateIcon(s.state)} {s.state}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    <span className="text-white font-bold">{s.permits}</span> permisos
                  </p>
                  {s.opportunities > 0 && (
                    <p className="text-[10px] mt-0.5" style={{ color: '#00D4E8' }}>{s.opportunities} No-GC</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Mapa de Calor Nacional ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-5">
            <Flame className="w-4 h-4 text-gold-400" />
            <h2 className="text-[11px] font-bold uppercase tracking-[0.3em] text-gold-400">
              Mapa de Calor Nacional — Barrido por Estado
            </h2>
          </div>
          <USHeatMap data={mapData} />
        </section>

        {/* ── ZIP Heat Tiles ─────────────────────────────────────────────────── */}
        {zipHeat.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-slate-500" />
              <h2 className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-600">
                Densidad por ZIP Code — Top {zipHeat.length} Zonas Activas
              </h2>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-9 gap-2">
              {zipHeat.map(z => (
                <div key={z.zip_code}
                     className="rounded-xl p-3 text-center border transition-all hover:scale-105"
                     style={{ background: heatFill(z.pct), borderColor: heatBorder(z.pct) }}>
                  <p className="text-[11px] font-black text-white">{z.zip_code}</p>
                  <p className="text-[9px] text-white/50 truncate">{z.city}</p>
                  <p className="text-base font-black tabular-nums mt-1" style={{ color: heatText(z.pct) }}>
                    {z.count}
                  </p>
                  <p className="text-[8px] text-white/30">perm</p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-5 text-[10px] text-slate-600">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(0,212,232,0.07)', border: '1px solid rgba(0,212,232,0.14)' }} /> Baja</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(251,191,36,0.12)' }} /> Media</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(249,115,22,0.15)' }} /> Alta</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(239,68,68,0.18)' }} /> Máxima</span>
            </div>
          </section>
        )}

        {/* ── Inteligencia de Saturación ──────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-5">
            <Activity className="w-4 h-4 text-red-400" />
            <h2 className="text-[11px] font-bold uppercase tracking-[0.3em] text-red-400">
              Inteligencia de Saturación
            </h2>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

            {/* Contratistas Sobrecargados */}
            <div className="rounded-2xl border overflow-hidden"
                 style={{ background: 'rgba(239,68,68,0.03)', borderColor: 'rgba(239,68,68,0.15)' }}>
              <div className="px-5 py-4 border-b flex items-center justify-between"
                   style={{ borderColor: 'rgba(239,68,68,0.10)' }}>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-red-400" />
                  <div>
                    <h3 className="text-sm font-bold text-white">Contratistas Sobrecargados</h3>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      ≥{OVERLOAD_THRESHOLD} permisos activos en mismo ZIP · últimos 90 días
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}>
                  {saturation.length} GCs
                </span>
              </div>

              {saturation.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-slate-500 text-sm">Sin datos de ZIP en competitor_analysis.</p>
                  <p className="text-slate-600 text-xs mt-1">
                    Corre <code className="text-red-400">run_historical_90d.js</code> para poblar.
                  </p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: 'rgba(239,68,68,0.06)' }}>
                  {saturation.slice(0, 10).map((c, i) => {
                    const urgColor = c.permit_count >= 15 ? '#EF4444' : c.permit_count >= 10 ? '#F97316' : '#FBB724'
                    return (
                      <div key={`${c.contractor_name}-${c.zip_code}`} className="flex items-center gap-3 px-5 py-3">
                        <span className="text-[10px] text-slate-700 font-mono w-4 text-right shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-bold text-slate-200 truncate">{c.contractor_name}</p>
                          <p className="text-[10px] text-slate-600 mt-0.5">
                            ZIP {c.zip_code} · {c.city}{c.state ? `, ${c.state}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="w-2 h-2 rounded-full" style={{ background: urgColor }} />
                          <span className="text-sm font-black tabular-nums" style={{ color: urgColor }}>
                            {c.permit_count}
                          </span>
                          <span className="text-[10px] text-slate-600">perm</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="px-5 py-3 border-t" style={{ borderColor: 'rgba(239,68,68,0.08)' }}>
                <p className="text-[10px] text-slate-700">
                  GC saturado = mayor probabilidad de rechazar trabajos. Contacta al dueño directamente.
                </p>
              </div>
            </div>

            {/* Leads de Rescate */}
            <div className="rounded-2xl border overflow-hidden"
                 style={{ background: 'rgba(251,191,36,0.02)', borderColor: 'rgba(251,191,36,0.15)' }}>
              <div className="px-5 py-4 border-b flex items-center justify-between"
                   style={{ borderColor: 'rgba(251,191,36,0.10)' }}>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <div>
                    <h3 className="text-sm font-bold text-white">Leads de Rescate</h3>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      Permisos &gt;{STALE_DAYS}d sin cierre · Owner Priority primero
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {ownerPriority.length > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                          style={{ background: 'rgba(0,212,232,0.12)', color: '#00D4E8' }}>
                      <Star className="w-2.5 h-2.5" />
                      {ownerPriority.length} Owner
                    </span>
                  )}
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(251,191,36,0.12)', color: '#FBB724' }}>
                    {rescueLeads.length} leads
                  </span>
                </div>
              </div>

              {rescueLeads.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-slate-500 text-sm">No hay permisos estancados actualmente.</p>
                  <p className="text-slate-600 text-xs mt-1">Todos los permisos están en proceso activo.</p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: 'rgba(251,191,36,0.06)' }}>
                  {rescueLeads.slice(0, 10).map(lead => {
                    const { color, label } = staleUrgency(lead.days_stale)
                    return (
                      <div key={lead.id}
                           className="flex items-center gap-3 px-5 py-3 transition-all"
                           style={lead.no_gc ? {
                             background:   'rgba(0,212,232,0.04)',
                             borderLeft:   '2px solid rgba(0,212,232,0.4)',
                             paddingLeft:  '18px',
                           } : {}}>
                        {/* Owner star */}
                        {lead.no_gc ? (
                          <div className="shrink-0 flex flex-col items-center gap-0.5">
                            <Star className="w-3.5 h-3.5 fill-current" style={{ color: '#00D4E8' }} />
                            <span className="text-[8px] font-black uppercase" style={{ color: '#00D4E8' }}>Owner</span>
                          </div>
                        ) : (
                          <div className="w-6 shrink-0" />
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[12px] font-bold" style={{ color: tierColor(lead.tier) }}>
                              {lead.city}, {lead.state}
                            </p>
                            {lead.no_gc && (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                                    style={{ background: 'rgba(0,212,232,0.15)', color: '#00D4E8' }}>
                                No-GC · Dueño Directo
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-600 mt-0.5">
                            {lead.project_type} · #{lead.permit_number}
                          </p>
                          <p className="text-[10px] text-slate-700 mt-0.5">
                            Estado: {lead.permit_status || 'Issued'} · desde {lead.permit_date}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-xs font-black tabular-nums" style={{ color }}>{lead.days_stale}d</p>
                          <p className="text-[9px] font-bold mt-0.5" style={{ color }}>{label}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="px-5 py-3 border-t" style={{ borderColor: 'rgba(251,191,36,0.08)' }}>
                <p className="text-[10px] text-slate-700">
                  ⭐ Owner Priority = No-GC + estancado. Acceso directo al dueño sin competencia.
                </p>
              </div>
            </div>
          </div>
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
                  <div key={zone.zone} className="rounded-2xl border overflow-hidden"
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
                                     style={{ width: `${c.share_pct}%`, background: c.share_pct >= 30 ? '#EF4444' : '#FBB724' }} />
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
              Dominio por Zona — Top 10 GCs · Cuota de Mercado · Vel/mes
            </h2>
          </div>

          {territories.length === 0 ? (
            <div className="bg-navy-900/40 border border-navy-800 rounded-2xl p-12 text-center">
              <Building2 className="w-8 h-8 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Sin datos de contratistas en los últimos 90 días.</p>
              <p className="text-slate-600 text-xs mt-1">
                Corre <code className="text-gold-500">run_historical_90d.js</code> para poblar esta sección.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {territories.map(zone => (
                <div key={zone.zone}
                     className="bg-navy-900/40 border border-navy-800 rounded-2xl overflow-hidden hover:border-navy-700/50 transition-all">
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

                  <div className="px-4 py-2 border-b border-navy-800/50 flex items-center gap-3">
                    <span className="w-4 shrink-0" />
                    <span className="flex-1 text-[9px] uppercase tracking-widest text-slate-700 font-bold">Contratista</span>
                    <span className="text-[9px] uppercase tracking-widest text-slate-700 font-bold w-20 text-right">Cuota</span>
                    <span className="text-[9px] uppercase tracking-widest text-slate-700 font-bold w-16 text-right">Vel/mes</span>
                  </div>

                  <div className="p-3 space-y-1">
                    {zone.companies.map((c, i) => (
                      <div key={c.contractor_name}
                           className="flex items-center gap-3 p-2.5 rounded-xl border transition-all"
                           style={{
                             background:  c.monopoly ? 'rgba(251,191,36,0.04)' : 'rgba(13,20,32,0.5)',
                             borderColor: c.monopoly ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.03)',
                           }}>
                        <span className="text-[10px] text-slate-600 font-mono w-4 text-right shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-slate-200 truncate">{c.contractor_name}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <div className="flex-1 h-1 bg-navy-800 rounded-full overflow-hidden max-w-[80px]">
                              <div className="h-full rounded-full"
                                   style={{
                                     width: `${c.share_pct}%`,
                                     background: c.monopoly ? (c.share_pct >= 35 ? '#EF4444' : '#FBB724') : 'rgba(0,212,232,0.5)',
                                   }} />
                            </div>
                            <span className="text-[10px] font-bold tabular-nums w-8 text-right"
                                  style={{ color: c.monopoly ? (c.share_pct >= 35 ? '#EF4444' : '#FBB724') : '#00D4E8' }}>
                              {c.share_pct}%
                            </span>
                          </div>
                        </div>
                        <div className="text-right w-16 shrink-0">
                          <p className="text-[11px] font-bold text-slate-300 tabular-nums">
                            {c.permits_per_mo}
                            <span className="text-[9px] text-slate-600 font-normal">/mo</span>
                          </p>
                          <p className="text-[9px] text-slate-700">{c.permits}p · {fmt$(c.valuation)}</p>
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
