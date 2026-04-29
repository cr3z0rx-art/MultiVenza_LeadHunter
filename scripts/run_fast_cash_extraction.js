'use strict';
/**
 * scripts/run_fast_cash_extraction.js
 *
 * Extrae leads FAST CASH de Hillsborough County (ArcGIS real):
 *   - Tipos: Roofing, Re-Roof, Windows, Doors, Remodel
 *   - Valuación: hasta $50,000
 *   - Período: últimos N días (--days=90 por defecto)
 *
 * Uso:
 *   node --use-system-ca scripts/run_fast_cash_extraction.js
 *   node --use-system-ca scripts/run_fast_cash_extraction.js --days=60 --max=500
 *
 * Salida: output/FAST_CASH_PRIORITY.csv
 */

require('dotenv').config();

const https = require('https');
const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

// Cargar config.json para obtener valuationMin
let CONFIG;
try {
  const configPath = path.join(process.cwd(), 'config.json');
  CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error(`Error cargando config.json: ${err.message}`);
  CONFIG = { filters: { valuationMin: 5000 } }; // Valor por defecto si falla
}

// ─── Config ───────────────────────────────────────────────────────────────────

const ARCGIS_URL = 'https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/AccelaDashBoard_MapService20211019/FeatureServer/4/query';
const HCPA_URL = 'https://gis.hcpafl.org/arcgis/rest/services/Webmaps/HillsboroughFL_WebParcels/MapServer/0/query';

const DAYS_ARG = process.argv.find(a => a.startsWith('--days='));
const MAX_ARG = process.argv.find(a => a.startsWith('--max='));
const OWNERS_ARG = process.argv.find(a => a.startsWith('--owners='));
const DAYS = DAYS_ARG ? parseInt(DAYS_ARG.split('=')[1]) : 90;
const MAX = MAX_ARG ? parseInt(MAX_ARG.split('=')[1]) : 500;
// --owners=N: lookup owners for top N leads only (default 20 to avoid timeouts)
const OWNERS_TOP = OWNERS_ARG ? parseInt(OWNERS_ARG.split('=')[1]) : 20;

// Fast Cash keyword filters (applied to DESCRIPTION field)
const FAST_CASH_KEYWORDS = [
  'ROOF', 'REROOF', 'RE-ROOF', 'RE ROOF', 'SHINGLE', 'TILE ROOF', 'METAL ROOF', 'FLAT ROOF',
  'WINDOW', 'DOOR', 'REMODEL', 'RENOVATION', 'KITCHEN', 'BATHROOM', 'BATH', 'HURRICANE DAMAGE',
  'SCREEN', 'ENCLOSURE', 'SIDING', 'FLOORING', 'FLOOR',
];

const MAX_VALUATION = 50000;
const MIN_VALUATION = CONFIG.filters.valuationMin || 5000;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpsPost(url, params) {
  return new Promise((resolve, reject) => {
    const body = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message} — ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout 60s')); });
    req.write(body);
    req.end();
  });
}

// ─── ArcGIS field parsers ─────────────────────────────────────────────────────

function parseCity(raw) {
  if (!raw) return { city: '', zip: '' };
  const parts = raw.trim().split(/\s+/);
  if (parts.length >= 2 && /^\d{5}$/.test(parts[parts.length - 1])) {
    const zip = parts.pop();
    const city = parts.join(' ');
    return { city, zip };
  }
  return { city: raw.trim(), zip: '' };
}

function parseDate(epochMs) {
  if (!epochMs) return '';
  return new Date(epochMs).toISOString().slice(0, 10);
}

// ─── Category matcher ─────────────────────────────────────────────────────────

function detectFastCashType(description) {
  const upper = (description || '').toUpperCase();
  if (/RE[-\s]?ROOF|REROOF|SHINGLE|TILE ROOF|METAL ROOF|FLAT ROOF/.test(upper)) return 'ROOFING';
  if (/WINDOW|DOOR/.test(upper)) return 'WINDOWS_DOORS';
  if (/KITCHEN|BATHROOM|BATH|REMODEL|RENOVATION/.test(upper)) return 'REMODEL';
  if (/HURRICANE.*DAMAGE|STORM.*DAMAGE/.test(upper)) return 'REMODEL';
  if (/SCREEN|ENCLOSURE/.test(upper)) return 'REMODEL';
  if (/SIDING|FLOOR/.test(upper)) return 'REMODEL';
  if (/ROOF/.test(upper)) return 'ROOFING';
  return null;
}

function isFastCash(desc, val) {
  if (val > MAX_VALUATION) return false;
  const upper = (desc || '').toUpperCase();
  return FAST_CASH_KEYWORDS.some(kw => upper.includes(kw));
}

// ─── HCPA owner lookup ─────────────────────────────────────────────────────────

async function lookupOwnerByAddress(address, zip) {
  try {
    const where = `FullAddress LIKE '%${address.toUpperCase().replace(/'/g, "''")}%'`;
    const res = await httpsPost(HCPA_URL, {
      where, outFields: 'Owner1,Owner2,folio', f: 'json', resultRecordCount: 3,
    });
    if (res.features && res.features.length > 0) {
      const a = res.features[0].attributes;
      return { owner1: a.Owner1 || '', owner2: a.Owner2 || '', folio: a.folio || '' };
    }
  } catch (e) { /* silent */ }
  return { owner1: '', owner2: '', folio: '' };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const LINE = '─'.repeat(72);
  const ts = new Date().toISOString().slice(0, 10);

  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║         FAST CASH EXTRACTION — MULTIVENZA LEADHUNTER                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // 1. Calcular fecha mínima (epoch ms)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DAYS);
  const cutoffEpoch = cutoffDate.getTime();

  console.log(`  Período   : últimos ${DAYS} días (desde ${cutoffDate.toISOString().slice(0, 10)})`);
  console.log(`  Valuación : $${MIN_VALUATION.toLocaleString()} - $${MAX_VALUATION.toLocaleString()}`);
  console.log(`  Máx pulls : ${MAX} registros`);
  console.log(`  Condado   : Hillsborough (datos REALES ArcGIS)\n`);

  // 2. Tipos residenciales que contienen roofing/remodelaciones
  const permitTypes = [
    'Residential Building Alterations (Renovations)',
    'Residential Miscellaneous',
  ];

  let allRaw = [];

  // Format date like working extractor: date 'YYYY-MM-DD'
  const dateStr = cutoffDate.toISOString().slice(0, 10);

  for (const pType of permitTypes) {
    const where = `TYPE='${pType}' AND ISSUED_DATE >= date '${dateStr}'`;
    console.log(`  Consultando: ${pType}...`);

    try {
      const res = await httpsPost(ARCGIS_URL, {
        where,
        outFields: 'PERMIT__,TYPE,ISSUED_DATE,ADDRESS,CITY,Value,DESCRIPTION,STATUS,PARCEL',
        f: 'json',
        resultRecordCount: MAX,
        orderByFields: 'ISSUED_DATE DESC',
      });

      if (res.error) {
        console.log(`    ⚠ Error ArcGIS: ${JSON.stringify(res.error)}`);
        continue;
      }

      const features = res.features || [];
      console.log(`    → ${features.length} registros brutos obtenidos`);
      allRaw.push(...features);
    } catch (e) {
      console.log(`    ✗ Error conexión: ${e.message}`);
    }
  }

  if (allRaw.length === 0) {
    console.error('\n  ERROR: No se obtuvieron datos de ArcGIS.');
    console.error('  Verifica conectividad o usa: node --use-system-ca scripts/run_fast_cash_extraction.js\n');
    process.exit(1);
  }

  // 3. Filtrar Fast Cash: valor ≤ $50k + keywords en DESCRIPTION
  const fastCashRaw = allRaw.filter(f => {
    const val = parseFloat(f.attributes.Value) || 0;
    // Aplicar filtro MIN_VALUATION para eliminar "leads basura"
    if (val < MIN_VALUATION || val > MAX_VALUATION) return false;
    const desc = (f.attributes.DESCRIPTION || '').toUpperCase();
    return FAST_CASH_KEYWORDS.some(kw => desc.includes(kw));
  });

  console.log(`\n  ${LINE}`);
  console.log(`  Total bruto : ${allRaw.length} registros`);
  console.log(`  Fast Cash   : ${fastCashRaw.length} leads con keywords de roofing/remodel`);

  // 4. Mapear + dedup por permit number
  const seen = new Set();
  const leads = [];

  for (const f of fastCashRaw) {
    const a = f.attributes;
    const num = a.PERMIT__ || '';
    if (seen.has(num)) continue;
    seen.add(num);

    const { city, zip } = parseCity(a.CITY);
    const desc = a.DESCRIPTION || '';
    const typeStr = a.TYPE || '';
    const val = parseFloat(a.Value) || 0;
    const fastCashType = detectFastCashType(desc);

    if (!fastCashType) continue;
    if (city.toUpperCase() !== 'TAMPA') continue; // Solo Tampa (datos reales disponibles)

    leads.push({
      permitNumber: num,
      permitDate: parseDate(a.ISSUED_DATE),
      status: a.STATUS || 'Issued',
      address: a.ADDRESS || '',
      city,
      zip,
      valuation: val,
      permitType: typeStr,
      description: desc,
      fastCashType,
      parcel: a.PARCEL || '',
      // Owner se llenará abajo
      owner1: '',
      owner2: '',
      folio: '',
      ownerStatus: 'PENDIENTE',
    });
  }

  // Ordenar por valuación desc
  leads.sort((a, b) => b.valuation - a.valuation);

  console.log(`  Leads Tampa : ${leads.length} (únicos, con permiso real HC-BLD-)`);

  if (leads.length === 0) {
    console.log('\n  No hay leads Fast Cash con los filtros actuales.');
    console.log('  Intenta: --days=180 o --max=1000\n');
    process.exit(0);
  }

  // 5. Lookup de owners en HCPA — solo top N por valuación
  const lookupCount = Math.min(OWNERS_TOP, leads.length);
  console.log(`\n  Buscando propietarios en HCPA (top ${lookupCount} leads por valuación)...`);

  let found = 0;
  let missing = 0;

  for (let i = 0; i < leads.length; i++) {
    const l = leads[i];
    if (i < lookupCount) {
      process.stdout.write(`\r  [${i + 1}/${lookupCount}] ${l.address.substring(0, 40).padEnd(40)}`);
      const result = await lookupOwnerByAddress(l.address, l.zip);
      if (result.owner1) {
        l.owner1 = result.owner1;
        l.owner2 = result.owner2;
        l.folio = result.folio;
        l.ownerStatus = 'VERIFICADO_HCPA';
        found++;
      } else {
        l.ownerStatus = 'NO_ENCONTRADO';
        missing++;
      }
      // Pausa breve cada 10 requests
      if ((i + 1) % 10 === 0) await new Promise(r => setTimeout(r, 300));
    } else {
      l.ownerStatus = 'PENDIENTE_LOOKUP';
    }
  }

  process.stdout.write('\n');
  console.log(`\n  Propietarios verificados: ${found}/${lookupCount} | Pendientes: ${leads.length - lookupCount}`);

  // 6. Calcular TPV y Net Profit
  leads.forEach(l => {
    l.totalProjectValue = l.valuation;
    l.netProfit35 = Math.round(l.valuation * 0.35);
  });

  // 7. Escribir FAST_CASH_PRIORITY.csv
  const outPath = path.join('output', `FAST_CASH_PRIORITY.csv`);
  const writer = createObjectCsvWriter({
    path: outPath,
    header: [
      { id: 'fastCashType', title: 'Fast_Cash_Type' },
      { id: 'permitNumber', title: 'Permit_Number' },
      { id: 'owner1', title: 'Owner_Name' },
      { id: 'owner2', title: 'Co_Owner' },
      { id: 'address', title: 'Address' },
      { id: 'city', title: 'City' },
      { id: 'zip', title: 'ZIP' },
      { id: 'folio', title: 'Folio_HCPA' },
      { id: 'description', title: 'Permit_Description' },
      { id: 'valuation', title: 'Valuation ($)' },
      { id: 'totalProjectValue', title: 'Total_Project_Value ($)' },
      { id: 'netProfit35', title: 'Net_Profit_35 ($)' },
      { id: 'permitDate', title: 'Fecha_Permiso' },
      { id: 'status', title: 'Status' },
      { id: 'ownerStatus', title: 'PA_Status' },
      { id: 'phoneSkipTracing', title: 'Phone_Skip_Tracing' },
    ],
  });

  // Add empty phone field
  const rows = leads.map(l => ({ ...l, phoneSkipTracing: '' }));
  await writer.writeRecords(rows);

  // 8. Resumen por tipo
  const byType = {};
  leads.forEach(l => {
    if (!byType[l.fastCashType]) byType[l.fastCashType] = { count: 0, tpv: 0, net: 0 };
    byType[l.fastCashType].count++;
    byType[l.fastCashType].tpv += l.totalProjectValue;
    byType[l.fastCashType].net += l.netProfit35;
  });

  const totalTPV = leads.reduce((s, l) => s + l.totalProjectValue, 0);
  const totalNet = leads.reduce((s, l) => s + l.netProfit35, 0);

  // 9. Top 10 Roofing en consola
  console.log(`\n${LINE}`);
  console.log('  TOP 10 ROOFING — FAST CASH (mayor valuación)\n');
  console.log('  ' + '#'.padEnd(3) + 'Propietario'.padEnd(28) + 'Dirección'.padEnd(32) + 'Valuación'.padStart(12) + '  Net Profit');
  console.log('  ' + LINE);

  const roofingLeads = leads.filter(l => l.fastCashType === 'ROOFING').slice(0, 10);

  if (roofingLeads.length === 0) {
    console.log('  (No hay leads de Roofing en el período seleccionado)');
    console.log('  Intenta --days=180 para ampliar el rango\n');
  } else {
    roofingLeads.forEach((l, i) => {
      const owner = (l.owner1 || 'SIN NOMBRE').substring(0, 26).padEnd(28);
      const addr = l.address.substring(0, 30).padEnd(32);
      const val = `$${l.valuation.toLocaleString()}`.padStart(12);
      const net = `$${l.netProfit35.toLocaleString()}`;
      const check = l.ownerStatus === 'VERIFICADO_HCPA' ? '✓' : '?';
      console.log(`  ${String(i + 1).padEnd(3)}${owner}${addr}${val}  ${net}  ${check}`);
    });
  }

  console.log(`\n  ${LINE}`);
  console.log('  RESUMEN POR TIPO\n');
  Object.entries(byType).sort((a, b) => b[1].tpv - a[1].tpv).forEach(([type, s]) => {
    console.log(`  ${type.padEnd(20)} ${String(s.count).padStart(4)} leads  TPV $${s.tpv.toLocaleString().padStart(12)}  Net $${s.net.toLocaleString()}`);
  });

  console.log('');
  console.log(`  ${'TOTAL FAST CASH'.padEnd(20)} ${String(leads.length).padStart(4)} leads  TPV $${totalTPV.toLocaleString().padStart(12)}  Net $${totalNet.toLocaleString()}`);

  console.log(`\n${LINE}`);
  console.log(`  Archivo generado: ${outPath}`);
  console.log(`  Leads totales   : ${leads.length}`);
  console.log(`  Propietarios OK : ${found}/${leads.length}`);
  console.log(`\n  Próximo paso:`);
  console.log(`  node scripts/run_batchdata_skiptracing.js --input=output/FAST_CASH_PRIORITY.csv`);
  console.log(`${LINE}\n`);
}

main().catch(e => { console.error('\nError fatal:', e.message); process.exit(1); });
