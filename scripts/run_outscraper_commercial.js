'use strict';
require('dotenv').config();

const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const { createObjectCsvWriter } = require('csv-writer');

const API_KEY = process.env.OUTSCRAPER_API_KEY;

// Top CGC Tampa No-GC por TPV — subdivisiones y proyectos de alto valor
const TARGETS = [
  { permit: 'HC-BLD-26-0082417', address: '10014 Indus Nadi St',  city: 'Tampa', zip: '33647', tpv: 684000  },
  { permit: 'HC-BLD-26-0082029', address: '10020 Indus Nadi St',  city: 'Tampa', zip: '33647', tpv: 684000  },
  { permit: 'HC-BLD-26-0081502', address: '20318 Kaveri St',      city: 'Tampa', zip: '33647', tpv: 684000  },
  { permit: 'HC-BLD-25-0079757', address: '3931 E Eden Roc Cir',  city: 'Tampa', zip: '33609', tpv: 400000  },
  { permit: 'HC-BLD-26-0080111', address: '7208 Maracay Pl',      city: 'Tampa', zip: '33615', tpv: 350000  },
  { permit: 'HC-BLD-26-0080161', address: '7206 Maracay Pl',      city: 'Tampa', zip: '33615', tpv: 350000  },
  { permit: 'HC-BLD-25-0074495', address: '10346 Orange Grove Dr',city: 'Tampa', zip: '33618', tpv: 300000  },
  { permit: 'HC-BLD-26-0079977', address: '4611 Bay Crest Dr',    city: 'Tampa', zip: '33615', tpv: 105474  },
];

function queryOutscraper(lead) {
  return new Promise((resolve) => {
    const q    = encodeURIComponent(lead.address + ', ' + lead.city + ', FL ' + lead.zip);
    const qs   = '/maps/search-v3?query=' + q + '&language=en&region=US&organizationsPerQueryLimit=1&async=false&apiKey=' + API_KEY;
    const opts = {
      hostname: 'api.outscraper.com',
      path:     qs,
      method:   'GET',
      headers:  { 'X-API-KEY': API_KEY },
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const body  = JSON.parse(data);
          const first = ((body.data || [])[0] || [])[0] || null;
          resolve({ ...lead, result: first, credits: body.credits_used || 1 });
        } catch (e) {
          resolve({ ...lead, result: null, error: e.message });
        }
      });
    });
    req.on('error', e => resolve({ ...lead, result: null, error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ ...lead, result: null, error: 'Timeout 30s' }); });
    req.end();
  });
}

async function main() {
  const LINE = '─'.repeat(78);
  const ts   = new Date().toISOString().slice(0, 10);

  console.log('\n=== OUTSCRAPER LIVE — CGC COMMERCIAL TAMPA ===');
  console.log('Procesando ' + TARGETS.length + ' leads...\n');

  const rows = [];
  let totalCredits = 0;

  for (const lead of TARGETS) {
    process.stdout.write('  ' + lead.address.padEnd(26) + ' ... ');
    const r      = await queryOutscraper(lead);
    totalCredits += r.credits || 0;

    const phone   = (r.result && (r.result.phone || r.result.phone_1)) || null;
    const name    = (r.result && r.result.name)  || null;
    const gAddr   = (r.result && (r.result.address || r.result.full_address)) || null;
    const website = (r.result && r.result.site)  || null;

    const streetNum = lead.address.split(' ')[0];
    const addrMatch = gAddr ? gAddr.includes(streetNum) : false;
    const verified  = !!(phone && (addrMatch || name));

    if (r.error)        console.log('ERROR: ' + r.error);
    else if (verified)  console.log('TEL VERIFICADO');
    else if (phone)     console.log('TEL (addr mismatch)');
    else                console.log('sin telefono');

    rows.push({
      status:      verified ? 'VERIFICADO' : (phone ? 'TEL_MISMATCH' : 'SIN_TELEFONO'),
      permit:      lead.permit,
      address:     lead.address,
      city:        lead.city,
      tpv:         lead.tpv,
      partnerShare: Math.round(lead.tpv * 0.35),
      name:        name    || '',
      phone:       phone   || '',
      website:     website || '',
      gAddr:       gAddr   || '',
      addrMatch:   addrMatch ? 'YES' : 'NO',
    });

    await new Promise(res => setTimeout(res, 800));
  }

  // ── Resumen ─────────────────────────────────────────────────────────────
  const withPhone = rows.filter(r => r.phone);
  const verified  = rows.filter(r => r.status === 'VERIFICADO');

  console.log('\n' + LINE);
  console.log('RESUMEN  |  Creditos usados: ' + totalCredits);
  console.log(LINE);
  console.log('  Con telefono       : ' + withPhone.length + ' / ' + rows.length);
  console.log('  Address verificado : ' + verified.length);
  console.log('  Sin telefono       : ' + rows.filter(r => !r.phone).length);

  if (withPhone.length > 0) {
    console.log('\n  LEADS CON TELEFONO:\n');
    withPhone.forEach((r, i) => {
      console.log('  ' + (i + 1) + '. ' + r.address + ', Tampa');
      console.log('     Permiso     : ' + r.permit);
      console.log('     Google Maps : ' + (r.name || '-'));
      console.log('     Telefono    : ' + r.phone);
      console.log('     Website     : ' + (r.website || '-'));
      console.log('     TPV         : $' + Number(r.tpv).toLocaleString('en-US'));
      console.log('     Partner 35% : $' + Number(r.partnerShare).toLocaleString('en-US'));
      console.log('     G.Address   : ' + (r.gAddr || '-'));
      console.log('     Status      : ' + r.status);
      console.log('');
    });
  }

  // ── CSV CGC Tampa ────────────────────────────────────────────────────────
  const csvPath = path.join('output', 'LEADS_CGC_TAMPA_OUTSCRAPER_' + ts + '.csv');
  const writer  = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: 'status',       title: 'Estado Outscraper'         },
      { id: 'permit',       title: 'Permiso #'                 },
      { id: 'address',      title: 'Direccion'                 },
      { id: 'city',         title: 'Ciudad'                    },
      { id: 'tpv',          title: 'Total Project Value ($)'   },
      { id: 'partnerShare', title: 'Partner Share 35% ($)'     },
      { id: 'name',         title: 'Nombre Google Maps'        },
      { id: 'phone',        title: 'Telefono (Outscraper)'     },
      { id: 'website',      title: 'Website'                   },
      { id: 'gAddr',        title: 'Direccion Google Maps'     },
      { id: 'addrMatch',    title: 'Address Match'             },
    ],
  });
  await writer.writeRecords(rows);
  console.log('  CSV Tampa  -> ' + csvPath);

  // ── CSV Siesta Key (skip tracing manual) ────────────────────────────────
  const masterPath = fs.readdirSync('output')
    .filter(f => f.startsWith('leads_florida_wc_all_') && f.endsWith('.json'))
    .sort().reverse()[0];
  const allLeads = JSON.parse(fs.readFileSync(path.join('output', masterPath)));
  const skLeads  = allLeads.filter(l => l.city === 'Siesta Key').sort((a, b) => b.score - a.score);

  const skPath   = path.join('output', 'LEADS_SIESTA_KEY_SKIP_TRACING_' + ts + '.csv');
  const skWriter = createObjectCsvWriter({
    path: skPath,
    header: [
      { id: 'score',        title: 'Score'                                  },
      { id: 'tier',         title: 'Tier'                                   },
      { id: 'category',     title: 'Categoria'                              },
      { id: 'permitNumber', title: 'Permiso #'                              },
      { id: 'permitDate',   title: 'Fecha Permiso'                          },
      { id: 'address',      title: 'Direccion'                              },
      { id: 'city',         title: 'Ciudad'                                 },
      { id: 'zip',          title: 'ZIP'                                    },
      { id: 'ownerName',    title: 'Propietario (verificar sc-pa.com)'      },
      { id: 'phone',        title: 'Telefono — SKIP TRACING MANUAL'         },
      { id: 'tpv',          title: 'Total Project Value ($)'                },
      { id: 'partnerShare', title: 'Partner Share 35% ($)'                  },
      { id: 'roofAge',      title: 'Edad Techo (anos)'                      },
      { id: 'noGC',         title: 'No-GC'                                  },
      { id: 'paLink',       title: 'Property Appraiser'                     },
    ],
  });
  await skWriter.writeRecords(skLeads.map(l => ({
    score:        l.score,
    tier:         l.tier,
    category:     l.category,
    permitNumber: l.permitNumber,
    permitDate:   l.permitDate,
    address:      l.address,
    city:         l.city,
    zip:          l.zip,
    ownerName:    l.ownerName || '(buscar en sc-pa.com)',
    phone:        '',
    tpv:          (l.projectValue && l.projectValue.totalProjectValue) || l.valuation,
    partnerShare: (l.projectValue && l.projectValue.partnerShare) || '',
    roofAge:      (l.roofAnalysis && l.roofAnalysis.age) || '',
    noGC:         (l.flags && l.flags.noGC) ? 'YES' : 'NO',
    paLink:       'https://www.sc-pa.com/propertysearch/',
  })));
  console.log('  CSV Siesta Key -> ' + skPath);
  console.log(LINE + '\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
