'use strict';

/**
 * scripts/lib/saas_sync.js
 *
 * Módulo compartido: sincroniza leads FL e IL al SaaS API (POST /api/sync).
 *
 * Variables de entorno requeridas:
 *   SAAS_API_URL   — URL base de la app (ej: https://tu-app.vercel.app)
 *   SAAS_API_KEY   — Clave secreta configurada como SYNC_API_KEY en el SaaS
 *
 * Opcional:
 *   SAAS_SCRAPER_SOURCE — string identificador del scraper
 *
 * Uso desde run_diamond_leads.js:
 *   const { syncFLLeads } = require('./lib/saas_sync');
 *   await syncFLLeads(leads, batchId);
 *
 * Uso desde extract_chicago.js:
 *   const { syncILLeads } = require('./lib/saas_sync');
 *   await syncILLeads(results, batchId);
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const SAAS_API_URL   = (process.env.SAAS_API_URL || '').replace(/\/$/, '');
const SAAS_API_KEY   = process.env.SAAS_API_KEY || '';
const SCRAPER_SOURCE = process.env.SAAS_SCRAPER_SOURCE || 'multivenza-leadhunter';

// ── Tier ──────────────────────────────────────────────────────────────────────

/** Diamond si TPV > $15k (regla del SaaS). */
function _tier(tpv) {
  if (tpv > 15_000) return 'diamond';
  if (tpv > 5_000)  return 'premium';
  return 'standard';
}

// ── Mappers ───────────────────────────────────────────────────────────────────

const _FL_CATEGORY_MAP = {
  roofing:      'Roofing',
  cgc:          'CGC',
  homeBuilders: 'New Construction',
  other:        'Remodel',
};

/**
 * Convierte un lead FL procesado (output de Processor.run) al shape del SaaS API.
 * @param {object} lead  — lead object de processor.js
 */
function _mapFLLead(lead) {
  // totalProjectValue incluye el piso de $250k para ciudades PREMIUM — es el
  // valor real del contrato, que el SaaS debe mostrar como estimated_valuation
  const tpv = lead.projectValue?.totalProjectValue ?? lead.valuation ?? 0;

  return {
    city:                lead.city         || '',
    zip_code:            lead.zip          || null,
    state:               'FL',
    county:              lead.county       || null,
    project_type:        _FL_CATEGORY_MAP[lead.category] || 'Remodel',
    estimated_valuation: tpv,
    tier:                _tier(tpv),
    score:               lead.score        ?? 0,
    tags:                lead.tags         ?? [],
    no_gc:               lead.flags?.noGC  ?? false,
    roof_age:            lead.roofAnalysis?.age            ?? null,
    roof_classification: lead.roofAnalysis?.classification ?? null,
    permit_status:       lead.status       || null,
    market_note:         lead.urgency?.message             ?? null,
    // Dirección normalizada preferida sobre la raw
    exact_address:       lead.addressFormatted || lead.address || null,
    owner_name:          lead.ownerName    || null,
    phone:               null,   // se llenará vía Outscraper / BatchData en paso posterior
    contractor_name:     lead.contractorName || null,
    permit_number:       lead.permitNumber,
    permit_date:         lead.permitDate   || null,
    government_source:   lead.source       || null,
    processed_at:        lead.processedAt  || new Date().toISOString(),
  };
}

const _IL_TYPE_MAP = {
  'PORCH_CONSTRUCTION':   'Remodel',
  'BASEMENT_FINISHING':   'Remodel',
  'COMMERCIAL_BUILD-OUT': 'CGC',
  'ROOFING':              'Roofing',
  'COMMERCIAL_BUILDOUT':  'CGC',
};

// Nombres IL que son claramente placeholders
const _FAKE_IL_OWNERS = new Set([
  '', 'n/a', 'none', 'unknown', 'chicago client 0', 'chicago client 1',
  'chicago client 2', 'chicago client 3', 'chicago client 4',
]);

/**
 * Convierte un lead IL (output de extract_chicago.js) al shape del SaaS API.
 * @param {object} lead
 */
function _mapILLead(lead) {
  const valuation    = parseFloat(lead.Valuation || 0);
  const projectType  = _IL_TYPE_MAP[lead.Fast_Cash_Type] || 'Remodel';

  const rawOwner = (lead.Owner_Name || '').trim().toLowerCase();
  const owner    = _FAKE_IL_OWNERS.has(rawOwner) ? null : lead.Owner_Name;

  return {
    city:                lead.City      || '',
    zip_code:            lead.ZIP       || null,
    state:               'IL',
    county:              lead.County    || null,
    project_type:        projectType,
    estimated_valuation: valuation,
    tier:                _tier(valuation),
    score:               _ilScore(lead, valuation),
    tags:                ['IL', lead.Is_Chicago ? 'CHICAGO' : null].filter(Boolean),
    no_gc:               false,
    roof_age:            null,
    roof_classification: null,
    permit_status:       lead.Status    || null,
    market_note:         null,
    exact_address:       lead.Address   || null,
    owner_name:          owner,
    phone:               null,
    contractor_name:     null,
    permit_number:       lead.Permit_Number,
    permit_date:         lead.Fecha_Permiso || null,
    government_source:   'Chicago Data Portal (Cook County)',
    processed_at:        new Date().toISOString(),
  };
}

function _ilScore(lead, valuation) {
  let s = 10;
  const type = (lead.Fast_Cash_Type || '').toUpperCase();
  if (type.includes('COMMERCIAL'))  s += 15;
  if (type.includes('ROOFING'))     s += 20;
  if (valuation > 50_000) s += 15;
  else if (valuation > 15_000) s += 10;
  return Math.min(s, 100);
}

// ── HTTP helper (sin dependencias externas) ───────────────────────────────────

function _postJSON(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = JSON.stringify(body);
    const lib     = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method:   'POST',
      headers: {
        'Content-Type':   'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    };

    const req = lib.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Core sync ─────────────────────────────────────────────────────────────────

async function _sync(mappedLeads, state, batchId) {
  if (!SAAS_API_URL || !SAAS_API_KEY) {
    console.warn('[saas_sync] ⚠️  SAAS_API_URL o SAAS_API_KEY no configurados — sync omitido');
    console.warn('            Agrega estas variables a .env para activar la sincronización');
    return null;
  }

  if (!mappedLeads.length) {
    console.warn(`[saas_sync] No hay leads ${state} para sincronizar`);
    return null;
  }

  const url     = `${SAAS_API_URL}/api/sync`;
  const payload = {
    source_state: state,
    batch_id:     batchId || `${state}-${new Date().toISOString().slice(0, 10)}`,
    leads:        mappedLeads,
  };

  console.log(`\n[saas_sync] → Enviando ${mappedLeads.length} leads (${state}) a ${url} ...`);

  try {
    const res = await _postJSON(url, payload, {
      'x-api-key':        SAAS_API_KEY,
      'x-scraper-source': SCRAPER_SOURCE,
    });

    if (res.status === 200) {
      const { inserted = 0, updated = 0, skipped = 0, errors = [] } = res.body;
      console.log(`[saas_sync] ✅ ${state}: ${inserted} nuevos · ${updated} actualizados · ${skipped} omitidos`);
      if (errors.length) {
        console.warn(`[saas_sync] ⚠️  Errores parciales: ${errors.slice(0, 3).join(', ')}`);
      }
    } else {
      console.error(`[saas_sync] HTTP ${res.status}:`, JSON.stringify(res.body).slice(0, 300));
    }

    return res.body;
  } catch (err) {
    console.error(`[saas_sync] Error de red: ${err.message}`);
    return null;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Sincroniza leads FL procesados (output de Processor.run) al SaaS API.
 * @param {object[]} leads   — array de leads de Processor.run()
 * @param {string}   batchId — identificador del lote (ej: "FL-2026-04-29")
 */
async function syncFLLeads(leads, batchId) {
  return _sync(leads.map(_mapFLLead), 'FL', batchId);
}

/**
 * Sincroniza leads IL (output de extract_chicago.js) al SaaS API.
 * @param {object[]} leads   — array de leads de extract_chicago.js
 * @param {string}   batchId — identificador del lote
 */
async function syncILLeads(leads, batchId) {
  // Filtrar leads sin permit_number válido
  const valid = leads.filter(l => l.Permit_Number);
  return _sync(valid.map(_mapILLead), 'IL', batchId);
}

module.exports = { syncFLLeads, syncILLeads };
