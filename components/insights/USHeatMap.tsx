'use client'

import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { useState } from 'react'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'

const STATE_NAMES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR',
  California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS',
  Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
}

export type ViewMode = 'diamante' | 'saturacion' | 'rescate'

export interface StateMapData {
  state:      string
  permits90d: number
  diamante:   number
  overloaded: number
  stale:      number
  topGC:      string | null
}

interface Props {
  data: StateMapData[]
}

function fillColor(d: StateMapData | undefined, mode: ViewMode): string {
  if (!d || d.permits90d === 0) return 'rgba(13,20,32,0.9)'

  if (mode === 'diamante') {
    const n = d.diamante
    if (n === 0)  return 'rgba(30,41,59,0.7)'
    if (n <= 3)   return 'rgba(22,163,74,0.45)'
    if (n <= 15)  return 'rgba(22,163,74,0.75)'
    return 'rgba(22,163,74,1)'
  }

  if (mode === 'saturacion') {
    const n = d.overloaded
    if (n === 0)  return 'rgba(30,41,59,0.7)'
    if (n <= 2)   return 'rgba(251,191,36,0.55)'
    if (n <= 5)   return 'rgba(249,115,22,0.75)'
    return 'rgba(239,68,68,0.9)'
  }

  const n = d.stale
  if (n === 0)  return 'rgba(30,41,59,0.7)'
  if (n <= 5)   return 'rgba(251,191,36,0.4)'
  if (n <= 20)  return 'rgba(251,191,36,0.75)'
  return 'rgba(251,191,36,1)'
}

function strokeColor(d: StateMapData | undefined, mode: ViewMode): string {
  if (!d || d.permits90d === 0) return 'rgba(30,41,59,0.4)'
  if (mode === 'diamante'   && d.diamante   > 0) return 'rgba(22,163,74,0.5)'
  if (mode === 'saturacion' && d.overloaded > 0) return 'rgba(239,68,68,0.35)'
  if (mode === 'rescate'    && d.stale      > 0) return 'rgba(251,191,36,0.45)'
  return 'rgba(30,41,59,0.55)'
}

const MODES = [
  { key: 'diamante'   as ViewMode, emoji: '💎', label: 'Oportunidad', desc: 'Leads Diamante (No-GC)' },
  { key: 'saturacion' as ViewMode, emoji: '🔴', label: 'Saturación',  desc: 'GCs sobrecargados ≥15p' },
  { key: 'rescate'    as ViewMode, emoji: '⏰', label: 'Rescate',     desc: 'Proyectos >30d sin cierre' },
]

export default function USHeatMap({ data }: Props) {
  const [mode, setMode]       = useState<ViewMode>('diamante')
  const [hovered, setHovered] = useState<string | null>(null)

  const byState    = Object.fromEntries(data.map(d => [d.state, d]))
  const hoveredData = hovered ? byState[hovered] : null

  return (
    <div className="space-y-4">

      {/* Mode switcher */}
      <div className="flex items-center gap-2 flex-wrap">
        {MODES.map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all border"
            style={mode === m.key
              ? { background: 'rgba(251,191,36,0.12)', color: '#FBB724', borderColor: 'rgba(251,191,36,0.3)' }
              : { background: 'rgba(30,41,59,0.5)',    color: '#64748b', borderColor: 'rgba(255,255,255,0.05)' }
            }
          >
            {m.emoji} {m.label}
          </button>
        ))}
        <span className="text-[10px] text-slate-700 ml-1">
          {MODES.find(m => m.key === mode)?.desc}
        </span>
      </div>

      {/* Map + Detail panel */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-4 items-start">

        {/* Map */}
        <div className="bg-navy-900/40 rounded-2xl border border-navy-800 overflow-hidden p-1">
          <ComposableMap
            projection="geoAlbersUsa"
            style={{ width: '100%', height: 'auto' }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map(geo => {
                  const abbr = STATE_NAMES[geo.properties.name as string]
                  const d    = abbr ? byState[abbr] : undefined
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={fillColor(d, mode)}
                      stroke={strokeColor(d, mode)}
                      strokeWidth={0.6}
                      style={{
                        default: { outline: 'none' },
                        hover:   { outline: 'none', filter: 'brightness(1.35) drop-shadow(0 0 4px rgba(251,191,36,0.3))' },
                        pressed: { outline: 'none' },
                      }}
                      onMouseEnter={() => abbr && setHovered(abbr)}
                      onMouseLeave={() => setHovered(null)}
                    />
                  )
                })
              }
            </Geographies>
          </ComposableMap>
        </div>

        {/* State detail card */}
        <div className="bg-navy-900/40 rounded-2xl border border-navy-800 p-5 h-full min-h-[200px] flex flex-col justify-center">
          {hoveredData ? (
            <div className="space-y-3">
              <div>
                <p className="text-2xl font-black text-white">{hoveredData.state}</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-600">Últimos 90 días</p>
              </div>

              <div className="space-y-1.5">
                <Row label="Total permisos" value={hoveredData.permits90d.toLocaleString()} color="text-white" />
                <Row label="💎 Diamante (No-GC)" value={hoveredData.diamante.toString()} color="text-[#00D4E8]" />
                <Row label="🔴 GCs sobrecargados" value={hoveredData.overloaded.toString()} color="text-red-400" />
                <Row label="⏰ Estancados >30d" value={hoveredData.stale.toString()} color="text-amber-400" />
              </div>

              {hoveredData.topGC && (
                <div className="pt-2 border-t border-navy-800">
                  <p className="text-[9px] uppercase tracking-[0.2em] text-slate-700 mb-1">Top GC dominante</p>
                  <p className="text-[11px] font-bold text-slate-300 truncate">{hoveredData.topGC}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4 space-y-2">
              <p className="text-3xl">🗺️</p>
              <p className="text-slate-500 text-sm leading-relaxed">
                Pasa el mouse<br />sobre un estado<br />para ver detalles
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 text-[10px] text-slate-600 flex-wrap">
        {mode === 'diamante' && (
          <>
            <Legend color="rgba(22,163,74,0.45)"  label="1–3 permisos" />
            <Legend color="rgba(22,163,74,0.75)"  label="4–15 permisos" />
            <Legend color="rgba(22,163,74,1)"     label="16+ permisos" />
            <Legend color="rgba(13,20,32,0.9)"    label="Sin datos" />
          </>
        )}
        {mode === 'saturacion' && (
          <>
            <Legend color="rgba(251,191,36,0.55)" label="1–2 GCs sat." />
            <Legend color="rgba(249,115,22,0.75)" label="3–5 GCs sat." />
            <Legend color="rgba(239,68,68,0.9)"   label="6+ GCs sat." />
          </>
        )}
        {mode === 'rescate' && (
          <>
            <Legend color="rgba(251,191,36,0.4)"  label="1–5 est." />
            <Legend color="rgba(251,191,36,0.75)" label="6–20 est." />
            <Legend color="rgba(251,191,36,1)"    label="21+ est." />
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-navy-800/50">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: color }} />
      {label}
    </span>
  )
}
