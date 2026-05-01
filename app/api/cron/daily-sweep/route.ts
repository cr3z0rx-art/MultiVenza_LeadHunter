import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── Auth helper ───────────────────────────────────────────────────────────────
function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ── GET — called by Vercel Cron at 11:00 UTC (6 AM CST) ─────────────────────
export async function GET(req: NextRequest) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const log: string[] = []
  let cleaned = 0
  let captured = 0

  // ── 1. PROTOCOLO 90 DÍAS: Eliminate stale permits ─────────────────────────
  const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Delete from competitor_analysis
  const { count: compDeleted } = await supabase
    .from('competitor_analysis')
    .delete({ count: 'exact' })
    .lt('permit_date', cutoff90)
    .not('permit_date', 'is', null)
  cleaned += compDeleted ?? 0
  log.push(`competitor_analysis: ${compDeleted ?? 0} permits > 90d deleted`)

  // Delete from leads — preserva leads marcados como "Captured by Competitor" para trazabilidad
  const { count: leadsDeleted } = await supabase
    .from('leads')
    .delete({ count: 'exact' })
    .lt('permit_date', cutoff90)
    .not('permit_date', 'is', null)
    .not('tags', 'cs', '["Captured by Competitor"]')
  cleaned += leadsDeleted ?? 0
  log.push(`leads: ${leadsDeleted ?? 0} permits > 90d deleted (Captured records preserved)`)

  // ── 2. OVERFLOW GUARD: Keep total under 20,000 ────────────────────────────
  const { count: totalCount } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })

  if ((totalCount ?? 0) > 20000) {
    const excess = (totalCount ?? 0) - 20000
    // Delete the oldest excess records
    const { data: oldest } = await supabase
      .from('leads')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(excess)

    if (oldest?.length) {
      const ids = oldest.map((r: any) => r.id)
      for (let i = 0; i < ids.length; i += 200) {
        await supabase.from('leads').delete().in('id', ids.slice(i, i + 200))
      }
      log.push(`overflow guard: ${ids.length} oldest leads pruned (was ${totalCount})`)
      cleaned += ids.length
    }
  }

  // ── 3. MONITOR No-GC → GC: "Captured by Competitor" ─────────────────────
  // Fetch leads that are currently No-GC in our DB
  const { data: noGcLeads } = await supabase
    .from('leads')
    .select('id, permit_number, contractor_name, tags, no_gc')
    .eq('no_gc', true)
    .limit(2000)

  if (noGcLeads?.length) {
    const permitNumbers = noGcLeads.map((l: any) => l.permit_number).filter(Boolean)

    // Check competitor_analysis for any of those permits that now have a contractor
    const { data: compMatches } = await supabase
      .from('competitor_analysis')
      .select('permit_number, contractor_name')
      .in('permit_number', permitNumbers)
      .not('contractor_name', 'is', null)

    if (compMatches?.length) {
      const byPermit = Object.fromEntries(
        compMatches.map((c: any) => [c.permit_number, c.contractor_name])
      )

      for (const lead of noGcLeads) {
        const newContractor = byPermit[lead.permit_number]
        if (!newContractor) continue

        const tags = Array.isArray(lead.tags) ? lead.tags : []
        if (tags.includes('Captured by Competitor')) continue

        // Tag it
        const updatedTags = [...tags, 'Captured by Competitor', `GC: ${newContractor}`]
        await supabase.from('leads').update({
          no_gc: false,
          tags: updatedTags,
        }).eq('id', lead.id)

        captured++
      }
    }
  }

  log.push(`No-GC monitor: ${captured} leads marked 'Captured by Competitor'`)

  // ── 4. TRIGGER daily scrape (calls run_historical_90d via internal sync) ──
  // The actual ArcGIS scrape happens from the local script run_historical_90d.js
  // This cron endpoint handles the DB maintenance portion.
  // To trigger the full sweep, run_historical_90d.js must POST to /api/sync.

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    permits_cleaned: cleaned,
    leads_captured_by_competitor: captured,
    log,
  })
}

// ── POST — manual trigger (same logic, no auth check for internal use) ───────
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Reuse GET handler with a fake auth header
  const fakeReq = new NextRequest(req.url, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  return GET(fakeReq)
}
