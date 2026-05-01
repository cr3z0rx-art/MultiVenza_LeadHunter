import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function toCSV(data: any[]) {
  if (!data || data.length === 0) return ''
  const headers = Object.keys(data[0])
  const rows = data.map(row => 
    headers.map(header => {
      const val = row[header] === null || row[header] === undefined ? '' : String(row[header])
      return `"${val.replace(/"/g, '""')}"`
    }).join(',')
  )
  return [headers.join(','), ...rows].join('\n')
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  if (type === 'hot-leads') {
    // Triángulo de Oro:
    // 1. Estado: TX, AZ, GA, FL
    // 2. Tier: Diamante (no_gc = true)
    // 3. Rescate Ámbar (permit_date <= 60 días atrás) o en zona de Saturación Roja (simplificado: asumimos todos los diamante con urgencia)
    
    const cutoff60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    
    // Obtenemos los diamante estancados
    const { data: leads } = await supabase
      .from('leads')
      .select('permit_number, permit_date, owner_name, phone, exact_address, city, state, zip_code, estimated_valuation')
      .in('state', ['TX', 'AZ', 'GA', 'FL'])
      .or('tier.eq.diamante,no_gc.eq.true')
      .lte('permit_date', cutoff60)
      .limit(1500)
      
    // Preparar para GoHighLevel
    const ghlData = (leads || []).map(l => ({
      'First Name': l.owner_name?.split(' ')[0] || 'Dueño',
      'Last Name': l.owner_name?.split(' ').slice(1).join(' ') || '',
      'Phone': l.phone || '',
      'Email': '', // Placeholder para enrichment
      'Address': l.exact_address || '',
      'City': l.city || '',
      'State': l.state || '',
      'Postal Code': l.zip_code || '',
      'Tags': 'Hot Lead, Triangulo Oro, Diamante, Rescate Ambar',
      'Custom Field: Permit Number': l.permit_number || '',
      'Custom Field: Permit Date': l.permit_date || '',
      'Custom Field: Valuation': l.estimated_valuation || 0
    }))

    return new NextResponse(toCSV(ghlData), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="GHL_Hot_Leads_Triangulo_Oro.csv"'
      }
    })
  }

  if (type === 'b2b-texas') {
    // 10 contratistas más saturados de Texas
    // Contamos por contractor_name en estado TX
    const { data: records } = await supabase
      .from('competitor_analysis')
      .select('contractor_name, zip_code, city, state')
      .eq('state', 'TX')
      .not('contractor_name', 'is', null)
      .limit(10000)

    const gcMap: Record<string, { count: number, zips: Set<string> }> = {}
    
    for (const r of (records || [])) {
      const name = r.contractor_name.trim().toUpperCase()
      if (name === 'OWNER' || name === 'N/A' || name.length < 3) continue
      
      if (!gcMap[name]) gcMap[name] = { count: 0, zips: new Set() }
      gcMap[name].count++
      if (r.zip_code) gcMap[name].zips.add(r.zip_code)
      else if (r.city) gcMap[name].zips.add(`City: ${r.city}`)
    }

    const sortedGCs = Object.entries(gcMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([name, data]) => ({
        'Company Name': name,
        'Active Permits (Saturation)': data.count,
        'Operating Zones (ZIPs)': Array.from(data.zips).slice(0, 5).join(' | '),
        'State': 'TX',
        'Opportunity': 'Ofrecer cuadrillas de apoyo B2B'
      }))

    return new NextResponse(toCSV(sortedGCs), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="B2B_Saturated_GCs_Texas.csv"'
      }
    })
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
}
