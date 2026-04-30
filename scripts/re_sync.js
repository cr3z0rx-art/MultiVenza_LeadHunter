require('dotenv').config();
const fs = require('fs');
const { syncToSupabase } = require('./lib/saas_sync');

async function run() {
  const data = JSON.parse(fs.readFileSync('./output/raw_diamond_2026-04-30.json', 'utf8'));
  const competitors = [];

  data.forEach(r => {
    const name = (r.contractorName || '').trim().toUpperCase();
    if (name && name.length > 2 && name !== 'OWNER' && name !== 'N/A') {
      competitors.push({
        permitNumber: r.permitNumber,
        state: r.state || 'FL',
        county: r.county || 'Desconocido',
        city: r.city || 'Desconocido',
        contractorName: r.contractorName,
        projectType: r.permitType || 'Construction',
        valuation: r.valuation || 0,
        permitDate: r.permitDate || null
      });
    }
  });

  console.log(`🚀 Iniciando re-sincronización de ${competitors.length} competidores hacia ${process.env.SAAS_API_URL}...`);
  
  // Enviamos solo competidores, leads vacíos []
  const res = await syncToSupabase([], competitors, 'MIXED', 're-sync-comp-90d');
  
  console.log('✅ Finalizado:', res);
}

run().catch(console.error);
