const https = require('https');

async function scrubBatch(ts) {
  return new Promise((resolve, reject) => {
    https.get(`https://multivenzaleadhunter.vercel.app/api/scrub?ts=${ts}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'Parse Error', raw: data.slice(0, 100) });
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const tables = ['competitor_analysis', 'leads'];
  
  for (const table of tables) {
    console.log(`--- Iniciando Scrubbing para tabla: ${table} ---`);
    let totalScanned = 0;
    let totalUpdated = 0;
    let totalDeleted = 0;
    let batches = 0;

    let offset = 0;
    while (true) {
      console.log(`[${table}] Ejecutando lote #${batches + 1} (offset: ${offset})...`);
      const result = await scrubBatch(`${Date.now()}_${table}&table=${table}&offset=${offset}`);
      
      if (result.error) {
        if (result.error === 'CRITICAL_MISSING_COLUMN') {
          console.warn(`⚠️ Saltando tabla ${table}: Falta la columna investment_range.`);
          break;
        }
        console.error('Error en lote:', result);
        break;
      }
      
      console.log(`[${table}] Lote #${batches + 1}: Escaneados=${result.scanned}, Actualizados=${result.records_updated}, Borrados=${result.duplicates_deleted}`);
      
      if (result.scanned < 1000) {
        console.log(`✅ Tabla ${table} procesada.`);
        break;
      }
      
      totalScanned += result.scanned || 0;
      totalUpdated += result.records_updated || 0;
      totalDeleted += result.duplicates_deleted || 0;
      batches++;
      offset += 1000;
      
      await new Promise(r => setTimeout(r, 300));
    }
    
    console.log(`--- Resumen ${table} ---`);
    console.log(`Leads escaneados: ${totalScanned}`);
    console.log(`Leads actualizados: ${totalUpdated}`);
    console.log(`Duplicados eliminados: ${totalDeleted}\n`);
  }
}

main().catch(console.error);
