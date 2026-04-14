'use strict';

/**
 * scripts/run_sarasota_hillsborough.js
 *
 * Focused extraction run:
 *   - Counties:     Sarasota, Hillsborough
 *   - Permit types: Residential Roofing, New Construction
 *   - Limit:        50 permits total (25 per county)
 *
 * Usage:
 *   node scripts/run_sarasota_hillsborough.js
 *   node scripts/run_sarasota_hillsborough.js --live   (requires APIFY_TOKEN in .env)
 */

require('dotenv').config();

const path      = require('path');
const fs        = require('fs');
const config    = require('../config.json');
const Extractor = require('../src/extractor');
const Processor = require('../src/processor');
const Logger    = require('../src/utils/logger');

// ─── Runtime config ────────────────────────────────────────────────────────

config.apify.token     = process.env.APIFY_TOKEN     || config.apify.token;
config.crm.apiKey      = process.env.CRM_API_KEY     || config.crm.apiKey;
config.crm.apiEndpoint = process.env.CRM_API_ENDPOINT || config.crm.apiEndpoint;

// Run options for this specific extraction
const RUN_OPTIONS = {
  counties:          ['Sarasota', 'Hillsborough'],
  permitTypes:       ['RESIDENTIAL ROOFING', 'NEW CONSTRUCTION'],
  maxItemsPerSource: 25,          // 25 per county = 50 total
  demoMode:          !process.argv.includes('--live'),
};

const logger = new Logger(config.logging);

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  logger.separator('RUN: Sarasota + Hillsborough | Roofing + New Construction');
  logger.info('Target counties:     ' + RUN_OPTIONS.counties.join(', '));
  logger.info('Target permit types: ' + RUN_OPTIONS.permitTypes.join(', '));
  logger.info('Limit per county:    ' + RUN_OPTIONS.maxItemsPerSource);
  logger.info('Mode:                ' + (RUN_OPTIONS.demoMode ? 'DEMO (sample data)' : 'LIVE (Apify)'));

  // ── 1. Extract ────────────────────────────────────────────────────────────
  const extractor = new Extractor(config);
  const rawRecords = await extractor.run(RUN_OPTIONS);

  if (rawRecords.length === 0) {
    logger.warn('No records returned. Exiting.');
    process.exit(0);
  }

  // Save raw snapshot for audit trail
  const ts      = new Date().toISOString().slice(0, 10);
  const rawPath = path.join(config.output.directory, `raw_sarasota_hillsborough_${ts}.json`);
  fs.mkdirSync(config.output.directory, { recursive: true });
  fs.writeFileSync(rawPath, JSON.stringify(rawRecords, null, 2));
  logger.info(`Raw snapshot saved: ${rawPath}`);

  // ── 2. Process ────────────────────────────────────────────────────────────
  const processor = new Processor(config);
  const { leads, stats } = await processor.run(rawRecords);

  // ── 3. Summary report ─────────────────────────────────────────────────────
  logger.separator('RESULTS');

  console.log('\n📋  EXTRACTION + PROCESSING SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Raw records fetched : ${stats.total}`);
  console.log(`  Qualified leads     : ${stats.passed}`);
  console.log(`  Dropped             : ${stats.dropped}`);
  console.log('');
  console.log('  By category:');
  for (const [cat, count] of Object.entries(stats.byCategory)) {
    if (count > 0) console.log(`    ${cat.padEnd(16)} ${count}`);
  }
  console.log('');
  console.log(`  🏆 PREMIUM leads    : ${stats.premium}`);
  console.log(`  🔑 No-GC leads      : ${stats.noGC}`);
  console.log(`  🔴 Roof critical    : ${stats.roofCritical}  (15+ year rule)`);
  console.log(`  🟡 Roof warm        : ${stats.roofWarm}   (12–14 year rule)`);
  console.log('');
  console.log(`  📊 Total Project Value        : $${stats.totalProjectValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  📊 Est. Net Profit (30%)      : $${stats.estNetProfitTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  💰 MultiVenza Partner Share   : $${stats.partnerShareTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log('');

  // Show output files
  console.log('  📁 Output files:');
  const outputFiles = fs.readdirSync(config.output.directory)
    .filter(f => f.includes(ts))
    .map(f => `    ./output/${f}`);
  outputFiles.forEach(f => console.log(f));

  // ── 4. Top 5 leads preview ────────────────────────────────────────────────
  console.log('\n  🎯 TOP 5 LEADS (by score):');
  console.log('  ' + '─'.repeat(95));
  console.log(
    '  ' +
    'Score'.padEnd(7) +
    'Tier'.padEnd(10) +
    'City'.padEnd(16) +
    'County'.padEnd(14) +
    'Permit Type'.padEnd(28) +
    'No-GC'.padEnd(7) +
    'Partner Share 35%'
  );
  console.log('  ' + '─'.repeat(95));

  leads.slice(0, 5).forEach(l => {
    const tag    = l.tier === 'PREMIUM' ? '★ PREMIUM ' : 'STANDARD  ';
    const noGC   = l.flags.noGC ? 'YES  ' : 'NO   ';
    const share  = `$${l.projectValue.partnerShare.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const type   = (l.permitType || '').slice(0, 27);
    console.log(
      '  ' +
      String(l.score).padEnd(7) +
      tag.padEnd(10) +
      (l.city || '').padEnd(16) +
      (l.county || '').padEnd(14) +
      type.padEnd(28) +
      noGC.padEnd(7) +
      share
    );
  });
  console.log('  ' + '─'.repeat(95));
  console.log('');

  logger.info('Run complete. Check ./output for CSV and JSON files.');
}

main().catch(err => {
  logger.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
