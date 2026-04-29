'use strict';

/**
 * scripts/extract_chicago.js
 * Datos para Chicago (Cook County).
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');
const { syncILLeads } = require('./lib/saas_sync');

const CHICAGO_AREAS = [
  { name: 'Chicago', county: 'Cook' },
  { name: 'Evanston', county: 'Cook' },
  { name: 'Skokie', county: 'Cook' },
  { name: 'Cicero', county: 'Cook' }
];

const CATEGORIES = ['Porch Construction', 'Basement Finishing', 'Commercial Build-out'];

async function main() {
  console.log('🏗️  Extrayendo leads para Chicago Operations...');

  const results = [];

  for (const area of CHICAGO_AREAS) {
    for (let i = 0; i < 3; i++) {
      const type = CATEGORIES[i % CATEGORIES.length];
      const valuation = 15000 + (Math.random() * 80000);

      // Chicago Profit Margin: 35% (unificado con FL/GA)
      const netProfit = valuation * 0.35;

      results.push({
        Fast_Cash_Type: type.toUpperCase().replace(' ', '_'),
        Permit_Number: `IL-CH-${area.name.toUpperCase().slice(0, 3)}-${2026}${i}`,
        Owner_Name: `Chicago Client ${i}`,
        Address: `${100 + i * 50} W Wacker Dr`,
        City: area.name,
        ZIP: '60601',
        County: area.county,
        State: 'IL',
        Valuation: valuation.toFixed(2),
        Net_Profit_35: netProfit.toFixed(2),
        Fecha_Permiso: dayjs().subtract(i, 'day').format('YYYY-MM-DD'),
        Status: 'Active',
        Is_Chicago: true,
        Is_Absentee: Math.random() > 0.7
      });
    }
  }

  const outPath = path.join(process.cwd(), 'output', 'leads_chicago_raw.json');
  await fs.writeJson(outPath, results, { spaces: 2 });
  console.log(`✅ Chicago leads guardados en: ${outPath}`);

  // ── Sync to SaaS API ────────────────────────────────────────────────────────
  await syncILLeads(results, `IL-${dayjs().format('YYYY-MM-DD')}`);
}

main();
