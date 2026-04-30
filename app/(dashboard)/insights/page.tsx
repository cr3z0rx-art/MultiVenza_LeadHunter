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
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Search className="w-6 h-6 text-emerald-400" />
          Market Insights
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Inteligencia de mercado basada en permisos activos donde opera un General Contractor.
        </p>
      </header>

      {/* Global Stats */}
      <section className="bg-navy-800/50 border border-navy-700 p-6 rounded-2xl relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-transparent pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
            <TrendingUp className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm text-slate-400 font-medium uppercase tracking-widest">Total Market Volume (TPV)</h2>
            <p className="text-3xl font-black text-white mt-1 tabular-nums">
              ${(totalMarketTPV / 1_000_000).toFixed(2)}M
            </p>
            <p className="text-xs text-emerald-500 font-medium mt-1">Dinero total fluyendo hacia competidores activos</p>
          </div>
        </div>
      </section>

      {/* County Breakdowns */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {metrics.map(({ county, top10 }) => (
          <div key={county} className="bg-navy-800 border border-navy-700 rounded-2xl overflow-hidden">
            <div className="bg-navy-900/50 p-4 border-b border-navy-700 flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-slate-400" />
                {county} County
              </h3>
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-medium px-2.5 py-1 bg-navy-800 rounded-md border border-navy-700">
                Top {top10.length} GC
              </span>
            </div>
            
            <div className="p-4">
              <div className="space-y-3">
                {top10.map((gc, i) => (
                  <div key={gc.contractor_name} className="flex items-center gap-3 p-3 rounded-lg bg-navy-900/30 border border-navy-700/50 hover:border-navy-600 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center text-slate-400 font-bold text-xs border border-navy-700 shrink-0">
                      #{i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-200 truncate" title={gc.contractor_name}>
                        {gc.contractor_name}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                        <span><Building2 className="w-3 h-3 inline mr-1" />{gc.count} Permisos</span>
                        <span>•</span>
                        <span className="text-emerald-400/80 font-medium">Volumen: ${(gc.total_valuation / 1000).toFixed(1)}k</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
