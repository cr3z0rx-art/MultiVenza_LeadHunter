'use strict';

require('dotenv').config();
const Extractor = require('../src/extractor');
const Processor = require('../src/processor');
const config = require('../config.json');

async function testOrange() {
  console.log("=== INICIANDO SMOKE TEST: ORANGE COUNTY ===");
  
  const extractor = new Extractor(config);
  
  // Extraer solo Orange County
  const rawLeads = await extractor.run({
    counties: ['Orange'],
    permitTypes: ['ROOF', 'HVAC', 'ELECTRICAL', 'CGC', 'NEW CONSTRUCTION'],
    maxItemsPerSource: 5,
    demoMode: true // Usamos demo si no hay token de Apify válido
  });

  console.log(`\nExtracción cruda finalizada. Encontrados: ${rawLeads.length} leads.`);

  const processor = new Processor(config);
  const result = await processor.run(rawLeads);
  const processedLeads = result.leads;

  console.log(`Procesamiento finalizado. Leads válidos (pasan No-GC): ${processedLeads.length}`);
  
  if (processedLeads.length > 0) {
    console.log('\nEjemplo de lead válido:');
    console.log(JSON.stringify(processedLeads[0], null, 2));
  } else {
    console.log('\nNingún lead pasó los filtros.');
  }
}

testOrange().catch(console.error);
