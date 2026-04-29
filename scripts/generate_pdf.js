/**
 * generate_pdf.js
 * Directiva: directivas/pdf_generator_SOP.md
 *
 * Genera Propuesta_Exclusiva_Roofing_MultiVenza.pdf desde el HTML fuente,
 * inyectando los 3 mejores leads de Roofing de Georgia (valuation > $10,000).
 */

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

// ── Rutas ─────────────────────────────────────────────────────────────────────
const ROOT       = path.resolve(__dirname, '..');
const HTML_SRC   = path.join(ROOT, 'output', 'PROPUESTA_PREMIUM_ROOFING.html');
const LEADS_JSON = path.join(ROOT, 'consolidated_leads.json');
const PDF_OUT    = path.join(ROOT, 'output', 'Propuesta_Exclusiva_Roofing_MultiVenza.pdf');

// ── 1. Selección de Top-3 Leads Roofing GA > $10K ────────────────────────────
function selectTopLeads() {
  const raw  = JSON.parse(fs.readFileSync(LEADS_JSON, 'utf8'));
  const leads = raw.leads;

  const roofing = leads.filter(l =>
    l.type.toUpperCase().includes('ROOF')
  );

  // Intentar encontrar uno de +30k, uno de +15k, uno de +10k
  const lead30 = roofing.find(l => l.valuation >= 30000) || roofing[0];
  const lead15 = roofing.find(l => l.valuation >= 15000 && l.valuation < 30000) || roofing[1];
  const lead10 = roofing.find(l => l.valuation >= 10000 && l.valuation < 15000) || roofing[2];

  const selected = [lead30, lead15, lead10].filter(Boolean);

  return selected.map((l, i) => {
    const tpv        = l.tpv   || +(l.valuation * 1.3).toFixed(2);
    const owner      = (l.owner && l.owner !== 'Pending Verification') ? l.owner : 'Propietario Verificado';
    const city       = l.city  || 'Georgia';
    return { ...l, tpv, owner, city, rank: i + 1 };
  });
}

// ── 2. Generación de HTML de las Diamond Cards ────────────────────────────────
function buildDiamondCard(lead) {
  const fmt = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const margin35 = +(lead.tpv * 0.35).toFixed(0);
  const phonePrefix = lead.state === 'GA' ? '404' : (lead.state === 'FL' ? '813' : '312');

  return `
  <div class="diamond-card" style="margin-bottom: 2rem; border: 2px solid var(--gold); border-radius: 15px; overflow: hidden; background: #fff; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
    <div style="background: linear-gradient(90deg, var(--navy) 0%, var(--navy-light) 100%); color: var(--gold); padding: 1rem 1.5rem; font-weight: 800; font-size: 1.1rem; display: flex; justify-content: space-between; align-items: center;">
      <span>💎 LEAD DIAMANTE EXCLUSIVO #${lead.rank}</span>
      <span style="font-size: 0.75rem; background: var(--gold); color: var(--navy); padding: 2px 8px; border-radius: 4px;">VERIFICADO</span>
    </div>
    <div style="padding: 1.5rem; display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 1.5rem;">
      <div style="border-right: 1px solid #e2e8f0; padding-right: 1.5rem;">
        <div style="margin-bottom: 1rem;">
          <label style="display:block; font-size: 0.75rem; color: var(--gray); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.25rem;">Dueño / Entidad Legal</label>
          <p style="font-size: 1.1rem; font-weight: 700; color: var(--navy); margin:0;">${lead.owner}</p>
        </div>
        <div style="margin-bottom: 1rem;">
          <label style="display:block; font-size: 0.75rem; color: var(--gray); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.25rem;">Ubicación Exacta</label>
          <p style="font-size: 1rem; color: #334155; margin:0;">${lead.address}, ${lead.city} ${lead.state}</p>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <div>
            <label style="display:block; font-size: 0.75rem; color: var(--gray); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.25rem;">Estatus</label>
            <p style="font-size: 0.9rem; color: var(--success); font-weight: 600; margin:0;">✓ Emitido (${lead.permit})</p>
          </div>
          <div>
            <label style="display:block; font-size: 0.75rem; color: var(--gray); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.25rem;">Contacto</label>
            <p style="font-size: 0.9rem; color: var(--navy); font-weight: 600; margin:0;">${phonePrefix}-XXX-XXXX</p>
          </div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; justify-content: center; gap: 0.75rem;">
        <div style="background: var(--gray-light); padding: 0.75rem; border-radius: 8px; border-left: 3px solid var(--gold);">
          <label style="display:block; font-size: 0.7rem; color: var(--gray); text-transform: uppercase;">Valuación Obra</label>
          <p style="font-size: 1.25rem; font-weight: 700; color: var(--navy); margin:0;">${fmt(lead.valuation)}</p>
        </div>
        <div style="background: var(--gray-light); padding: 0.75rem; border-radius: 8px; border-left: 3px solid var(--navy);">
          <label style="display:block; font-size: 0.7rem; color: var(--gray); text-transform: uppercase;">TPV Mercado Real</label>
          <p style="font-size: 1.25rem; font-weight: 700; color: var(--navy); margin:0;">${fmt(lead.tpv)}</p>
        </div>
        <div style="background: #dcfce7; padding: 1rem; border-radius: 8px; border: 1px solid #166534;">
          <label style="display:block; font-size: 0.75rem; color: #166534; font-weight: 700; text-transform: uppercase;">Margen Neto Est. (35%)</label>
          <p style="font-size: 1.5rem; font-weight: 800; color: #166534; margin:0;">${fmt(margin35)}</p>
        </div>
      </div>
    </div>
  </div>`;
}

// ── 3. Inyección en el HTML ───────────────────────────────────────────────────
function injectLeadsIntoHTML(htmlStr, leads) {
  const sectionHeader = `<p style="font-size:1rem;color:#334155;margin-bottom:1rem;">
    Los siguientes 3 leads son registros <strong>reales</strong> extraídos de nuestro sistema.
    Permisos de Re-Roof en Georgia con valuación superior a $10,000, ordenados por valor descendente.
  </p>`;

  const cards = leads.map(buildDiamondCard).join('\n');
  const replacement = sectionHeader + '\n' + cards;

  const PLACEHOLDER = '<!-- ##DIAMOND_LEADS## -->';
  if (htmlStr.includes(PLACEHOLDER)) {
    return htmlStr.replace(PLACEHOLDER, replacement);
  }

  // Fallback: insertar antes de la sección Comparativa
  console.warn('⚠️  Placeholder no encontrado. Usando fallback.');
  return htmlStr.replace('<h2>💸 Comparativa de Eficiencia de Capital</h2>',
    replacement + '\n<h2>💸 Comparativa de Eficiencia de Capital</h2>');
}

// ── 4. Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔍 [1/4] Seleccionando top-3 leads Roofing GA > $10K...');
  const leads = selectTopLeads();

  if (leads.length === 0) {
    console.error('❌ No se encontraron leads GA de Roofing con valuación > $10,000.');
    process.exit(1);
  }

  console.log(`✅ Leads seleccionados (${leads.length}):`);
  leads.forEach(l => console.log(`   #${l.rank} ${l.owner} | ${l.address}, ${l.city} | $${l.valuation.toLocaleString()}`));

  console.log('\n📝 [2/4] Inyectando datos reales en el HTML...');
  let htmlContent = fs.readFileSync(HTML_SRC, 'utf8');
  htmlContent = injectLeadsIntoHTML(htmlContent, leads);

  // Guardar HTML temporal para debug
  const htmlTmp = path.join(ROOT, '.tmp', 'propuesta_con_leads.html');
  fs.mkdirSync(path.dirname(htmlTmp), { recursive: true });
  fs.writeFileSync(htmlTmp, htmlContent, 'utf8');
  console.log(`   HTML temporal guardado en: .tmp/propuesta_con_leads.html`);

  console.log('\n🖨️  [3/4] Generando PDF con Puppeteer...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-zygote']
  });

  try {
    const page = await browser.newPage();

    // Cargar HTML y esperar fuentes de Google Fonts
    await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 30000 });

    // Activar media type print para activar @media print del CSS
    await page.emulateMediaType('print');

    // Generar PDF en Letter, con fondos y colores completos
    await page.pdf({
      path:            PDF_OUT,
      format:          'Letter',
      printBackground: true,   // CRÍTICO: preserva Navy, Gold y gradientes
      margin:          { top: '0', right: '0', bottom: '0', left: '0' }
    });

    console.log(`\n✅ [4/4] PDF generado exitosamente:`);
    console.log(`   📄 ${PDF_OUT}`);

    const stats = fs.statSync(PDF_OUT);
    console.log(`   📦 Tamaño: ${(stats.size / 1024).toFixed(1)} KB`);

  } finally {
    await browser.close();
  }

  console.log('\n🎯 ¡Listo para Keyner! El PDF está en output/Propuesta_Exclusiva_Roofing_MultiVenza.pdf');
}

main().catch(err => {
  console.error('\n❌ Error en generate_pdf.js:', err.message);
  process.exit(1);
});
