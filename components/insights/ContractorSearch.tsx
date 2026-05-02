'use client'

import { useState, useCallback, useRef } from 'react'
import { Search, X, Building2, MapPin, Zap, TrendingUp, AlertTriangle, BarChart3, Loader2 } from 'lucide-react'

interface ContractorProfile {
  contractor_name: string
  matched_names: string[]
  total_projects: number
  total_valuation: number
  is_saturated: boolean
  by_state: { state: string; count: number }[]
  top_cities: { city: string; state: string; count: number }[]
  top_zips: { zip: string; count: number }[]
  top_types: { type: string; count: number }[]
}

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n.toLocaleString()}`
}

function stateIcon(s: string) {
  const icons: Record<string, string> = { FL: '🌊', GA: '🍑', IL: '🏙️', TX: '🌵', AZ: '☀️', NC: '🌲' }
  return icons[s] ?? '📍'
}

export default function ContractorSearch() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState<ContractorProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value || value.length < 2) { setProfile(null); setError(null); return }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/contractor-search?q=${encodeURIComponent(value)}`)
        const data = await res.json()
        if (data.error) { setError(data.error); setProfile(null) }
        else if (!data.total_projects) { setProfile(null); setError('Sin resultados para "' + value + '"') }
        else setProfile(data)
      } catch {
        setError('Error de conexión')
      } finally {
        setLoading(false)
      }
    }, 500)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    search(val)
  }

  const clear = () => {
    setQuery('')
    setProfile(null)
    setError(null)
  }

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'rgba(0,212,232,0.02)', borderColor: 'rgba(0,212,232,0.15)' }}>
      {/* Header */}
      <div className="px-5 py-4 border-b flex items-center gap-3" style={{ borderColor: 'rgba(0,212,232,0.10)' }}>
        <Search className="w-4 h-4" style={{ color: '#00D4E8' }} />
        <div>
          <h3 className="text-sm font-bold text-white">LLC Search Intelligence</h3>
          <p className="text-[10px] text-slate-600 mt-0.5">Búsqueda de contratistas por nombre o LLC — coincidencia parcial</p>
        </div>
      </div>

      {/* Search Input */}
      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 pointer-events-none" />
          <input
            id="contractor-search-input"
            type="text"
            value={query}
            onChange={handleChange}
            placeholder="Ej: Lennar, Pulte, D.R. Horton..."
            className="w-full bg-navy-900 border border-navy-700 rounded-xl pl-9 pr-9 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all"
            style={{ background: 'rgba(15,23,42,0.8)' }}
          />
          {query && (
            <button
              onClick={clear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center gap-2 mt-4 px-1">
            <Loader2 className="w-3.5 h-3.5 text-cyan-500 animate-spin" />
            <span className="text-[11px] text-slate-500">Buscando en la base de permisos nacionales...</span>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <p className="text-[11px] text-slate-500 mt-4 px-1">{error}</p>
        )}

        {/* Profile Card */}
        {profile && !loading && (
          <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Name + Saturation Badge */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black text-white text-sm">{profile.contractor_name}</p>
                {profile.matched_names.length > 1 && (
                  <p className="text-[10px] text-slate-600 mt-0.5">
                    +{profile.matched_names.length - 1} variante(s) encontrada(s)
                  </p>
                )}
              </div>
              {profile.is_saturated ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0"
                      style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <AlertTriangle className="w-3 h-3" />
                  Saturación Detectada
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                      style={{ background: 'rgba(74,222,128,0.12)', color: '#4ADE80' }}>
                  Activo Normal
                </span>
              )}
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl p-3 border" style={{ background: 'rgba(0,212,232,0.05)', borderColor: 'rgba(0,212,232,0.15)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Building2 className="w-3 h-3 text-slate-500" />
                  <span className="text-[9px] uppercase tracking-widest font-bold text-slate-600">Proyectos</span>
                </div>
                <p className="text-2xl font-black tabular-nums" style={{ color: profile.is_saturated ? '#EF4444' : '#00D4E8' }}>
                  {profile.total_projects}
                </p>
              </div>
              <div className="rounded-xl p-3 border border-navy-800" style={{ background: 'rgba(15,23,42,0.5)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="w-3 h-3 text-slate-500" />
                  <span className="text-[9px] uppercase tracking-widest font-bold text-slate-600">TPV Total</span>
                </div>
                <p className="text-2xl font-black text-white tabular-nums">{fmt$(profile.total_valuation)}</p>
              </div>
            </div>

            {/* State distribution */}
            {profile.by_state.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-700 mb-2">Presencia por Estado</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.by_state.map(s => (
                    <span key={s.state} className="px-2 py-1 rounded-lg text-[10px] font-bold"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8' }}>
                      {stateIcon(s.state)} {s.state} · {s.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Top ZIP Codes */}
            {profile.top_zips.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-700 mb-2">Top 5 ZIP Codes</p>
                <div className="space-y-1">
                  {profile.top_zips.map((z, i) => {
                    const pct = Math.round((z.count / profile.top_zips[0].count) * 100)
                    return (
                      <div key={z.zip} className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-700 w-3 text-right font-mono">{i + 1}</span>
                        <span className="text-[11px] font-bold text-slate-300 w-12">{z.zip}</span>
                        <div className="flex-1 h-1 rounded-full bg-navy-800 overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                               style={{ width: `${pct}%`, background: 'rgba(0,212,232,0.6)' }} />
                        </div>
                        <span className="text-[10px] text-slate-500 tabular-nums w-8 text-right">{z.count}p</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Top cities */}
            {profile.top_cities.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-700 mb-2">Ciudades Principales</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.top_cities.map(c => (
                    <span key={`${c.city}-${c.state}`} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8' }}>
                      <MapPin className="w-2.5 h-2.5 text-slate-600" />
                      {c.city}{c.state ? `, ${c.state}` : ''} · {c.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Project types */}
            {profile.top_types.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-700 mb-2">Tipos de Proyecto</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.top_types.map(t => (
                    <span key={t.type} className="px-2 py-1 rounded-lg text-[10px]"
                          style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.14)', color: '#FBB724' }}>
                      {t.type} · {t.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
