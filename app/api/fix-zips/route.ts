import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. Fetch records where zip_code is null
  const { data: records, error } = await supabase
    .from('competitor_analysis')
    .select('permit_number, city, state')
    .is('zip_code', null)
    .limit(5000)

  if (error || !records) {
    return NextResponse.json({ error: error?.message || 'No records found' })
  }

  let updated = 0
  const updates = []

  // 2. Extract ZIP from city if present (e.g. "TAMPA 33602")
  for (const r of records) {
    if (r.city) {
      const match = r.city.match(/\b(\d{5})\b/)
      if (match) {
        const zip = match[1]
        const newCity = r.city.replace(zip, '').trim()
        updates.push({
          permit_number: r.permit_number,
          zip_code: zip,
          city: newCity
        })
      }
    }
  }

  // 3. Batch update
  if (updates.length > 0) {
    // Upsert using the same table (we just provide the primary key and the updated fields)
    const { error: updateError } = await supabase
      .from('competitor_analysis')
      .upsert(updates, { onConflict: 'permit_number' })

    if (updateError) {
      return NextResponse.json({ error: updateError.message })
    }
    updated = updates.length
  }

  return NextResponse.json({
    total_processed: records.length,
    updated_records: updated,
    sample_updates: updates.slice(0, 10)
  })
}
