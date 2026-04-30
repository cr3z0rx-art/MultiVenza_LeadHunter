import { createAdminClient } from '@/lib/supabase/admin'
import { Building2, TrendingUp, MapPin, Search } from 'lucide-react'

export const metadata = {
  title: 'Market Insights | MultiVenza LeadHunter',
}

interface Competitor {
  contractor_name: string
  count: number
  total_valuation: number
}

async function getMarketInsights() {
  const supabase = createAdminClient()
  
  // Extraer todos los competidores
  const { data, error } = await supabase
    .from('competitor_analysis')
    .select('contractor_name, county, valuation')
    .order('valuation', { ascending: false })
    .limit(1000)
    
  if (error || !data) return { metrics: [], totalMarketTPV: 0 }
  
  let totalMarketTPV = 0
  const countyMap: Record<string, Record<string, Competitor>> = {}

  for (const row of data) {
    const county = row.county || 'Desconocido'
    const name = row.contractor_name || 'Desconocido'
    const val = Number(row.valuation) || 0
    
    totalMarketTPV += val
    
    if (!countyMap[county]) countyMap[county] = {}
    if (!countyMap[county][name]) {
      countyMap[county][name] = { contractor_name: name, count: 0, total_valuation: 0 }
    }
    countyMap[county][name].count += 1
    countyMap[county][name].total_valuation += val
  }
  
  const metrics = Object.entries(countyMap).map(([county, contractors]) => {
    const top10 = Object.values(contractors)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
    return { county, top10 }
  }).sort((a, b) => b.top10.length - a.top10.length)

  return { metrics, totalMarketTPV }
}

export default async function InsightsPage() {
  const { metrics, totalMarketTPV } = await getMarketInsights()

  if (!metrics || metrics.length === 0) {
    return (
      <div className="p-8 text-center animate-in fade-in duration-500">
        <div className="max-w-md mx-auto bg-navy-800 border border-navy-700 p-12 rounded-3xl">
          <div className="w-16 h-16 bg-navy-900 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-navy-700">
            <Search className="w-8 h-8 text-slate-500" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Sin Datos de Inteligencia</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            Todavía no hay suficiente data de competidores en la base de datos. 
            Ejecuta una barrida con contratistas para poblar esta sección.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-navy-950/50">
      <div className="p-6 md:p-10 max-w-[1400px] mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-navy-800 pb-8">
          <div>
            <h1 className="text-3xl font-black text-white flex items-center gap-3 tracking-tight">
              <Search className="w-8 h-8 text-emerald-400" />
              Market Insights
            </h1>
            <p className="text-slate-400 mt-2 max-w-xl text-sm leading-relaxed">
              Inteligencia competitiva basada en permisos donde opera un contratista general (GC). 
              Analizamos el volumen total por condado para identificar líderes del mercado.
            </p>
          </div>
          <div className="px-4 py-2 rounded-xl bg-navy-800/50 border border-navy-700 text-[10px] uppercase tracking-[0.2em] font-bold text-slate-500">
            Actualizado: {new Date().toLocaleDateString()}
          </div>
        </header>

        {/* Global Stats Card */}
        <section className="bg-navy-800/30 border border-navy-700/50 p-8 rounded-[2rem] relative overflow-hidden backdrop-blur-sm">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-[80px] -mr-32 -mt-32" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-8">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-2xl shadow-emerald-500/10">
              <TrendingUp className="w-8 h-8 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-[11px] text-slate-500 font-bold uppercase tracking-[0.3em]">Total Market Volume (TPV)</h2>
              <div className="flex items-baseline gap-2 mt-1">
                <p className="text-5xl font-black text-white tracking-tighter tabular-nums">
                  ${(totalMarketTPV / 1_000_000).toFixed(2)}M
                </p>
                <span className="text-emerald-500 text-sm font-bold uppercase tracking-widest">USD</span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Capital total identificado en proyectos con contratistas activos
              </p>
            </div>
          </div>
        </section>

        {/* County Breakdowns Grid */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {metrics.map(({ county, top10 }) => (
            <div key={county} className="bg-navy-900/40 border border-navy-800 rounded-[1.5rem] overflow-hidden hover:border-navy-700/50 transition-all group">
              <div className="bg-navy-800/40 p-5 border-b border-navy-800 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-navy-900 flex items-center justify-center border border-navy-700">
                    <MapPin className="w-4 h-4 text-slate-500" />
                  </div>
                  {county} County
                </h3>
                <span className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold px-3 py-1.5 bg-emerald-500/5 rounded-full border border-emerald-500/20">
                  TOP {top10.length} LÍDERES
                </span>
              </div>
              
              <div className="p-6">
                <div className="space-y-3">
                  {top10.map((gc, i) => (
                    <div key={gc.contractor_name} className="flex items-center gap-4 p-4 rounded-2xl bg-navy-800/20 border border-navy-800/50 hover:bg-navy-800/40 hover:border-navy-700 transition-all">
                      <div className="w-10 h-10 rounded-xl bg-navy-900 flex items-center justify-center text-slate-500 font-black text-xs border border-navy-800 shrink-0 group-hover:border-navy-700">
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-200 truncate uppercase tracking-tight" title={gc.contractor_name}>
                          {gc.contractor_name}
                        </p>
                        <div className="flex items-center gap-4 mt-1.5">
                          <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-slate-600" />
                            {gc.count} Permisos
                          </span>
                          <span className="w-1 h-1 rounded-full bg-navy-700" />
                          <span className="text-[11px] text-emerald-400 font-bold tabular-nums">
                            VAL: ${(gc.total_valuation / 1000).toFixed(1)}k
                          </span>
                        </div>
                      </div>
                      <div className="hidden sm:block">
                        <div className="h-1.5 w-24 bg-navy-900 rounded-full overflow-hidden border border-navy-800">
                          <div 
                            className="h-full bg-emerald-500/40" 
                            style={{ width: `${Math.min(100, (gc.total_valuation / (top10[0].total_valuation || 1)) * 100)}%` }} 
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
