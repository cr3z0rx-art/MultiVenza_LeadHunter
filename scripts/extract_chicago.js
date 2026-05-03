'use strict';

/**
 * scripts/extract_chicago.js
 * Real permit data from Chicago Data Portal (Socrata API).
 *
 * Uses public Socrata Open Data API endpoint:
 *   https://data.cityofchicago.org/resource/ydr8-5w6m.json
 *
 * Filters:
 *   - Date range: issue_date >= N days ago (configurable via --days)
 *   - Permit type: ROOF, REROOF, PORCH, BASEMENT, REMODEL, ADDITION, CONSTRUCTION
 *
 * Maps Socrata fields to RawPermit format compatible with processor.js.
 *
 * Usage:
 *   node scripts/extract_chicago.js
 *   node scripts/extract_chicago.js --days=30   (default: 30)
 *   node scripts/extract_chicago.js --max=100   (max records, default: 200)
 */

require('dotenv').config();
const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');
const { syncILLeads } = require('./lib/saas_sync');

// ─── Config ───────────────────────────────────────────────────────────────────

const SOCRATA_ENDPOINT = 'https://data.cityofchicago.org/resource/ydr8-5w6m.json';
const PREMIUM_CITIES = new Set(['CHICAGO', 'EVANSTON', 'SKOKIE', 'CICERO']);

// Permit types we care about (case-insensitive matching)
const TARGET_PERMIT_TYPES = ['ROOF', 'REROOF', 'PORCH', 'BASEMENT', 'REMODEL', 'ADDITION', 'CONSTRUCTION'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function argVal(flag, defaultVal) {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`));
  return arg ? parseInt(arg.split('=')[1], 10) : defaultVal;
}

/**
 * Build Socrata SoQL query parameters.
 * @param {number} daysBack
 * @param {number} maxRecords
 * @returns {string} URL query string
 */
function buildQueryString(daysBack, maxRecords) {
  const sinceDate = dayjs().subtract(daysBack, 'day').format('YYYY-MM-DD');

  // Filter: issue_date >= sinceDate
  let where = `issue_date >= '${sinceDate}'`;

  // Also filter by permit_type containing any of our keywords
  const typeFilters = TARGET_PERMIT_TYPES.map(t => `upper(permit_type) like '%25${t}%25'`);
  where += ` AND (${typeFilters.join(' OR ')})`;

  const params = new URLSearchParams({
    $where: where,
    $order: 'issue_date DESC',
    $limit: Math.min(maxRecords, 1000),
    // Fields we need — works without specifying, but explicit for clarity
    $select: 'id,permit_,permit_type,issue_date,status,address,zip_code,ward,community_area,total_fee,reported_cost,applicant_name,license_number',
  });

  return params.toString();
}

/**
 * Fetch JSON from Socrata API via HTTPS GET.
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message} — body: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Map a Socrata record to RawPermit format.
 * @param {object} record - Socrata API record
 * @returns {object} RawPermit-compatible object
 */
function mapToRawPermit(record) {
  // Parse valuation from reported_cost (string) or total_fee
  let valuation = 0;
  if (record.reported_cost) {
    valuation = parseFloat(record.reported_cost) || 0;
  } else if (record.total_fee) {
    valuation = parseFloat(record.total_fee) * 2 || 0; // rough proxy
  }

  // Derive city from ward/community_area or default to Chicago
  const cityName = 'Chicago'; // most permits are Chicago; could refine with community_area

  const permitType = (record.permit_type || '').toUpperCase();
  const isRoofing = /ROOF|REROOF/.test(permitType);

  // Build roofYear for roofing permits (use issue_date as proxy)
  let roofYear = null;
  if (isRoofing && record.issue_date) {
    roofYear = record.issue_date; // use issue_date as roof_year proxy
  }

  const isPremium = PREMIUM_CITIES.has(cityName.toUpperCase());

  return {
    permitNumber:   record.permit_ || record.id || `IL-CHI-${Date.now()}`,
    permitType:     record.permit_type || 'Building Permit',
    permitDate:     record.issue_date ? record.issue_date.slice(0, 10) : null,
    status:        record.status || 'Issued',
    address:       record.address || '',
    city:          cityName,
    state:         'IL',
    county:        'Cook',
    zip:           record.zip_code || '',
    ownerName:     record.applicant_name || null,
    contractorName: record.applicant_name || null, // Socrata has applicant_name, may be contractor
    contractorLic: record.license_number || null,
    valuation:     valuation,
    roofYear:      roofYear,
    source:        'Chicago Data Portal (Socrata)',
    tier:          isPremium ? 'PREMIUM' : 'STANDARD',
    tags:          isPremium ? ['PREMIUM'] : [],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Building Socrata query for Chicago permits...');

  const DAYS = argVal('days', 30);
  const MAX  = argVal('max',  200);

  console.log(`  Days back  : ${DAYS}`);
  console.log(`  Max records: ${MAX}`);

  // Build query URL
  const queryString = buildQueryString(DAYS, MAX);
  const url = `${SOCRATA_ENDPOINT}?${queryString}`;

  console.log(`  Fetching: ${url.slice(0, 120)}...`);

  try {
    const records = await httpsGet(url);

    if (!Array.isArray(records)) {
      console.error('Unexpected response format from Socrata API:', JSON.stringify(records).slice(0, 200));
      process.exit(1);
    }

    if (records.length === 0) {
      console.log('No records found matching the criteria.');
      process.exit(0);
    }

    console.log(`  Fetched ${records.length} records from Chicago Data Portal`);

    // Map to RawPermit format
    const rawPermits = records.map(mapToRawPermit);

    // Filter out records with no valuation or address
    const validPermits = rawPermits.filter(r => r.valuation > 0 && r.address && r.address.length > 5);

    console.log(`  Valid permits (with valuation + address): ${validPermits.length}`);

    // Save output
    const outPath = path.join(process.cwd(), 'output', 'leads_chicago_raw.json');
    await fs.ensureDir(path.join(process.cwd(), 'output'));
    await fs.writeJson(outPath, validPermits, { spaces: 2 });
    console.log(`  Saved to: ${outPath}`);

    // Also save a readable summary
    const summaryPath = path.join(process.cwd(), 'output', 'chicago_summary.txt');
    const summary = [
      `Chicago Leads Summary — ${dayjs().format('YYYY-MM-DD HH:mm')}`,
      `========================================`,
      `Fetched: ${records.length} records from Socrata API`,
      `Valid:   ${validPermits.length} permits`,
      `Days:    ${DAYS}`,
      ``,
      `Permit types found:`,
      ...Array.from(new Set(validPermits.map(r => r.permitType))).sort().map(t => `  - ${t}`),
      ``,
      `Valuation range: $${Math.min(...validPermits.map(r => r.valuation)).toLocaleString()} - $${Math.max(...validPermits.map(r => r.valuation)).toLocaleString()}`,
    ].join('\n');
    fs.writeFileSync(summaryPath, summary);
    console.log(`  Summary saved to: ${summaryPath}`);

    // ── Sync to SaaS API ────────────────────────────────────────────────────────
    await syncILLeads(validPermits, `IL-${dayjs().format('YYYY-MM-DD')}`);

    console.log('Done.');
  } catch (err) {
    console.error('Error fetching Chicago data:', err.message);
    process.exit(1);
  }
}

main();
