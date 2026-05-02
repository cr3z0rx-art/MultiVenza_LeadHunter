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
  const errors: string[] = []
  let cleaned = 0
  let captured = 0

  // 90-day cutoff uses created_at (when we discovered the lead), not permit_date.
  // Historical scrapers can insert permits issued months ago — those are still fresh leads.
  const cutoff90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  // ── 1. PROTOCOLO 90 DÍAS: Eliminate stale pipeline entries ────────────────
  try {
    const { count: compDeleted, error } = await supabase
      .from('competitor_analysis')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff90)
    if (error) throw error
    cleaned += compDeleted ?? 0
    log.push(`competitor_analysis: ${compDeleted ?? 0} permits > 90d deleted`)
  } catch (err: any) {
    errors.push(`step1a competitor_analysis cleanup: ${err?.message ?? err}`)
    log.push('competitor_analysis cleanup: SKIPPED (error)')
  }

  try {
    const { count: leadsDeleted, error } = await supabase
      .from('leads')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff90)
      .not('tags', 'cs', '["Captured by Competitor"]')
    if (error) throw error
    cleaned += leadsDeleted ?? 0
    log.push(`leads: ${leadsDeleted ?? 0} leads > 90d deleted (Captured records preserved)`)
  } catch (err: any) {
    errors.push(`step1b leads cleanup: ${err?.message ?? err}`)
    log.push('leads 90d cleanup: SKIPPED (error)')
  }

  // ── 2. OVERFLOW GUARD: Keep total under 20,000 ────────────────────────────
  try {
    const { count: totalCount, error: countErr } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
    if (countErr) throw countErr

    if ((totalCount ?? 0) > 20000) {
      const excess = (totalCount ?? 0) - 20000
      const { data: oldest, error: selectErr } = await supabase
        .from('leads')
        .select('id')
        .not('tags', 'cs', '["Captured by Competitor"]') // never prune captured market intel
        .order('created_at', { ascending: true })
        .limit(excess)
      if (selectErr) throw selectErr

      if (oldest?.length) {
        const ids = oldest.map((r: any) => r.id)
        for (let i = 0; i < ids.length; i += 200) {
          const { error: delErr } = await supabase
            .from('leads')
            .delete()
            .in('id', ids.slice(i, i + 200))
          if (delErr) throw delErr
        }
        log.push(`overflow guard: ${ids.length} oldest leads pruned (was ${totalCount})`)
        cleaned += ids.length
      }
    } else {
      log.push(`overflow guard: OK (${totalCount ?? 0} leads, under 20k limit)`)
    }
  } catch (err: any) {
    errors.push(`step2 overflow guard: ${err?.message ?? err}`)
    log.push('overflow guard: SKIPPED (error)')
  }

  // ── 3. MONITOR No-GC → GC: "Captured by Competitor" ─────────────────────
  try {
    const { data: noGcLeads, error: noGcErr } = await supabase
      .from('leads')
      .select('id, permit_number, contractor_name, tags, no_gc')
      .eq('no_gc', true)
      .limit(2000)
    if (noGcErr) throw noGcErr

    if (noGcLeads?.length) {
      const permitNumbers = noGcLeads.map((l: any) => l.permit_number).filter(Boolean)

      const { data: compMatches, error: compErr } = await supabase
        .from('competitor_analysis')
        .select('permit_number, contractor_name')
        .in('permit_number', permitNumbers)
        .not('contractor_name', 'is', null)
      if (compErr) throw compErr

      if (compMatches?.length) {
        const byPermit = Object.fromEntries(
          compMatches.map((c: any) => [c.permit_number, c.contractor_name])
        )

        for (const lead of noGcLeads) {
          const newContractor = byPermit[lead.permit_number]
          if (!newContractor) continue

          const tags = Array.isArray(lead.tags) ? lead.tags : []
          if (tags.includes('Captured by Competitor')) continue

          const updatedTags = [...tags, 'Captured by Competitor', `GC: ${newContractor}`]
          const { error: updateErr } = await supabase
            .from('leads')
            .update({ no_gc: false, tags: updatedTags })
            .eq('id', lead.id)
          if (updateErr) throw updateErr

          captured++
        }
      }
    }

    log.push(`No-GC monitor: ${captured} leads marked 'Captured by Competitor'`)
  } catch (err: any) {
    errors.push(`step3 no-gc monitor: ${err?.message ?? err}`)
    log.push('No-GC monitor: SKIPPED (error)')
  }

  // ── 4. Note: ArcGIS scrape is triggered by run_historical_90d.js → POST /api/sync ──

  return NextResponse.json({
    ok: errors.length === 0,
    timestamp: new Date().toISOString(),
    permits_cleaned: cleaned,
    leads_captured_by_competitor: captured,
    log,
    ...(errors.length > 0 && { errors }),
  })
}

// ── POST — manual trigger (same logic, no auth check for internal use) ───────
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const fakeReq = new NextRequest(req.url, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  return GET(fakeReq)
}
