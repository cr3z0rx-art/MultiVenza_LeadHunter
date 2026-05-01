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
  if (v < 15000) return "Small"
  if (v <= 100000) return "Medium"
  return "High"
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const targetTable = searchParams.get('table') || 'competitor_analysis'
  
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Primero verificar que exista investment_range en la tabla objetivo
  const { error: checkError } = await supabase.from(targetTable).select('investment_range').limit(1)
  if (checkError && checkError.message.includes('does not exist')) {
    return NextResponse.json({
      error: 'CRITICAL_MISSING_COLUMN',
      message: `La columna investment_range no existe en ${targetTable}. Creala en Supabase (tipo text) antes de ejecutar el Scrubbing.`
    }, { status: 400 })
  }

  // Fetch records that don't have investment_range yet OR haven't been processed
  // Para simplificar el "Pulido", buscaremos los que tengan investment_range null o que no sean Small/Medium/High
  const { data: records, error } = await supabase
    .from(targetTable)
    .select('*')
    .not('investment_range', 'in', '("Small","Medium","High")')
    .limit(1000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const toUpdate = []
  const toDelete = []
  const seenKeys = new Set<string>()

  for (const r of (records || [])) {
    // Normalización de campos comunes
    const updatedRecord: any = { id: r.id }
    
    if (r.contractor_name) updatedRecord.contractor_name = cleanString(r.contractor_name)
    if (r.owner_name) updatedRecord.owner_name = cleanString(r.owner_name)
    if (r.city) updatedRecord.city = cleanString(r.city)
    if (r.exact_address) updatedRecord.exact_address = cleanString(r.exact_address)
    if (r.address) updatedRecord.address = cleanString(r.address)
    
    // Zip code extraction (if missing)
    let z = r.zip_code ? String(r.zip_code).trim() : ''
    if (!z || z.toLowerCase() === 'null') {
      const cityField = r.city || ''
      const nameField = r.contractor_name || r.owner_name || ''
      const addrField = r.exact_address || r.address || ''
      const match = cityField.match(/\b(\d{5})\b/) || nameField.match(/\b(\d{5})\b/) || addrField.match(/\b(\d{5})\b/)
      z = match ? match[1] : ''
    }
    if (z) updatedRecord.zip_code = z

    // Valuation / Range
    const val = r.valuation || r.estimated_valuation || 0
    updatedRecord.investment_range = getInvestmentRange(val)

    // Deduplication key
    const addr = r.exact_address || r.address || r.city || ''
    const proj = r.project_type || ''
    const dedupKey = `${cleanString(addr)}_${cleanString(proj)}`.toLowerCase()
    
    if (seenKeys.has(dedupKey)) {
      toDelete.push(r.id)
    } else {
      seenKeys.add(dedupKey)
      toUpdate.push(updatedRecord)
    }
  }

  // Process Deletions
  if (toDelete.length > 0) {
    for (let i = 0; i < toDelete.length; i += 200) {
      const chunk = toDelete.slice(i, i + 200)
      await supabase.from(targetTable).delete().in('id', chunk)
    }
  }

  // Process Updates
  if (toUpdate.length > 0) {
    for (let i = 0; i < toUpdate.length; i += 200) {
      const chunk = toUpdate.slice(i, i + 200)
      const { error: upsertError } = await supabase.from(targetTable).upsert(chunk)
      if (upsertError) {
        return NextResponse.json({ error: 'Upsert failed', details: upsertError }, { status: 500 })
      }
    }
  }

  return NextResponse.json({
    table: targetTable,
    scanned: records?.length || 0,
    duplicates_deleted: toDelete.length,
    records_updated: toUpdate.length,
    sample: toUpdate.slice(0, 2)
  })
}
