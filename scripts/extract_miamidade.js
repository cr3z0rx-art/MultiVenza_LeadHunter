'use strict';

/**
 * scripts/extract_miamidade.js
 * Datos REALES de building permits de Miami-Dade County via ArcGIS REST API publica.
 *
 * Endpoint: services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0
 * Gratis, sin API key.
 *
 * Campos de interes:
 *   - OwnerName (duenio de la propiedad)
 *   - PropertyAddress, City (direccion)
 *   - PermitType (BLDG, MECH, ELEC, PLUM, etc.)
 *   - EstimatedValue (valor estimado)
 *   - PermitIssuedDate (fecha del permiso)
 *   - ContractorName (para Market Insights)
 *
 * Usage:
 *   node scripts/extract_miamidade.js
 *   node scripts/extract_miamidade.js --days=30
 *   node scripts/extract_miamidade.js --max=500
 */

require('dotenv').config();
const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config.json');
const Processor = require('../src/processor');
const Logger = require('../src/utils/logger');

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/miamidade_permit_data/FeatureServer/0';
const PREMIUM_CITIES = new Set(['MIAMI BEACH', 'CORAL GABLES', 'KEY BISCAYNE', 'PINE CREST', 'FISHER ISLAND', 'BAL HARBOUR', 'SUNNY ISLES BEACH']);
const TARGET_TYPES = ['BLDG', 'MECH', 'ELEC', 'PLUM', 'ROOF'];

// ─── CLI args ─────────────────────────────────────────────────────────────────

function argVal(flag, defaultVal) {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : defaultVal;
}

const DAYS = argVal('days', 30);
const MAX  = argVal('max',  500);

const logger = new Logger(config.logging);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function buildPostData(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function parseDate(epochMs) {
  if (!epochMs) return null;
  return new Date(epochMs).toISOString().slice(0, 10);
}

function mapToRawPermit(feature) {
  const a = feature.attributes;
  const permitType = (a.PermitType || '').toUpperCase();
  const isPremium = PREMIUM_CITIES.has((a.City || '').trim().toUpperCase());
  const val = parseFloat(a.EstimatedValue) || 0;

  // Detectar roofing por permit type + description
  const descStr = [a.PermitType, a.ApplicationTypeDescription || '', a.DetailDescriptionComments || ''].join(' ').toUpperCase();
  const isRoofing = /ROOF|REROOF|SHINGLE/.test(descStr);

  let roofYear = null;
  if (isRoofing && a.PermitIssuedDate) {
    // Usar fecha del permiso como proxy del roofYear
    const d = new Date(a.PermitIssuedDate);
    roofYear = new Date(d.getFullYear() - 15, 0, 1).toISOString().slice(0, 10);
  }

  return {
    permitNumber:   a.PermitNumber || `MD-UNKNOWN-${Date.now()}`,
    permitType:     [a.PermitType, a.ApplicationTypeDescription].filter(Boolean).join(' - '),
    permitDate:     parseDate(a.PermitIssuedDate),
    status:         'Issued',
    address:        a.PropertyAddress || '',
    city:           a.City || '',
    state:          'FL',
    county:         'Miami-Dade',
    zip:            '',
    ownerName:      a.OwnerName || null,
    contractorName: null, // No nos interesa para leads, solo Market Insights
    contractorLic:  null,
    valuation:      val,
    roofYear:       roofYear,
    source:         'Miami-Dade ArcGIS',
    tier:           isPremium ? 'PREMIUM' : 'STANDARD',
    tags:           isPremium ? ['PREMIUM'] : [],
  };
}

// ─── Paginated query ──────────────────────────────────────────────────────────

async function paginateQuery(where, maxRecords, dateField) {
  const pageSize = Math.min(maxRecords, 1000);
  const allFeatures = [];
  let offset = 0;

  while (allFeatures.length < maxRecords) {
    const remaining = maxRecords - allFeatures.length;
    const url = `${BASE_URL}/query?` + new URLSearchParams({
      where,
      outFields: 'PermitNumber,PermitType,PermitIssuedDate,PropertyAddress,City,EstimatedValue,OwnerName,ContractorName,ApplicationTypeDescription,DetailDescriptionComments',
      resultRecordCount: Math.min(pageSize, remaining),
      resultOffset: offset,
      orderByFields: `${dateField} DESC`,
      returnGeometry: 'false',
      f: 'json',
    }).toString().replace(/%2C/g, ',');

    const data = await httpsGet(url);

    if (data.error) {
      throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
    }

    const features = data.features || [];
    allFeatures.push(...features);

    if (features.length < pageSize || !data.exceededTransferLimit) break;
    offset += features.length;
  }

  return allFeatures;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  MIAMI-DADE COUNTY - BUILDING PERMITS');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Days back: ${DAYS}  |  Max: ${MAX}`);
  console.log('');

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - DAYS);
  const dateStr = sinceDate.toISOString().slice(0, 10);

  // Query: tipos que nos interesan + fecha
  const typeList = TARGET_TYPES.map(t => `'${t}'`).join(',');
  const where = `PermitType IN (${typeList}) AND PermitIssuedDate >= date '${dateStr}'`;

  console.log(`  Querying...`);

  try {
    const features = await paginateQuery(where, MAX, 'PermitIssuedDate');
    console.log(`  Raw records: ${features.length}`);

    if (features.length === 0) {
      console.log('  No permits found for this period.');
      process.exit(0);
    }

    const rawRecords = features.map(mapToRawPermit);

    // Filtrar solo los que tienen ownerName + address
    const valid = rawRecords.filter(r => r.ownerName && r.address && r.valuation > 0);
    console.log(`  With owner+address+valuation: ${valid.length}`);

    // ── Procesar con el mismo processor ──
    const processor = new Processor(config);
    const { leads, competitors } = await processor.run(valid);

    console.log('');
    console.log(`  Leads No-GC (acceso directo al duenio): ${leads.length}`);
    console.log(`  Competidores (con contratista): ${competitors.length}`);

    // Mostrar top 5
    if (leads.length > 0) {
      const top = leads.sort((a, b) => b.score - a.score).slice(0, 5);
      console.log('');
      console.log('  TOP 5 LEADS:');
      console.log('  ' + '─'.repeat(72));
      top.forEach(l => {
        const city = (l.city || '').padEnd(18);
        const name = (l.ownerName || 'N/A').padEnd(22);
        const val = l.projectValue?.totalProjectValue 
          ? `$${(l.projectValue.totalProjectValue).toLocaleString()}`
          : `$${(l.valuation || 0).toLocaleString()}`;
        console.log(`  ${city} ${name} ${val.padStart(12)}  score:${l.score}`);
      });
    }

    // ── Guardar output ──
    const ts = new Date().toISOString().slice(0, 10);
    const outDir = config.output?.directory || './output';
    await fs.ensureDir(outDir);

    const outPath = path.join(outDir, `leads_miamidade_${ts}.json`);
    await fs.writeJson(outPath, { leads, competitors, stats: { total: valid.length, leads: leads.length, competitors: competitors.length } }, { spaces: 2 });
    console.log(`\n  Output: ${outPath}`);

    // ── Sync a Supabase/SaaS ──
    try {
      const { syncFLLeads } = require('./lib/saas_sync');
      await syncFLLeads(leads, competitors, `MD-${ts}`);
      console.log('  Synced to dashboard.');
    } catch (e) {
      console.log(`  Sync skipped: ${e.message}`);
    }

    console.log('\n  Done.');
  } catch (err) {
    console.error(`\n  ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
