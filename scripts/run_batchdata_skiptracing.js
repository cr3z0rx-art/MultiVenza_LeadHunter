'use strict';
/**
 * scripts/run_batchdata_skiptracing.js
 *
 * Skill de Skip Tracing Masivo — BatchData.io
 * Lee la base de datos real de leads, construye el CSV de cargue masivo
 * y (opcionalmente) llama la API de BatchData para enriquecer los registros.
 *
 * Uso:
 *   node scripts/run_batchdata_skiptracing.js                     → genera CSV de cargue (sin API)
 *   node scripts/run_batchdata_skiptracing.js --push              → envía a BatchData API (requiere key)
 *   node scripts/run_batchdata_skiptracing.js --input=mi_base.csv → usa archivo específico
 *   node scripts/run_batchdata_skiptracing.js --top=50            → solo top 50 por TPV
 *
 * Archivo de entrada esperado:
 *   output/BASE_DATOS_LEADS_REALES_MULTIVENZA.csv  (o --input=ruta)
 *   Columnas requeridas: address, city, state, zip, ownerName  (case-insensitive)
 *   Columnas opcionales: permitNumber, tpv, category, score, county
 *
 * Costo BatchData: ~$0.05–$0.15/registro según plan
 * Alternativa BatchSkipTracing: $0.12/registro (subir CSV manualmente en batchskiptracing.com)
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { createObjectCsvWriter } = require('csv-writer');

const BATCHDATA_API_KEY = process.env.BATCHDATA_API_KEY || '';
const PUSH  = process.argv.includes('--push');
const inputArg = process.argv.find(a => a.startsWith('--input='));
const topArg   = process.argv.find(a => a.startsWith('--top='));
const TOP      = topArg ? parseInt(topArg.split('=')[1]) : null;

// ─── Localizar archivo de entrada ─────────────────────────────────────────────

function findInputFile() {
  if (inputArg) {
    const p = inputArg.split('=')[1];
    if (!fs.existsSync(p)) throw new Error(`Archivo no encontrado: ${p}`);
    return p;
  }
  // Buscar en output/ por nombre estándar o JSON master
  const candidates = [
    'output/BASE_DATOS_LEADS_REALES_MULTIVENZA.csv',
    'output/BASE_DATOS_LEADS_REALES_MULTIVENZA.json',
  ];
  // También busca el master JSON más reciente como fallback
  const masterFiles = fs.readdirSync('output')
    .filter(f => f.startsWith('leads_florida_wc_all_') && f.endsWith('.json'))
    .sort().reverse();
  if (masterFiles.length) candidates.push(path.join('output', masterFiles[0]));

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'No se encontró BASE_DATOS_LEADS_REALES_MULTIVENZA.csv en ./output/\n' +
    '  → Copia el archivo en: output/BASE_DATOS_LEADS_REALES_MULTIVENZA.csv'
  );
}

// ─── Parser CSV simple (sin dependencias externas) ────────────────────────────

function parseCSV(content) {
  const lines = content.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,))/g) || [];
    const obj  = {};
    headers.forEach((h, i) => {
      obj[h] = (vals[i] || '').replace(/^"|"$/g, '').trim();
    });
    return obj;
  });
}

// ─── Normalizar registro a esquema BatchData ──────────────────────────────────

function toBatchDataRow(lead) {
  // Acepta columnas con distintos nombres (case-insensitive ya resuelto en parseCSV)
  const firstName = _splitName(lead.ownername || lead.owner_name || lead.owner || '').first;
  const lastName  = _splitName(lead.ownername || lead.owner_name || lead.owner || '').last;
  const address   = lead.address || lead.direccion || '';
  const city      = lead.city    || lead.ciudad    || '';
  const state     = lead.state   || lead.estado    || 'FL';
  const zip       = lead.zip     || lead.zipcode   || lead.postal || '';

  return {
    firstName,
    lastName,
    addressLine1: address,
    city,
    state: state || 'FL',
    zip,
    // Metadata para cruzar resultado de vuelta
    _permitNumber: lead.permitnumber || lead.permit || lead.permit_number || '',
    _tpv:          lead.tpv || lead['total project value ($)'] || lead.totalprojectvalue || '',
    _category:     lead.category || lead.categoria || '',
    _score:        lead.score || '',
    _county:       lead.county || lead.condado || '',
  };
}

function _splitName(fullName) {
  if (!fullName) return { first: '', last: '' };
  // Formato "APELLIDO NOMBRE" (Property Appraiser FL) o "NOMBRE APELLIDO"
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  if (parts.length === 2) return { first: parts[1], last: parts[0] };
  // Más de 2 palabras: primer token = apellido, resto = nombre
  return { first: parts.slice(1).join(' '), last: parts[0] };
}

// ─── API BatchData (POST /v1/property/skip-trace) ────────────────────────────

function callBatchDataAPI(records) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      requests: records.map(r => ({
        firstName:   r.firstName,
        lastName:    r.lastName,
        address:     r.addressLine1,
        city:        r.city,
        state:       r.state,
        zip:         r.zip,
      })),
    });

    const opts = {
      hostname: 'api.batchdata.com',
      path:     '/api/v1/property/skip-trace',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${BATCHDATA_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout 60s')); });
    req.write(payload);
    req.end();
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const LINE = '─'.repeat(72);
  console.log('\n=== BATCHDATA SKIP TRACING — MULTIVENZA LEADHUNTER ===\n');

  // 1. Cargar datos
  let inputPath;
  try { inputPath = findInputFile(); }
  catch(e) {
    console.error('ERROR:', e.message);
    console.error('\n  Para usar este script:');
    console.error('  1. Copia tu base de datos en: output/BASE_DATOS_LEADS_REALES_MULTIVENZA.csv');
    console.error('  2. Columnas mínimas: address, city, zip, ownerName');
    console.error('  3. Ejecuta: node scripts/run_batchdata_skiptracing.js\n');
    process.exit(1);
  }

  const ext   = path.extname(inputPath).toLowerCase();
  let leads;
  if (ext === '.json') {
    leads = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    // Normalizar keys JSON a lowercase para reutilizar parser
    leads = leads.map(l => {
      const n = {};
      Object.keys(l).forEach(k => { n[k.toLowerCase()] = l[k]; });
      return n;
    });
  } else {
    leads = parseCSV(fs.readFileSync(inputPath, 'utf8'));
  }

  console.log(`  Fuente  : ${inputPath}`);
  console.log(`  Total   : ${leads.length} registros`);

  // Filtrar solo leads con nombre de propietario
  const withOwner = leads.filter(l => {
    const name = l.ownername || l.owner_name || l.owner || '';
    return name && !name.match(/^owner\s*\d+$/i) && !name.match(/buscar/i);
  });
  const noOwner = leads.length - withOwner.length;

  console.log(`  Con nombre propietario : ${withOwner.length}`);
  console.log(`  Sin nombre (omitidos)  : ${noOwner}`);

  // Aplicar --top
  let batch = withOwner.sort((a, b) => {
    const tpvA = parseFloat((a.tpv || a['total project value ($)'] || '0').replace(/[^0-9.]/g,'')) || 0;
    const tpvB = parseFloat((b.tpv || b['total project value ($)'] || '0').replace(/[^0-9.]/g,'')) || 0;
    return tpvB - tpvA;
  });
  if (TOP) batch = batch.slice(0, TOP);

  console.log(`  Registros a procesar   : ${batch.length}`);
  console.log(`  Costo estimado (BatchData $0.10/reg): $${(batch.length * 0.10).toFixed(2)}`);
  console.log(`  Costo estimado (BatchSkipTracing $0.12/reg): $${(batch.length * 0.12).toFixed(2)}`);
  console.log('');

  // 2. Construir filas BatchData
  const rows = batch.map(toBatchDataRow);

  // 3. Generar CSV de cargue manual (BatchSkipTracing / BatchData upload)
  const ts          = new Date().toISOString().slice(0, 10);
  const uploadPath  = path.join('output', `BATCHDATA_UPLOAD_${ts}.csv`);
  const uploadWriter = createObjectCsvWriter({
    path: uploadPath,
    header: [
      { id: 'firstName',    title: 'First Name'    },
      { id: 'lastName',     title: 'Last Name'     },
      { id: 'addressLine1', title: 'Address'       },
      { id: 'city',         title: 'City'          },
      { id: 'state',        title: 'State'         },
      { id: 'zip',          title: 'ZIP'           },
      { id: '_permitNumber',title: 'Permit #'      },
      { id: '_tpv',         title: 'Total Project Value ($)' },
      { id: '_category',    title: 'Category'      },
      { id: '_county',      title: 'County'        },
    ],
  });
  await uploadWriter.writeRecords(rows);
  console.log(LINE);
  console.log(`  CSV cargue masivo → ${uploadPath}`);
  console.log(`  → Subir en batchskiptracing.com o batchdata.com para enriquecer`);
  console.log('');

  // 4. Vista previa top 10
  console.log('  TOP LEADS PARA SKIP TRACING:\n');
  console.log('  ' + 'Nombre'.padEnd(28) + 'Dirección'.padEnd(32) + 'Ciudad'.padEnd(18) + 'ZIP');
  console.log('  ' + LINE);
  rows.slice(0, 10).forEach(r => {
    const nombre = `${r.lastName}, ${r.firstName}`.substring(0, 26).padEnd(28);
    const addr   = r.addressLine1.substring(0, 30).padEnd(32);
    const city   = r.city.substring(0, 16).padEnd(18);
    console.log('  ' + nombre + addr + city + r.zip);
  });
  console.log('  ' + LINE + '\n');

  // 5. Llamar API si --push está activo
  if (PUSH) {
    if (!BATCHDATA_API_KEY) {
      console.error('  ERROR: Agrega BATCHDATA_API_KEY en .env para usar --push');
      process.exit(1);
    }
    console.log(`  Enviando ${batch.length} registros a BatchData API...`);
    // BatchData acepta máx 100 por request — paginar
    const CHUNK = 100;
    const results = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      process.stdout.write(`  Lote ${Math.floor(i/CHUNK)+1}/${Math.ceil(rows.length/CHUNK)} ... `);
      const res = await callBatchDataAPI(chunk);
      console.log(res.status === 200 ? 'OK' : `Error ${res.status}`);
      if (res.body?.results) results.push(...res.body.results);
      await new Promise(r => setTimeout(r, 500));
    }

    // Escribir resultados enriquecidos
    if (results.length) {
      const enrichedPath = path.join('output', `BATCHDATA_ENRICHED_${ts}.json`);
      fs.writeFileSync(enrichedPath, JSON.stringify(results, null, 2));
      console.log(`\n  Resultados enriquecidos → ${enrichedPath}`);
    }
  } else {
    console.log('  ℹ️  Para llamar la API directamente:');
    console.log('     1. Agrega BATCHDATA_API_KEY en .env');
    console.log('     2. Ejecuta: node scripts/run_batchdata_skiptracing.js --push');
    console.log('     O sube el CSV manualmente en batchskiptracing.com\n');
  }

  console.log(LINE + '\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
