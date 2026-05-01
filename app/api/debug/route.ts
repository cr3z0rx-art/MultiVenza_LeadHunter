import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { count: compCount } = await supabase.from('competitor_analysis').select('*', { count: 'exact', head: true })
  const { count: leadsCount } = await supabase.from('leads').select('*', { count: 'exact', head: true })

  return NextResponse.json({
    competitor_analysis: compCount,
    leads: leadsCount,
  })
}
