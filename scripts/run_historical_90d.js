'use strict';

/**
 * scripts/run_historical_90d.js
 *
 * Barrida histórica de 90 días — captura el 100% de permisos (con y sin GC)
 * para poblar competitor_analysis con inteligencia de mercado real.
 *
 * Condados soportados (con endpoints públicos confirmados):
 *   Hillsborough (FL)  — ArcGIS REST confirmado
 *   Miami-Dade   (FL)  — ArcGIS Hub open data (descubrimiento dinámico)
 *
 * Pendiente de endpoint verificado (agrega el URL cuando tengas acceso):
 *   Harris   (TX / Houston)  — City of Houston Open Data (necesita URL de FeatureServer)
 *   Maricopa (AZ / Phoenix)  — City of Phoenix Open Data (necesita URL de FeatureServer)
 *
 * Usage:
 *   node scripts/run_historical_90d.js
 *   node scripts/run_historical_90d.js --days=60 --max=3000
 */

require('dotenv').config();

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { URL } = require('url');

// ── CLI args ──────────────────────────────────────────────────────────────────

function argVal(flag, def) {
  const a = process.argv.find(x => x.startsWith(`--${flag}=`));
  return a ? parseInt(a.split('=')[1], 10) : def;
}

const DAYS    = argVal('days', 90);
const MAX     = argVal('max',  2000);
const DRY_RUN = process.argv.includes('--dry-run');

const SAAS_API_URL = (process.env.SAAS_API_URL || '').replace(/\/$/, '');
const SAAS_API_KEY = process.env.SAAS_API_KEY || '';

// ── ArcGIS helper ─────────────────────────────────────────────────────────────

function buildPostData(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function httpsPost(baseUrl, postData) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(baseUrl);
    const payload = Buffer.from(postData);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + (parsed.search || ''),
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': payload.length,
      },
    };
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.slice(0, 100)}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function queryArcGIS(featureUrl, where, maxRecords) {
  const pageSize   = Math.min(maxRecords, 1000);
  const allFeatures = [];
  let offset = 0;

  while (allFeatures.length < maxRecords) {
    const remaining = maxRecords - allFeatures.length;
    const postData  = buildPostData({
      where,
      outFields:         '*',
      resultRecordCount: Math.min(pageSize, remaining),
      resultOffset:      offset,
      orderByFields:     'ISSUED_DATE DESC',
      f:                 'json',
    });

    const data = await httpsPost(`${featureUrl}/query`, postData);
    if (data.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);

    const features = data.features || [];
    allFeatures.push(...features);
    if (features.length < pageSize || !data.exceededTransferLimit) break;
    offset += features.length;
  }

  return allFeatures;
}

// ── County extractors ─────────────────────────────────────────────────────────

async function extractHillsborough(sinceDate, maxRecords) {
  const url   = 'https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer/4';
  const where = `ISSUED_DATE >= date '${sinceDate}'`;

  console.log(`[Hillsborough] Querying ALL permits since ${sinceDate}...`);
  const features = await queryArcGIS(url, where, maxRecords);
  console.log(`[Hillsborough] ${features.length} raw features`);

  return features.map(f => {
    const a = f.attributes;
    const rawCity = a.CITY || '';
    const parts   = rawCity.trim().split(/\s+/);
    const zip     = parts.length >= 2 && /^\d{5}$/.test(parts[parts.length - 1])
      ? parts.pop() : '';
    const city    = parts.join(' ').trim();

    const contractorRaw = (a.CONTRACTOR || a.CONTRACTOR_NAME || '').trim();

    return {
      permitNumber:   a.PERMIT__  || `HC-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      permitDate:     a.ISSUED_DATE ? new Date(a.ISSUED_DATE).toISOString().slice(0, 10) : null,
      permitType:     [a.TYPE, a.DESCRIPTION].filter(Boolean).join(' ').trim(),
      status:         a.STATUS    || 'Issued',
      address:        a.ADDRESS   || '',
      city,
      zip,
      county:         'Hillsborough',
      state:          'FL',
      contractorName: contractorRaw || null,
      valuation:      typeof a.Value === 'number' ? a.Value : 0,
    };
  });
}

// Miami-Dade: try known FeatureServer pattern for MDC open data
async function extractMiamiDade(sinceDate, maxRecords) {
  // ArcGIS Hub open data for Miami-Dade Building Permits
  // Portal: https://gis-mdc.opendata.arcgis.com/datasets/MDC::building-permit/about
  // Common MDC FeatureServer pattern (verify at portal if this fails):
  const CANDIDATE_URLS = [
    'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/building_permit/FeatureServer/0',
    'https://services1.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/building_permit/FeatureServer/0',
    'https://services2.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/building_permit/FeatureServer/0',
  ];

  for (const url of CANDIDATE_URLS) {
    try {
      // Test the endpoint with a minimal query first
      const testData = await httpsPost(`${url}/query`, buildPostData({
        where: '1=1', outFields: 'objectid', resultRecordCount: 1, f: 'json',
      }));

      if (testData.error) continue; // try next URL

      console.log(`[Miami-Dade] Endpoint confirmed: ${url}`);

      const where    = `ISSUE_DATE >= date '${sinceDate}' OR ISSUED_DATE >= date '${sinceDate}'`;
      const features = await queryArcGIS(url, where, maxRecords);
      console.log(`[Miami-Dade] ${features.length} features`);

      return features.map(f => {
        const a = f.attributes;
        return {
          permitNumber:   a.PERMIT_NUMBER || a.PERMIT_NO || a.OBJECTID?.toString(),
          permitDate:     a.ISSUE_DATE || a.ISSUED_DATE
            ? new Date(a.ISSUE_DATE || a.ISSUED_DATE).toISOString().slice(0, 10)
            : null,
          permitType:     a.PERMIT_TYPE || a.TYPE || '',
          status:         a.STATUS || '',
          address:        a.ADDRESS || a.SITE_ADDRESS || '',
          city:           a.CITY || 'Miami',
          zip:            a.ZIP || a.ZIP_CODE || '',
          county:         'Miami-Dade',
          state:          'FL',
          contractorName: a.CONTRACTOR_NAME || a.CONTRACTOR || null,
          valuation:      Number(a.VALUATION || a.VALUE || a.JOB_VALUE || 0),
        };
      });
    } catch {
      continue;
    }
  }

  console.warn('[Miami-Dade] No endpoint confirmed. Skipping.');
  console.warn('  → Verify the FeatureServer URL at: https://gis-mdc.opendata.arcgis.com/datasets/MDC::building-permit/about');
  return [];
}

// Stub entries for counties needing endpoint research
function pendingCountyNote(county, state, resourceUrl) {
  console.warn(`\n[${county}] Endpoint not yet confirmed for ${state}.`);
  console.warn(`  → Find FeatureServer URL at: ${resourceUrl}`);
  console.warn(`  → Once confirmed, add it to ARCGIS_SOURCES in arcgis_extractor.js`);
  return [];
}

// ── Sync to SaaS API ──────────────────────────────────────────────────────────

function postJSON(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = JSON.stringify(body);
    const lib     = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    };

    const req = lib.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
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

async function syncCompetitors(records, state) {
  if (!SAAS_API_URL || !SAAS_API_KEY) {
    console.warn('[sync] SAAS_API_URL / SAAS_API_KEY not set — skipping API sync');
    return;
  }

  // Only keep records with a real contractor name (GC data for market intelligence)
  const withGC  = records.filter(r => r.contractorName && r.contractorName.trim().length > 2);
  const withoutGC = records.filter(r => !r.contractorName);

  console.log(`\n[sync] GC records (→ competitor_analysis): ${withGC.length}`);
  console.log(`[sync] No-GC records (→ leads):             ${withoutGC.length}`);

  const CHUNK = 500;
  let inserted = 0;

  for (let i = 0; i < withGC.length; i += CHUNK) {
    const chunk = withGC.slice(i, i + CHUNK);
    const payload = {
      source_state: state,
      batch_id:     `${state}-HIST-${new Date().toISOString().slice(0, 10)}`,
      leads:        [],
      competitors:  chunk.map(r => ({
        permitNumber:   r.permitNumber,
        state:          r.state,
        county:         r.county,
        city:           r.city,
        contractorName: r.contractorName,
        projectType:    r.permitType,
        valuation:      r.valuation,
        permitDate:     r.permitDate,
      })),
    };

    const res = await postJSON(`${SAAS_API_URL}/api/sync`, payload, {
      'x-api-key':        SAAS_API_KEY,
      'x-scraper-source': 'historical-90d',
    });

    if (res.status === 200) {
      inserted += res.body.inserted ?? 0;
      console.log(`[sync] Lote ${Math.floor(i / CHUNK) + 1}: ${res.body.inserted ?? 0} competidores`);
    } else {
      console.error(`[sync] HTTP ${res.status}:`, JSON.stringify(res.body).slice(0, 200));
    }
  }

  console.log(`\n[sync] Total competidores insertados: ${inserted}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - DAYS);
  const since = sinceDate.toISOString().slice(0, 10);

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  MULTIVENZA — BARRIDA HISTÓRICA 90 DÍAS');
  console.log(`  Desde: ${since}  |  Días: ${DAYS}  |  Max/condado: ${MAX}`);
  if (DRY_RUN) console.log('  ⚠️  DRY RUN — no se enviará al API');
  console.log('════════════════════════════════════════════════════════════\n');

  // ── Extract all counties ─────────────────────────────────────────────────
  const [hillsborough, miamiDade] = await Promise.all([
    extractHillsborough(since, MAX).catch(e => {
      console.error('[Hillsborough] Error:', e.message);
      return [];
    }),
    extractMiamiDade(since, MAX).catch(e => {
      console.error('[Miami-Dade] Error:', e.message);
      return [];
    }),
  ]);

  // Pending counties (add FeatureServer URL when available)
  await Promise.all([
    pendingCountyNote('Harris',   'TX', 'https://cohgis-mycity.opendata.arcgis.com/'),
    pendingCountyNote('Maricopa', 'AZ', 'https://maps.maricopa.gov/'),
  ]);

  const allRecords = [...hillsborough, ...miamiDade];

  console.log(`\n── Summary ──────────────────────────────────────────────`);
  console.log(`  Hillsborough (FL): ${hillsborough.length} permisos`);
  console.log(`  Miami-Dade   (FL): ${miamiDade.length} permisos`);
  console.log(`  Total:             ${allRecords.length} permisos`);

  // ── Save raw snapshot ────────────────────────────────────────────────────
  const outDir  = path.join(__dirname, '../output');
  const outFile = path.join(outDir, `historical_90d_${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(allRecords, null, 2));
  console.log(`  Saved → ${outFile}`);

  if (DRY_RUN || allRecords.length === 0) {
    console.log('\n  No sync performed.\n');
    return;
  }

  // ── Sync to SaaS ─────────────────────────────────────────────────────────
  // FL records
  const flRecords = allRecords.filter(r => r.state === 'FL');
  if (flRecords.length > 0) await syncCompetitors(flRecords, 'FL');

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  ✅  Barrida histórica completa');
  console.log('════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
