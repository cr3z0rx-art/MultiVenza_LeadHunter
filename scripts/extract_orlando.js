'use strict';

/**
 * scripts/extract_orlando.js
 * Datos REALES de building permits de Orlando / Orange County via Socrata API publica.
 *
 * Endpoint: https://data.cityoforlando.net/resource/ryhf-m453.json
 * Gratis, sin API key.
 *
 * Campos de interes:
 *   - property_owner_name (duenio de la propiedad)
 *   - permit_address (direccion)
 *   - application_type / worktype (tipo de permiso)
 *   - estimated_cost (valor estimado)
 *   - issue_permit_date (fecha)
 *
 * Usage:
 *   node scripts/extract_orlando.js
 *   node scripts/extract_orlando.js --days=30
 *   node scripts/extract_orlando.js --max=500
 */

require('dotenv').config();
const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config.json');
const Processor = require('../src/processor');
const Logger = require('../src/utils/logger');

// ─── Config ───────────────────────────────────────────────────────────────────

const SOCRATA_ENDPOINT = 'https://data.cityoforlando.net/resource/ryhf-m453.json';
const PREMIUM_CITIES = new Set(['WINTER PARK', 'WINDERMERE', 'DR PHILLIPS', 'BELLE ISLE', 'COLLEGE PARK']);
const TARGET_WORKTYPES = ['ROOF', 'REROOF', 'BUILDING', 'MECH', 'ELEC', 'PLUM', 'REMODEL', 'ADDITION', 'CONSTRUCTION'];

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

function mapToRawPermit(record) {
  const worktype = (record.worktype || record.application_type || '').toUpperCase();
  const isPremium = PREMIUM_CITIES.has((record.property_owner_name || '').trim().toUpperCase()) ||
                    false; // premium por ciudad se detecta en processor

  // Extraer ciudad de la direccion (campo permit_address)
  let city = 'Orlando';
  let zip = '';
  const addr = record.permit_address || '';
  // Intentar extraer ciudad del formato "DIRECCION, CIUDAD FL ZIP"
  const cityMatch = addr.match(/,?\s*([A-Za-z\s]+)\s+FL\s+(\d{5})$/);
  if (cityMatch) {
    city = cityMatch[1].trim();
    zip = cityMatch[2];
  }

  const val = parseFloat(record.estimated_cost) || 0;

  // Detectar roofing
  const isRoofing = /ROOF|REROOF|SHINGLE/.test(worktype) || /ROOF|REROOF/.test(record.project_name || '');

  let roofYear = null;
  if (isRoofing && record.issue_permit_date) {
    const d = new Date(record.issue_permit_date);
    roofYear = new Date(d.getFullYear() - 15, 0, 1).toISOString().slice(0, 10);
  }

  return {
    permitNumber:   record.permit_number || `ORL-UNKNOWN-${Date.now()}`,
    permitType:     [record.application_type, record.worktype].filter(Boolean).join(' - '),
    permitDate:     record.issue_permit_date ? record.issue_permit_date.slice(0, 10) : null,
    status:         record.application_status || 'Issued',
    address:        record.permit_address || '',
    city:           city,
    state:          'FL',
    county:         'Orange',
    zip:            zip,
    ownerName:      (record.property_owner_name || '').trim() || null,
    contractorName: null,
    contractorLic:  null,
    valuation:      val,
    roofYear:       roofYear,
    source:         'Orlando Data Portal (Socrata)',
    tier:           'STANDARD',
    tags:           [],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  ORLANDO / ORANGE COUNTY - BUILDING PERMITS');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Days back: ${DAYS}  |  Max: ${MAX}`);
  console.log('');

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - DAYS);
  const dateStr = sinceDate.toISOString().slice(0, 10);

  // Filtro: fecha + tipos de trabajo relevantes
  const workFilters = TARGET_WORKTYPES.map(t => `upper(worktype) like '%25${t}%25'`).join(' OR ');
  const where = `issue_permit_date >= '${dateStr}' AND (${workFilters}) AND estimated_cost > 0`;

  const url = `${SOCRATA_ENDPOINT}?$where=${encodeURIComponent(where)}&$limit=${Math.min(MAX, 1000)}&$order=issue_permit_date DESC&$select=permit_number,application_type,worktype,permit_address,property_owner_name,estimated_cost,issue_permit_date,application_status,project_name`;

  console.log('  Fetching from Orlando Data Portal...');

  try {
    const records = await httpsGet(url);
    console.log(`  Raw records: ${records.length}`);

    if (records.length === 0) {
      console.log('  No permits found.');
      process.exit(0);
    }

    const rawRecords = records.map(mapToRawPermit);

    // Filtrar los que tienen owner + address + valuation
    const valid = rawRecords.filter(r => r.ownerName && r.address && r.valuation > 0);
    console.log(`  With owner+address+valuation: ${valid.length}`);

    // Procesar
    const processor = new Processor(config);
    const { leads, competitors } = await processor.run(valid);

    console.log('');
    console.log(`  Leads No-GC (acceso directo al duenio): ${leads.length}`);
    console.log(`  Competidores (con contratista): ${competitors.length}`);

    // Top 5
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

    // Guardar
    const ts = new Date().toISOString().slice(0, 10);
    const outDir = config.output?.directory || './output';
    await fs.ensureDir(outDir);
    const outPath = path.join(outDir, `leads_orlando_${ts}.json`);
    await fs.writeJson(outPath, { leads, competitors }, { spaces: 2 });
    console.log(`\n  Output: ${outPath}`);

    // Sync
    try {
      const { syncFLLeads } = require('./lib/saas_sync');
      await syncFLLeads(leads, competitors, `ORL-${ts}`);
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
