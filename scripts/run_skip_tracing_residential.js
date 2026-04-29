'use strict';
/**
 * scripts/run_skip_tracing_residential.js
 *
 * Skill de Skip Tracing Residencial — Siesta Key + Lakewood Ranch
 *
 * Paso 1: genera links de Property Appraiser (sc-pa.com) por dirección
 * Paso 2: genera links pre-llenados de TruePeopleSearch y Spokeo
 * Paso 3: crea REPORTE_FINAL_SKIP_TRACING.md listo para el socio
 *
 * Uso:
 *   node scripts/run_skip_tracing_residential.js
 *   node scripts/run_skip_tracing_residential.js --all   # incluye todas las ciudades premium
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const PREMIUM_CITIES = ['Siesta Key', 'Lakewood Ranch', 'Longboat Key'];
const ALL_FLAG       = process.argv.includes('--all');

// ─── Helpers de URL ────────────────────────────────────────────────────────────

function encQ(str) {
  return encodeURIComponent(str).replace(/%20/g, '+');
}

/**
 * Property Appraiser — Sarasota County
 * Búsqueda por dirección de situs (propiedad).
 */
function paLink(address, city, zip) {
  const q = encQ(address);
  return `https://www.sc-pa.com/propertysearch/index.aspx#/search/situs?q=${q}`;
}

/**
 * TruePeopleSearch — búsqueda por dirección (no requiere nombre).
 * Devuelve el/los propietarios registrados en esa dirección.
 */
function truePeopleSearchByAddr(address, city, zip) {
  const addr = encQ(address);
  const loc  = encQ(`${city} FL ${zip}`);
  return `https://www.truepeoplesearch.com/results?streetaddress=${addr}&citystatezip=${loc}`;
}

/**
 * TruePeopleSearch — búsqueda por nombre (usar DESPUÉS de obtener nombre del PA).
 */
function truePeopleSearchByName(ownerName, city) {
  const name = encQ(ownerName);
  const loc  = encQ(`${city} FL`);
  return `https://www.truepeoplesearch.com/results?name=${name}&citystatezip=${loc}`;
}

/**
 * Spokeo — búsqueda por dirección.
 */
function spokeoByAddr(address, city, zip) {
  // Spokeo formato: /address/STREET-ADDR/CITY-ST-ZIP
  const street = address.replace(/\s+/g, '-');
  const loc    = `${city}-FL-${zip}`.replace(/\s+/g, '-');
  return `https://www.spokeo.com/address/${encodeURIComponent(street)}/${encodeURIComponent(loc)}`;
}

/**
 * Spokeo — búsqueda por nombre (usar DESPUÉS de obtener nombre del PA).
 */
function spokeoByName(ownerName, city) {
  const parts = ownerName.trim().split(/\s+/);
  const first = parts[0] || '';
  const last  = parts.slice(1).join('-') || '';
  const loc   = city.replace(/\s+/g, '-');
  if (!first || !last) return `https://www.spokeo.com/search?q=${encQ(ownerName + ' ' + city + ' FL')}`;
  return `https://www.spokeo.com/${encodeURIComponent(first)}-${encodeURIComponent(last)}/Florida/${encodeURIComponent(loc)}`;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function main() {
  // Cargar master JSON más reciente
  const files = fs.readdirSync('output')
    .filter(f => f.startsWith('leads_florida_wc_all_') && f.endsWith('.json'))
    .sort().reverse();
  if (!files.length) {
    console.error('ERROR: No master JSON en ./output/ — corre npm run diamond primero');
    process.exit(1);
  }
  const masterPath = path.join('output', files[0]);
  const allLeads   = JSON.parse(fs.readFileSync(masterPath, 'utf8'));

  // Filtrar ciudades premium residenciales
  const cities  = ALL_FLAG ? PREMIUM_CITIES : ['Siesta Key', 'Lakewood Ranch'];
  const leads   = allLeads
    .filter(l => cities.includes(l.city) && l.flags?.noGC)
    .sort((a, b) => (b.projectValue?.totalProjectValue || 0) - (a.projectValue?.totalProjectValue || 0));

  const ts = new Date().toISOString().slice(0, 10);

  console.log(`\n  Skip Tracing Residencial — ${cities.join(' + ')}`);
  console.log(`  Leads encontrados: ${leads.length}  |  Fuente: ${masterPath}\n`);

  // ── Construir reporte Markdown ─────────────────────────────────────────────
  const lines = [];

  lines.push(`# REPORTE FINAL — SKIP TRACING RESIDENCIAL`);
  lines.push(`**Ciudades:** ${cities.join(' · ')}  |  **Leads:** ${leads.length}  |  **Fecha:** ${ts}`);
  lines.push('');
  lines.push('> **Flujo de trabajo:**');
  lines.push('> 1. Clic en **[PA]** → busca la dirección → copia el nombre del dueño');
  lines.push('> 2. Clic en **[ADDR]** → TruePeopleSearch por dirección (resultado inmediato)');
  lines.push('> 3. Una vez tengas el nombre: clic en **[NOMBRE]** → búsqueda precisa');
  lines.push('> 4. Anotar el teléfono en la columna **Teléfono** y enviar a CRM');
  lines.push('');
  lines.push('---');
  lines.push('');

  // Importar validador
  const { validateAddress } = require('../src/utils/address_validator');

  leads.forEach((l, i) => {
    const tpv     = (l.projectValue?.totalProjectValue  || l.valuation || 0).toLocaleString('en-US');
    const net     = (l.projectValue?.estNetProfit        || Math.round((l.projectValue?.totalProjectValue || l.valuation || 0) * 0.35)).toLocaleString('en-US');
    const owner   = (l.ownerName && !l.ownerName.startsWith('Owner ')) ? l.ownerName : '_(buscar en PA)_';
    const zip     = l.zip || '';
    const permit  = l.permitNumber || '';
    const date    = l.permitDate   || '';

    // Validar dirección
    const addrV    = l.addressFormatted
      ? { normalizedAddress: l.addressFormatted, status: l.addressStatus || 'VALID', tag: l.tags?.includes('DIRECCIÓN_UNVERIFIED') ? '[DIRECCIÓN POR VERIFICAR]' : null, note: l.addressNote || '' }
      : validateAddress(l.address, l.city, zip);
    const addrDisplay = addrV.normalizedAddress;
    const addrBadge   = addrV.status === 'CORRECTED'  ? ' ✏️ _dirección normalizada_' :
                        addrV.status === 'UNVERIFIED' ? ' ⚠️ **[DIRECCIÓN POR VERIFICAR]**' : '';

    // Usar dirección normalizada para links (sin el tag de texto)
    const cleanAddr   = l.addressFormatted
      ? l.addressFormatted.replace(' [DIRECCIÓN POR VERIFICAR]', '')
      : addrV.normalizedAddress.replace(' [DIRECCIÓN POR VERIFICAR]', '');
    const streetOnly  = addrV.status === 'CORRECTED' && addrV.note
      ? addrV.note.split('"')[3] || l.address  // calle corregida
      : l.address;

    // Links
    const linkPA      = paLink(streetOnly, l.city, zip);
    const linkTpsAddr = truePeopleSearchByAddr(streetOnly, l.city, zip);
    const linkSpkAddr = spokeoByAddr(streetOnly, l.city, zip);

    // Si ya tenemos nombre real, generar links por nombre también
    const hasRealName = owner !== '_(buscar en PA)_';
    const linkTpsName = hasRealName ? truePeopleSearchByName(owner, l.city) : null;
    const linkSpkName = hasRealName ? spokeoByName(owner, l.city)           : null;

    const cleanDisplay = addrDisplay.replace(' [DIRECCIÓN POR VERIFICAR]', '');
    lines.push(`## ${i + 1}. ${cleanDisplay}${addrBadge}`);
    lines.push('');
    lines.push(`| Campo | Valor |`);
    lines.push(`|---|---|`);
    lines.push(`| **Dueño** | ${owner} |`);
    lines.push(`| Permiso # | ${permit} |`);
    lines.push(`| Fecha Permiso | ${date} |`);
    lines.push(`| **Dirección Google Maps** | \`${addrDisplay.replace(' [DIRECCIÓN POR VERIFICAR]','')}\` |`);
    lines.push(`| **Total Project Value** | $${tpv} |`);
    lines.push(`| **Est. Net Profit (35%)** | **$${net}** |`);
    lines.push(`| **Teléfono** | _(skip tracing pendiente)_ |`);
    lines.push('');
    lines.push('**Paso 1 — Property Appraiser (nombre del dueño):**');
    lines.push(`- [Buscar en sc-pa.com →](${linkPA})`);
    lines.push('');
    lines.push('**Paso 2 — Skip Tracing por Dirección:**');
    lines.push(`- [TruePeopleSearch (dirección)](${linkTpsAddr})`);
    lines.push(`- [Spokeo (dirección)](${linkSpkAddr})`);
    if (hasRealName) {
      lines.push('');
      lines.push('**Paso 3 — Skip Tracing por Nombre (nombre ya disponible):**');
      lines.push(`- [TruePeopleSearch (nombre)](${linkTpsName})`);
      lines.push(`- [Spokeo (nombre)](${linkSpkName})`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  // Resumen financiero
  const totalTpv = leads.reduce((s, l) => s + (l.projectValue?.totalProjectValue || l.valuation || 0), 0);
  const totalNet = leads.reduce((s, l) => s + (l.projectValue?.estNetProfit || Math.round((l.projectValue?.totalProjectValue || l.valuation || 0) * 0.35)), 0);
  lines.push('## Resumen del Pipeline');
  lines.push('');
  lines.push(`| Métrica | Valor |`);
  lines.push(`|---|---|`);
  lines.push(`| Leads en skip tracing | ${leads.length} |`);
  lines.push(`| **Total Project Value (pipeline)** | **$${totalTpv.toLocaleString('en-US')}** |`);
  lines.push(`| **Est. Net Profit 35% (pipeline)** | **$${totalNet.toLocaleString('en-US')}** |`);
  lines.push(`| Costo BatchSkipTracing estimado | $${(leads.length * 0.12).toFixed(2)} |`);
  lines.push('');
  lines.push('> **BatchSkipTracing** ($0.12/registro): alternativa si TruePeopleSearch/Spokeo no dan resultado.');
  lines.push('> Subir CSV con [Nombre, Dirección, Ciudad, Estado, ZIP] en batchskiptracing.com');

  // Escribir archivo
  const outPath = path.join('output', `REPORTE_FINAL_SKIP_TRACING_${ts}.md`);
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`  Reporte generado: ${outPath}`);
  console.log(`  Leads incluidos : ${leads.length}`);
  console.log(`  Total TPV       : $${totalTpv.toLocaleString('en-US')}`);
  console.log(`  Est. Net Profit : $${totalNet.toLocaleString('en-US')}\n`);
}

main();
