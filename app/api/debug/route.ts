import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { count: compCount } = await supabase.from('competitor_analysis').select('*', { count: 'exact', head: true })
  const { count: compRecent } = await supabase.from('competitor_analysis').select('*', { count: 'exact', head: true }).gte('permit_date', cutoff)
  const { count: compNullDate } = await supabase.from('competitor_analysis').select('*', { count: 'exact', head: true }).is('permit_date', null)

  return NextResponse.json({
    total: compCount,
    recent: compRecent,
    null_date: compNullDate,
    cutoff,
  })
}
