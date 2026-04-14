'use strict';

/**
 * scripts/run_enricher.js
 *
 * Enriquece leads No-GC con teléfonos via Outscraper Google Maps API.
 * Genera LEADS_DIAMANTE_CON_TELEFONO.csv con clasificación y notas de urgencia.
 *
 * Modos:
 *   node scripts/run_enricher.js               → simulación (sin OUTSCRAPER_API_KEY)
 *   node scripts/run_enricher.js --live         → API real (requiere key en .env)
 *   node scripts/run_enricher.js --all          → incluye leads residenciales también
 *   node scripts/run_enricher.js --top=20       → solo top 20 por score
 */

require('dotenv').config();

const fs       = require('fs');
const path     = require('path');
const glob     = require('fs');
const config   = require('../config.json');
const Enricher = require('../src/enricher');
const Logger   = require('../src/utils/logger');

const logger   = new Logger(config.logging);
const LIVE     = process.argv.includes('--live');
const ALL      = process.argv.includes('--all');
const topArg   = process.argv.find(a => a.startsWith('--top='));
const TOP      = topArg ? parseInt(topArg.split('=')[1]) : null;

// ─── Cargar el master JSON más reciente ───────────────────────────────────────

function findLatestMaster() {
  const files = fs.readdirSync(config.output.directory)
    .filter(f => f.startsWith('leads_florida_wc_all_') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (!files.length) throw new Error('No master JSON en ./output/ — corre npm run diamond primero');
  return path.join(config.output.directory, files[0]);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const masterPath = findLatestMaster();
  const allLeads   = JSON.parse(fs.readFileSync(masterPath, 'utf8'));

  // Filtrar solo No-GC
  let leads = allLeads.filter(l => l.flags?.noGC);
  if (TOP) leads = leads.slice(0, TOP);

  const isDryRun = !LIVE || !process.env.OUTSCRAPER_API_KEY?.trim();
  const mode     = isDryRun ? 'SIMULACIÓN (modo demo)' : 'LIVE (Outscraper API)';

  logger.separator('ENRICHER — DIAMANTE CON TELÉFONO');
  logger.info(`Fuente       : ${masterPath}`);
  logger.info(`Total leads  : ${allLeads.length}  |  No-GC: ${leads.length}`);
  logger.info(`Modo         : ${mode}`);
  logger.info(`Solo comerciales: ${!ALL}`);

  const enricher = new Enricher(config);
  const { enriched, stats } = await enricher.run(leads, {
    onlyCommercial: !ALL,
    dryRun:         isDryRun,
    delayMs:        isDryRun ? 0 : 600,
  });

  // ── Resumen en terminal ───────────────────────────────────────────────────
  const LINE = '━'.repeat(72);
  const diamond   = enriched.filter(l => l.diamondClass === 'DIAMANTE');
  const premNoTel = enriched.filter(l => l.diamondClass === 'PREMIUM_SIN_TEL');
  const urgent    = enriched.filter(l => l.urgency?.urgent);

  console.log('\n');
  console.log('╔' + '═'.repeat(70) + '╗');
  console.log('║  LEADS DIAMANTE CON TELÉFONO — REPORTE FINAL'.padEnd(71) + '║');
  console.log('║  ' + mode.padEnd(68) + '║');
  console.log('╚' + '═'.repeat(70) + '╝\n');
  console.log(LINE);
  console.log(`  Leads procesados      : ${stats.attempted}`);
  console.log(`  Teléfonos encontrados : ${stats.found}`);
  console.log(`  Saltados              : ${stats.skipped}`);
  console.log('');
  console.log(`  💎 DIAMANTE (PREMIUM + tel): ${diamond.length}`);
  console.log(`  ⭐ Premium sin tel          : ${premNoTel.length}`);
  console.log(`  🔴 URGENTES (cierre 7d)     : ${urgent.length}`);
  console.log(LINE);

  if (diamond.length > 0 || premNoTel.length > 0) {
    const show = [...diamond, ...premNoTel].sort((a, b) => b.score - a.score);
    console.log('\n  TOP LEADS DIAMANTE:\n');
    console.log(
      '  ' +
      'Clasif.'.padEnd(20) +
      'Ciudad'.padEnd(16) +
      'Teléfono'.padEnd(18) +
      'Partner Share'.padEnd(16) +
      'Urgencia'
    );
    console.log('  ' + '─'.repeat(72));

    show.slice(0, 10).forEach(l => {
      const tel    = l.outscraper?.phone || '—';
      const share  = l.projectValue?.partnerShare
        ? `$${l.projectValue.partnerShare.toLocaleString('en-US')}`
        : '—';
      const urg    = l.urgency?.urgent ? `🔴 ${l.urgency.level}` : '—';
      console.log(
        '  ' +
        (l.diamondClass || '').padEnd(20) +
        (l.city || '').padEnd(16) +
        tel.padEnd(18) +
        share.padEnd(16) +
        urg
      );
    });
    console.log('  ' + '─'.repeat(72));
  }

  // Mostrar un script de llamada de ejemplo
  const firstUrgent = enriched.find(l => l.urgency?.urgent && l.urgency?.salesNote);
  if (firstUrgent) {
    console.log('\n  📞 EJEMPLO — SCRIPT DE LLAMADA AUTOMÁTICO:\n');
    console.log('  ' + '─'.repeat(72));
    firstUrgent.urgency.salesNote.split('\n').forEach(line => {
      console.log('  ' + line);
    });
    console.log('  ' + '─'.repeat(72));
  }

  // Archivo generado
  const ts   = new Date().toISOString().slice(0, 10);
  const csv  = `./output/LEADS_DIAMANTE_CON_TELEFONO_${ts}.csv`;
  if (fs.existsSync(csv.replace('./', ''))) {
    const kb = (fs.statSync(csv.replace('./', '')).size / 1024).toFixed(1);
    console.log(`\n  📁 Output: ${csv}  (${kb} KB)\n`);
  }

  console.log(LINE);
  if (isDryRun) {
    console.log('  ℹ️  Para usar la API real: agrega OUTSCRAPER_API_KEY en .env y corre con --live');
  }
  console.log('');
}

main().catch(err => {
  logger.error('Fatal', { error: err.message, stack: err.stack });
  process.exit(1);
});
