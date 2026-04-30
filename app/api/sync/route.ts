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

  // ── Upsert in chunks (dedup on permit_number) ────────────────────────────────
  for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
    const chunk = leads.slice(i, i + CHUNK_SIZE).map(l => ({
      // Explicit column list — prevents schema-cache errors if payload has extra fields
      city:                l.city                ?? '',
      zip_code:            l.zip_code            ?? null,
      state:               l.state               ?? source_state,
      county:              l.county              ?? null,
      project_type:        l.project_type        ?? 'Remodel',
      estimated_valuation: l.estimated_valuation ?? 0,
      projected_profit:    l.projected_profit    ?? 0,
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
      .select('id')

    if (error) {
      result.errors.push(`chunk ${Math.floor(i / CHUNK_SIZE)}: ${error.message}`)
      result.skipped += chunk.length
    } else {
      result.inserted += data?.length ?? 0
    }
  }

  // ── Upsert competitors ───────────────────────────────────────────────────────
  if (competitors?.length) {
    for (let i = 0; i < competitors.length; i += CHUNK_SIZE) {
      const chunk = competitors.slice(i, i + CHUNK_SIZE).map((c: any) => ({
        batch_id:        batch_id ?? `auto-${Date.now()}`,
        permit_number:   c.permitNumber,
        state:           c.state || source_state,
        county:          c.county,
        city:            c.city,
        contractor_name: c.contractorName,
        project_type:    c.projectType,
        valuation:       c.valuation,
        permit_date:     c.permitDate
      }));
      
      const { data, error } = await supabase
        .from('competitor_analysis')
        .upsert(chunk, { onConflict: 'permit_number', ignoreDuplicates: true })
        .select('id');
        
      if (error) {
        result.errors.push(`competitor chunk: ${error.message}`);
      } else {
        result.inserted += data?.length ?? 0
      }
    }
  }

  // ── Log sync ─────────────────────────────────────────────────────────────────
  await supabase.from('sync_logs').insert({
    batch_id:         batch_id ?? `auto-${Date.now()}`,
    source_state,
    records_inserted: result.inserted,
    records_updated:  result.updated,
    records_skipped:  result.skipped,
    scraper_source:   req.headers.get('x-scraper-source') ?? 'unknown',
  })

  let diamante_count = 0;
  let oro_count = 0;
  let plata_count = 0;
  let total_revenue_potential = 0;

  if (leads) {
    leads.forEach((l: any) => {
      if (l.tier === 'diamante') diamante_count++;
      else if (l.tier === 'oro') oro_count++;
      else plata_count++;
      
      total_revenue_potential += l.projected_profit || 0;
    });
  }

  await supabase.from('lead_audit_logs').insert({
    batch_id: batch_id ?? `auto-${Date.now()}`,
    total_leads: leads?.length || 0,
    diamante_count,
    oro_count,
    plata_count,
    total_revenue_potential,
    source_states: Array.from(new Set(leads?.map((l: any) => l.state || source_state) || [])).join(', ')
  });

  return NextResponse.json(result)
}
