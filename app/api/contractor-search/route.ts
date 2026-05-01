import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const query = (searchParams.get('q') || '').trim()

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Search competitor_analysis for partial match (ilike)
  const { data, error } = await supabase
    .from('competitor_analysis')
    .select('contractor_name, city, state, zip_code, valuation, project_type')
    .ilike('contractor_name', `%${query}%`)
    .limit(2000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ results: [] })

  // --- Aggregate data ---
  const totalProjects = data.length
  const totalValuation = data.reduce((s, r) => s + (Number(r.valuation) || 0), 0)

  // By state
  const byState: Record<string, number> = {}
  for (const r of data) {
    const s = (r.state as string) || 'Unknown'
    byState[s] = (byState[s] ?? 0) + 1
  }

  // By city
  const byCity: Record<string, { count: number; state: string }> = {}
  for (const r of data) {
    const c = ((r.city as string) || 'Unknown').trim()
    const s = (r.state as string) || ''
    if (!byCity[c]) byCity[c] = { count: 0, state: s }
    byCity[c].count++
  }

  // By ZIP
  const byZip: Record<string, number> = {}
  for (const r of data) {
    const z = (r.zip_code as string) || ''
    if (!z) continue
    byZip[z] = (byZip[z] ?? 0) + 1
  }

  // Top 5 ZIPs
  const topZips = Object.entries(byZip)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([zip, count]) => ({ zip, count }))

  // Top cities
  const topCities = Object.entries(byCity)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([city, { count, state }]) => ({ city, state, count }))

  // Project types
  const byType: Record<string, number> = {}
  for (const r of data) {
    const t = (r.project_type as string) || 'Unknown'
    byType[t] = (byType[t] ?? 0) + 1
  }

  const topTypes = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([type, count]) => ({ type, count }))

  // Unique company names that matched (for autocomplete)
  const uniqueNames = Array.from(new Set(data.map(r => (r.contractor_name as string) || ''))).slice(0, 5)

  return NextResponse.json({
    contractor_name: uniqueNames[0] || query,
    matched_names: uniqueNames,
    total_projects: totalProjects,
    total_valuation: totalValuation,
    is_saturated: totalProjects >= 10,
    by_state: Object.entries(byState)
      .sort((a, b) => b[1] - a[1])
      .map(([state, count]) => ({ state, count })),
    top_cities: topCities,
    top_zips: topZips,
    top_types: topTypes,
  })
}
