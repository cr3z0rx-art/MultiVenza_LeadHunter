'use strict';

/**
 * generate_search_urls.js
 *
 * Genera URLs de búsqueda manual para los leads VIP de Siesta Key.
 * Abre las búsquedas en tu navegador o cópialas para buscar manualmente.
 *
 * NOTA: Los nombres de propietario deben completarse primero desde el
 * Property Appraiser de Sarasota County (sc-pa.com) — registro público gratuito.
 *
 * Uso:
 *   node scripts/generate_search_urls.js
 *   node scripts/generate_search_urls.js --open   (abre en navegador)
 */

const { execSync } = require('child_process');

// ─── Leads VIP Siesta Key ─────────────────────────────────────────────────────
// Completa ownerName con el nombre real del Property Appraiser antes de correr
const VIP_LEADS = [
  {
    rank:        1,
    address:     '1000 Gulf Dr, Siesta Key, FL 34242',
    permitNum:   'SC-BLD-26-000000',
    category:    'Roofing',
    commission:  '$87,500',
    ownerName:   '',   // ← pega aquí el nombre del sc-pa.com
  },
  {
    rank:        2,
    address:     '1017 Bay Blvd, Siesta Key, FL 34242',
    permitNum:   'SC-BLD-26-000001',
    category:    'Roofing',
    commission:  '$87,500',
    ownerName:   '',   // ← pega aquí el nombre del sc-pa.com
  },
  {
    rank:        3,
    address:     '1272 Bay Blvd, Siesta Key, FL 34242',
    permitNum:   'SC-BLD-26-000016',
    category:    'CGC / Renovación Comercial',
    commission:  '$323,750',
    ownerName:   '',   // ← PRIORIDAD #1 — $323K en juego
  },
  {
    rank:        4,
    address:     '1357 Bay Blvd, Siesta Key, FL 34242',
    permitNum:   'SC-BLD-26-000021',
    category:    'Roofing',
    commission:  '$87,500',
    ownerName:   '',   // ← pega aquí el nombre del sc-pa.com
  },
];

// ─── Generador de URLs ────────────────────────────────────────────────────────

function googleUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function propertyAppraiserUrl(address) {
  const clean = address.split(',')[0].trim();
  return `https://www.sc-pa.com/propertysearch/index.aspx#/details/${encodeURIComponent(clean)}`;
}

const OPEN_BROWSER = process.argv.includes('--open');

function openUrl(url) {
  try {
    execSync(`start "" "${url}"`, { stdio: 'ignore' });
  } catch (_) {}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const LINE  = '━'.repeat(80);
const line2 = '─'.repeat(80);

console.log('\n');
console.log('╔' + '═'.repeat(78) + '╗');
console.log('║  MULTIVENZA VIP — BÚSQUEDAS MANUALES DE PROPIETARIO'.padEnd(79) + '║');
console.log('║  Siesta Key, FL  |  ' + new Date().toLocaleDateString('es-MX', {dateStyle:'full'}).padEnd(57) + '║');
console.log('╚' + '═'.repeat(78) + '╝\n');

let missingNames = 0;

for (const lead of VIP_LEADS) {
  const hasName = lead.ownerName && lead.ownerName.trim().length > 0;
  if (!hasName) missingNames++;

  console.log(LINE);
  console.log(`  LEAD #${lead.rank} — ${lead.category}  |  Comisión: ${lead.commission}`);
  console.log(`  Permiso: ${lead.permitNum}`);
  console.log(`  Dirección: ${lead.address}`);
  console.log(`  Propietario: ${hasName ? lead.ownerName : '⚠️  PENDIENTE — buscar en Property Appraiser'}`);
  console.log('');

  // Siempre genera URL del Property Appraiser
  const paUrl = `https://www.sc-pa.com/propertysearch/`;
  console.log('  📋 PASO 1 — Property Appraiser (nombre del dueño, gratis):');
  console.log(`     ${paUrl}`);
  console.log(`     Busca: "${lead.address.split(',')[0]}"`);

  if (OPEN_BROWSER) openUrl(paUrl);

  console.log('');

  if (hasName) {
    const name = lead.ownerName.trim();

    // Google Phone
    const phoneQuery = `"${name}" "${lead.address.split(',')[0]}" Siesta Key FL phone contact`;
    const phoneUrl   = googleUrl(phoneQuery);
    console.log('  🔍 PASO 2A — Google (teléfono / contacto):');
    console.log(`     ${phoneUrl}`);
    if (OPEN_BROWSER) openUrl(phoneUrl);

    // LinkedIn
    const linkedinQuery = `site:linkedin.com "${name}" Sarasota OR "Siesta Key" OR Florida`;
    const linkedinUrl   = googleUrl(linkedinQuery);
    console.log('');
    console.log('  🔍 PASO 2B — LinkedIn vía Google:');
    console.log(`     ${linkedinUrl}`);
    if (OPEN_BROWSER) openUrl(linkedinUrl);

    // Facebook Marketplace / general social
    const fbQuery = `"${name}" Sarasota Florida site:facebook.com OR site:instagram.com`;
    console.log('');
    console.log('  🔍 PASO 2C — Redes sociales:');
    console.log(`     ${googleUrl(fbQuery)}`);
    if (OPEN_BROWSER) openUrl(googleUrl(fbQuery));

  } else {
    console.log('  ⏸️  PASOS 2A/2B/2C — disponibles cuando agregues el nombre del dueño.');
    console.log('     Edita el array VIP_LEADS en este script con el nombre del sc-pa.com');
    console.log('     y vuelve a correr: node scripts/generate_search_urls.js');
  }

  console.log('');
}

console.log(LINE);

// ─── Resumen ──────────────────────────────────────────────────────────────────

if (missingNames > 0) {
  console.log(`\n  ⚠️  ${missingNames} de ${VIP_LEADS.length} leads sin nombre de propietario.\n`);
  console.log('  FLUJO RECOMENDADO:');
  console.log('  ┌─────────────────────────────────────────────────────────────────┐');
  console.log('  │  1. Abre sc-pa.com/propertysearch                              │');
  console.log('  │  2. Busca cada dirección → copia el nombre del dueño           │');
  console.log('  │  3. Pégalo en el array VIP_LEADS de este script                │');
  console.log('  │  4. Corre: node scripts/generate_search_urls.js --open         │');
  console.log('  │     → abre las búsquedas de Google automáticamente             │');
  console.log('  └─────────────────────────────────────────────────────────────────┘');
} else {
  console.log('\n  ✅  Todos los nombres cargados.');
  if (!OPEN_BROWSER) {
    console.log('  Corre con --open para abrir todas las búsquedas en el navegador:');
    console.log('  node scripts/generate_search_urls.js --open\n');
  }
}

console.log('');
console.log('  📎 Property Appraiser Sarasota County (GRATIS, registro público):');
console.log('     https://www.sc-pa.com/propertysearch/');
console.log('');
console.log('  📎 Property Appraiser Hillsborough County (para leads de Tampa):');
console.log('     https://www.hcpafl.org/property-search');
console.log('');
console.log(LINE);
