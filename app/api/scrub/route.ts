import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function cleanString(text: string | null) {
  if (!text) return null
  // Alphanum, spaces, hyphens, periods, commas. No weird symbols.
  let cleaned = text.replace(/[^\w\s,\.\-\#]/g, '').trim()
  // Title case
  return cleaned.replace(
    /\w\S*/g,
    function(txt) {
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    }
  )
}

function getInvestmentRange(val: number | null | string) {
  const v = Number(val) || 0
  if (v < 15000) return "Micro-proyecto"
  if (v <= 50000) return "Remodelación Estándar"
  if (v <= 250000) return "Alto Valor"
  return "Comercial / Lujo"
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Primero verificar que exista investment_range
  const { error: checkError } = await supabase.from('competitor_analysis').select('investment_range').limit(1)
  if (checkError && checkError.message.includes('does not exist')) {
    return NextResponse.json({
      error: 'CRITICAL_MISSING_COLUMN',
      message: 'La columna investment_range no existe en competitor_analysis. Creala en Supabase (tipo text) antes de ejecutar el Scrubbing.'
    }, { status: 400 })
  }

  // Fetch all leads 
  // (Debido al límite de PostgREST, procesaremos un chunk de hasta 5000)
  const { data: records, error } = await supabase
    .from('competitor_analysis')
    .select('id, permit_number, contractor_name, city, state, zip_code, valuation, project_type')
    .is('investment_range', null)
    .limit(1000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const toUpdate = []
  const toDelete = []
  const seenKeys = new Set<string>()

  for (const r of (records || [])) {
    const cName = cleanString(r.contractor_name)
    const city = cleanString(r.city)
    
    // Zip code extraction (if missing)
    let z = r.zip_code ? String(r.zip_code).trim() : ''
    if (!z || z.toLowerCase() === 'null') {
      const match = (r.city || '').match(/\b(\d{5})\b/) || (r.contractor_name || '').match(/\b(\d{5})\b/)
      z = match ? match[1] : ''
    }

    const invRange = getInvestmentRange(r.valuation)

    // Deduplication key (contractor + city + project_type)
    const dedupKey = `${cName}_${city}_${cleanString(r.project_type)}`.toLowerCase()
    
    if (seenKeys.has(dedupKey)) {
      toDelete.push(r.id)
    } else {
      seenKeys.add(dedupKey)
      toUpdate.push({
        id: r.id,
        permit_number: r.permit_number,
        contractor_name: cName,
        city: city,
        zip_code: z || null,
        investment_range: invRange
      })
    }
  }

  // Process Deletions
  if (toDelete.length > 0) {
    // Supabase can delete using 'in'
    for (let i = 0; i < toDelete.length; i += 200) {
      const chunk = toDelete.slice(i, i + 200)
      await supabase.from('competitor_analysis').delete().in('id', chunk)
    }
  }

  // Process Updates
  if (toUpdate.length > 0) {
    for (let i = 0; i < toUpdate.length; i += 500) {
      const chunk = toUpdate.slice(i, i + 500)
      const { error: upsertError } = await supabase.from('competitor_analysis').upsert(chunk, { onConflict: 'permit_number' })
      if (upsertError) {
        return NextResponse.json({ error: 'Upsert failed', details: upsertError }, { status: 500 })
      }
    }
  }

  return NextResponse.json({
    scanned: records?.length || 0,
    duplicates_deleted: toDelete.length,
    records_updated: toUpdate.length,
    sample: toUpdate.slice(0, 3)
  })
}
