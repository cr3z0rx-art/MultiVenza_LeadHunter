import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { SyncPayload, SyncResult } from '@/lib/types/lead'

const CHUNK_SIZE = 100

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: SyncPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { leads, competitors, source_state, batch_id } = body

  if (!leads?.length && !competitors?.length) {
    return NextResponse.json({ error: 'No leads or competitors provided' }, { status: 400 })
  }
  if (!['FL', 'GA', 'IL', 'TX', 'AZ', 'NC', 'MIXED'].includes(source_state)) {
    return NextResponse.json({ error: 'Invalid source_state' }, { status: 400 })
  }

  const supabase = serviceClient()
  const result: SyncResult = { inserted: 0, updated: 0, skipped: 0, errors: [] }

  try {

  // ── Upsert in chunks (dedup on permit_number) ────────────────────────────────
  for (let i = 0; i < (leads?.length ?? 0); i += CHUNK_SIZE) {
    const chunk = leads.slice(i, i + CHUNK_SIZE).map(l => ({
      // Explicit column list — prevents schema-cache errors if payload has extra fields
      city:                l.city                ?? '',
      zip_code:            l.zip_code            ?? null,
      state:               l.state               ?? source_state,
      county:              l.county              ?? null,
      project_type:        l.project_type        ?? 'Remodel',
      estimated_valuation: l.estimated_valuation ?? 0,
      tier:                l.tier                ?? 'plata',
      score:               l.score               ?? 0,
      tags:                l.tags                ?? [],
      no_gc:               l.no_gc               ?? false,
      roof_age:            l.roof_age            ?? null,
      roof_classification: l.roof_classification ?? null,
      permit_status:       l.permit_status       ?? null,
      market_note:         l.market_note         ?? null,
      exact_address:       l.exact_address       ?? null,
      owner_name:          l.owner_name          ?? null,
      phone:               l.phone               ?? null,
      permit_number:       l.permit_number,
      permit_date:         l.permit_date         ?? null,
      government_source:   l.government_source   ?? null,
      processed_at:        l.processed_at        ?? new Date().toISOString(),
    }))

    const { data, error } = await supabase
      .from('leads')
      .upsert(chunk, { onConflict: 'permit_number', ignoreDuplicates: false })
      .select('permit_number')

    if (error) {
      console.error('[sync] leads upsert error:', error.message)
      result.errors.push(`chunk ${Math.floor(i / CHUNK_SIZE)}: ${error.message}`)
      result.skipped += chunk.length
    } else {
      result.inserted += data?.length ?? 0
    }
  }

  // ── Upsert competitors (best-effort — table may not exist yet) ───────────────
  if (competitors?.length) {
    try {
      for (let i = 0; i < competitors.length; i += CHUNK_SIZE) {
        const chunk = competitors.slice(i, i + CHUNK_SIZE).map((c: any) => ({
          permit_number:   c.permitNumber,
          state:           c.state || source_state,
          county:          c.county     ?? null,
          city:            c.city       ?? null,
          contractor_name: c.contractorName ?? null,
          project_type:    c.projectType    ?? null,
          valuation:       c.valuation      ?? 0,
          permit_date:     c.permitDate     ?? null,
        }))

        const { error } = await supabase
          .from('competitor_analysis')
          .upsert(chunk, { onConflict: 'permit_number', ignoreDuplicates: true })

        if (error) console.warn('[sync] competitor upsert skipped:', error.message)
      }
    } catch (e: any) {
      console.warn('[sync] competitor_analysis table not ready:', e.message)
    }
  }

  // ── Log sync (best-effort) ────────────────────────────────────────────────────
  try {
    await supabase.from('sync_logs').insert({
      batch_id:         batch_id ?? `auto-${Date.now()}`,
      source_state,
      records_inserted: result.inserted,
      records_updated:  result.updated,
      records_skipped:  result.skipped,
      scraper_source:   req.headers.get('x-scraper-source') ?? 'unknown',
    })
  } catch (e: any) {
    console.warn('[sync] sync_logs insert skipped:', e.message)
  }

  // ── Audit log (best-effort) ───────────────────────────────────────────────────
  try {
    let diamante_count = 0, oro_count = 0, plata_count = 0, total_revenue_potential = 0
    leads?.forEach((l: any) => {
      if (l.tier === 'diamante') diamante_count++
      else if (l.tier === 'oro') oro_count++
      else plata_count++
      total_revenue_potential += l.projected_profit || 0
    })

    await supabase.from('lead_audit_logs').insert({
      batch_id:                batch_id ?? `auto-${Date.now()}`,
      total_leads:             leads?.length || 0,
      diamante_count, oro_count, plata_count, total_revenue_potential,
      source_states:           Array.from(new Set((leads ?? []).map((l: any) => l.state || source_state))).join(', '),
    })
  } catch (e: any) {
    console.warn('[sync] lead_audit_logs insert skipped:', e.message)
  }

  return NextResponse.json(result)

  } catch (e: any) {
    console.error('[sync] Unhandled error:', e.message, e.stack)
    return NextResponse.json({ error: e.message ?? 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  
  // 1. Purge Demo Leads
  const { error: leadsError } = await supabase
    .from('leads')
    .delete()
    .or('government_source.ilike.%Demo%,project_type.ilike.%Demo%')

  // 2. Purge Demo Competitors
  const { error: compError } = await supabase
    .from('competitor_analysis')
    .delete()
    .or('contractor_name.ilike.%Demo%')

  if (leadsError || compError) {
    return NextResponse.json({ error: leadsError?.message || compError?.message }, { status: 500 })
  }

  return NextResponse.json({ message: 'Purge complete' })
}
