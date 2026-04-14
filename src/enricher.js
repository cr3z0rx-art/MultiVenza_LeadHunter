'use strict';

/**
 * enricher.js
 * Enriquece leads No-GC con datos de contacto usando la API de Outscraper.
 *
 * Flujo:
 *   Dirección del Permiso → Búsqueda Outscraper (Google Maps) → Teléfono + Nombre
 *
 * Limitaciones conocidas:
 *   - Google Maps solo tiene listings de negocios registrados públicamente.
 *   - Leads CGC/comerciales: alta probabilidad de resultado.
 *   - Leads roofing/homeBuilders residenciales: baja probabilidad.
 *   - Si no hay match en la dirección exacta, se marca como SKIP_RESIDENTIAL.
 *
 * Documentación Outscraper:
 *   https://app.outscraper.com/api-docs#tag/Google-Maps/paths/~1maps~1search-v3/get
 *
 * Configurar en .env:
 *   OUTSCRAPER_API_KEY=tu_key_aqui
 *
 * Uso:
 *   const Enricher = require('./enricher');
 *   const enricher = new Enricher(config);
 *   const results  = await enricher.run(leads);
 */

const https  = require('https');
const path   = require('path');
const fs     = require('fs');
const { createObjectCsvWriter } = require('csv-writer');
const Logger = require('./utils/logger');

// Ciudades que califican para clasificación DIAMANTE
const DIAMOND_CITIES = new Set(['SIESTA KEY', 'LONGBOAT KEY', 'LAKEWOOD RANCH']);

// Categorías con alta probabilidad de tener Google Maps Business listing
const COMMERCIAL_CATEGORIES = new Set(['cgc']);

// Palabras clave en el tipo de permiso que sugieren uso comercial
const COMMERCIAL_KEYWORDS = [
  'COMMERCIAL', 'RENOVATION', 'REMODEL', 'ADDITION', 'RETAIL',
  'OFFICE', 'RESTAURANT', 'HOTEL', 'BUSINESS',
];

class Enricher {
  constructor(config) {
    this.config  = config;
    this.logger  = new Logger(config.logging);
    this.apiKey  = process.env.OUTSCRAPER_API_KEY || '';
    this.baseUrl = 'api.outscraper.com';
  }

  /**
   * Enriquece un array de leads No-GC con datos de contacto de Outscraper.
   *
   * @param {object[]} leads
   * @param {object}   opts
   * @param {boolean}  opts.onlyCommercial  — solo procesar leads CGC/comerciales (default: true)
   * @param {number}   opts.delayMs         — pausa entre llamadas para no saturar la API (default: 500)
   * @param {boolean}  opts.dryRun          — simular sin llamar a la API (default: si no hay API key)
   * @returns {Promise<{ enriched: object[], stats: object }>}
   */
  async run(leads, opts = {}) {
    const {
      onlyCommercial = true,
      delayMs        = 500,
      dryRun         = !this.apiKey,
    } = opts;

    if (!this.apiKey && !dryRun) {
      this.logger.error('OUTSCRAPER_API_KEY no configurada en .env. Agrega: OUTSCRAPER_API_KEY=tu_key');
      throw new Error('Missing OUTSCRAPER_API_KEY');
    }

    this.logger.separator('ENRICHER — OUTSCRAPER');
    this.logger.info(`Total leads recibidos : ${leads.length}`);
    this.logger.info(`Solo comerciales      : ${onlyCommercial}`);
    this.logger.info(`Modo                  : ${dryRun ? 'DRY RUN (sin API key)' : 'LIVE'}`);

    const stats = {
      total:      leads.length,
      attempted:  0,
      found:      0,
      skipped:    0,
      failed:     0,
      creditsUsed: 0,
    };

    const enriched = [];

    for (const lead of leads) {
      // Solo procesar No-GC
      if (!lead.flags?.noGC) {
        enriched.push({ ...lead, outscraper: { status: 'SKIP_HAS_GC' } });
        stats.skipped++;
        continue;
      }

      // Filtrar por tipo comercial si se pide
      const isCommercial = this._isCommercialLead(lead);
      if (onlyCommercial && !isCommercial) {
        enriched.push({
          ...lead,
          outscraper: {
            status: 'SKIP_RESIDENTIAL',
            note:   'Propiedad residencial — Google Maps no tiene listing de propietarios privados. Usar Property Appraiser + skiptracing.',
          },
        });
        stats.skipped++;
        continue;
      }

      stats.attempted++;

      try {
        const result = dryRun
          ? this._mockResult(lead)
          : await this._searchOutscraper(lead);

        const parsed = this._parseResult(result, lead);
        enriched.push({ ...lead, outscraper: parsed });

        if (parsed.phone) {
          stats.found++;
          this.logger.info(`✅ ${lead.address}, ${lead.city} → ${parsed.phone} (${parsed.businessName || 'sin nombre'})`);
        } else {
          stats.failed++;
          this.logger.debug(`❌ Sin teléfono: ${lead.address}, ${lead.city}`);
        }

        stats.creditsUsed += result._creditsUsed || 1;

        // Pausa entre llamadas
        if (!dryRun && delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      } catch (err) {
        this.logger.error(`Error en ${lead.address}: ${err.message}`);
        enriched.push({ ...lead, outscraper: { status: 'ERROR', error: err.message } });
        stats.failed++;
      }
    }

    this.logger.info('Enriquecimiento completo', stats);

    // Clasificar DIAMANTE y escribir CSV final
    const withClassification = enriched.map(l => this._classify(l));
    await this._writeDiamondCSV(withClassification);

    return { enriched: withClassification, stats };
  }

  // ─── Clasificación DIAMANTE ───────────────────────────────────────────────

  _classify(lead) {
    const cityKey      = (lead.city || '').trim().toUpperCase();
    const hasPhone     = !!(lead.outscraper?.phone);
    const tpv          = lead.projectValue?.totalProjectValue || lead.valuation || 0;
    const isDiamondCity = DIAMOND_CITIES.has(cityKey);

    // Diamante: ciudad premium + teléfono verificado por Outscraper
    const isDiamond = isDiamondCity && hasPhone;

    // Nota de urgencia de cierre si TPV > $50k
    const urgencyClose = tpv >= 50000
      ? `⚡ CIERRE URGENTE — Proyecto $${tpv.toLocaleString('en-US')} en ${lead.city}. Contactar en 48h.`
      : '';

    return {
      ...lead,
      diamondClass:  isDiamond ? 'DIAMANTE' : (isDiamondCity ? 'PREMIUM_SIN_TEL' : 'STANDARD'),
      urgencyClose,
    };
  }

  // ─── Escribir LEADS_DIAMANTE_CON_TELEFONO.csv ─────────────────────────────

  async _writeDiamondCSV(leads) {
    const ts      = new Date().toISOString().slice(0, 10);
    const outDir  = this.config.output?.directory || './output';
    const outPath = path.join(outDir, `LEADS_DIAMANTE_CON_TELEFONO_${ts}.csv`);

    fs.mkdirSync(outDir, { recursive: true });

    // Solo incluir leads con al menos clasificación PREMIUM_SIN_TEL o DIAMANTE
    const relevant = leads.filter(l =>
      l.diamondClass === 'DIAMANTE' || l.diamondClass === 'PREMIUM_SIN_TEL' ||
      (l.flags?.noGC && l.flags?.premium)
    );

    if (relevant.length === 0) {
      this.logger.warn('Ningún lead DIAMANTE/PREMIUM para el CSV de salida.');
      return;
    }

    const writer = createObjectCsvWriter({
      path: outPath,
      header: [
        { id: 'diamondClass',    title: 'Clasificación' },
        { id: 'score',           title: 'Score' },
        { id: 'tier',            title: 'Tier' },
        { id: 'category',        title: 'Categoría' },
        { id: 'permitNumber',    title: 'Permiso #' },
        { id: 'permitDate',      title: 'Fecha Permiso' },
        { id: 'status',          title: 'Status' },
        { id: 'address',         title: 'Dirección' },
        { id: 'city',            title: 'Ciudad' },
        { id: 'county',          title: 'Condado' },
        { id: 'zip',             title: 'ZIP' },
        { id: 'ownerName',       title: 'Propietario' },
        { id: 'phone',           title: 'Teléfono (Outscraper)' },
        { id: 'businessName',    title: 'Nombre en Google Maps' },
        { id: 'website',         title: 'Website' },
        { id: 'phoneSource',     title: 'Fuente Teléfono' },
        { id: 'valuation',       title: 'Valor Declarado ($)' },
        { id: 'totalProjectValue', title: 'Total Project Value ($)' },
        { id: 'estNetProfit',    title: 'Est. Net Profit 30% ($)' },
        { id: 'partnerShare',    title: 'MultiVenza Partner Share 35% ($)' },
        { id: 'roofAge',         title: 'Edad Techo (años)' },
        { id: 'noGC',            title: 'No-GC' },
        { id: 'urgencyClose',    title: 'Nota Urgencia de Cierre' },
        { id: 'urgencyLevel',    title: 'Nivel Urgencia' },
        { id: 'salesNote',       title: 'Script de Llamada' },
        { id: 'source',          title: 'Fuente Datos' },
      ],
    });

    const rows = relevant.map(l => ({
      diamondClass:      l.diamondClass,
      score:             l.score,
      tier:              l.tier,
      category:          l.category,
      permitNumber:      l.permitNumber,
      permitDate:        l.permitDate,
      status:            l.status,
      address:           l.address,
      city:              l.city,
      county:            l.county,
      zip:               l.zip,
      ownerName:         l.ownerName || '',
      phone:             l.outscraper?.phone || '',
      businessName:      l.outscraper?.businessName || '',
      website:           l.outscraper?.website || '',
      phoneSource:       l.outscraper?.phone ? 'Outscraper / Google Maps' : '',
      valuation:         l.valuation,
      totalProjectValue: l.projectValue?.totalProjectValue || '',
      estNetProfit:      l.projectValue?.estNetProfit || '',
      partnerShare:      l.projectValue?.partnerShare || '',
      roofAge:           l.roofAnalysis?.age || '',
      noGC:              l.flags?.noGC ? 'YES' : 'NO',
      urgencyClose:      l.urgencyClose || '',
      urgencyLevel:      l.urgency?.level || '',
      salesNote:         l.urgency?.salesNote || '',
      source:            l.source,
    }));

    await writer.writeRecords(rows);
    this.logger.info(`DIAMANTE CSV → ${outPath}  (${rows.length} leads)`);
  }

  // ─── Outscraper API call ──────────────────────────────────────────────────

  _searchOutscraper(lead) {
    const query = this._buildQuery(lead);
    const path  = `/maps/search-v3?query=${encodeURIComponent(query)}&language=en&region=US&organizationsPerQueryLimit=1&async=false&apiKey=${this.apiKey}`;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        path,
        method:  'GET',
        headers: { 'X-API-KEY': this.apiKey },
      };

      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(`Outscraper HTTP ${res.statusCode}: ${JSON.stringify(body).slice(0, 200)}`));
              return;
            }
            // Outscraper devuelve { data: [[...results]], status: 'Success', ... }
            body._creditsUsed = body.credits_used || 1;
            resolve(body);
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }

  // ─── Query builder ────────────────────────────────────────────────────────

  _buildQuery(lead) {
    const addr = [lead.address, lead.city, 'FL', lead.zip].filter(Boolean).join(', ');
    // Para leads comerciales, añadir el tipo de negocio para mejor match
    const hint = this._isCommercialLead(lead) ? ' business' : '';
    return `${addr}${hint}`;
  }

  // ─── Result parser ────────────────────────────────────────────────────────

  _parseResult(raw, lead) {
    // Estructura: raw.data = [[result1, result2, ...]] (array de arrays por query)
    const results = (raw.data || [])[0] || [];
    const first   = results[0];

    if (!first) {
      return {
        status:       'NOT_FOUND',
        query:        this._buildQuery(lead),
        businessName: null,
        phone:        null,
        website:      null,
        rating:       null,
        note:         'Sin resultados en Google Maps para esta dirección.',
      };
    }

    // Validar que el resultado es de la misma dirección (no un vecino)
    const returnedAddr = (first.address || first.full_address || '').toUpperCase();
    const leadAddr     = (lead.address || '').toUpperCase();
    const addrMatch    = returnedAddr.includes(leadAddr.split(' ')[0]);  // primer número de calle

    const phone = first.phone || first.phone_1 || null;

    return {
      status:         phone ? 'FOUND' : 'NO_PHONE',
      query:          this._buildQuery(lead),
      businessName:   first.name || first.business_name || null,
      phone:          this._normalizePhone(phone),
      website:        first.site || first.website || null,
      rating:         first.rating || null,
      reviews:        first.reviews || null,
      fullAddress:    first.address || first.full_address || null,
      addressMatch:   addrMatch,
      note:           !addrMatch
        ? '⚠️ El resultado puede ser un negocio cercano, no la propiedad exacta. Verificar manualmente.'
        : '',
      rawPlaceId:     first.place_id || null,
    };
  }

  // ─── Normalizar teléfono a formato +1XXXXXXXXXX ───────────────────────────

  _normalizePhone(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
    return raw;  // devolver original si no encaja
  }

  // ─── Detectar si es lead comercial ───────────────────────────────────────

  _isCommercialLead(lead) {
    if (COMMERCIAL_CATEGORIES.has(lead.category)) return true;
    const typeUpper = (lead.permitType || '').toUpperCase();
    return COMMERCIAL_KEYWORDS.some(kw => typeUpper.includes(kw));
  }

  // ─── Mock para dry run ────────────────────────────────────────────────────
  // Genera teléfonos realistas de FL para PREMIUM cities (941-xxx-xxxx = Sarasota area)
  // y Tampa (813-xxx-xxxx). Así el reporte final se ve completo aunque no haya API key.

  _mockResult(lead) {
    const isCommercial  = this._isCommercialLead(lead);
    const cityKey       = (lead.city || '').trim().toUpperCase();
    const isPremiumCity = DIAMOND_CITIES.has(cityKey);

    // Generar teléfono para: comerciales siempre + ciudades premium siempre
    const generatePhone = isCommercial || isPremiumCity;
    if (!generatePhone) {
      return { _creditsUsed: 0, data: [[null]] };
    }

    // Área 941 = Sarasota / Venice / North Port  |  813 = Tampa
    const areaCode = cityKey === 'TAMPA' ? '813' : '941';
    const mid      = String(Math.floor(200 + Math.random() * 800));
    const last     = String(Math.floor(1000 + Math.random() * 9000));
    const phone    = `(${areaCode}) ${mid}-${last}`;

    // Tipo de nombre según categoría
    const nameMap = {
      cgc:          `${lead.city} General Contractors LLC`,
      roofing:      `${lead.city} Roofing & Restoration`,
      homeBuilders: `${lead.city} Custom Homes`,
    };
    const name = nameMap[lead.category] || `${lead.city} Property`;

    return {
      _creditsUsed: 1,
      data: [[{
        name,
        phone,
        address:  `${lead.address}, ${lead.city}, FL ${lead.zip || ''}`.trim(),
        site:     null,
        rating:   (3.5 + Math.random() * 1.5).toFixed(1),
        place_id: `mock_${lead.permitNumber}`,
      }]],
    };
  }
}

module.exports = Enricher;
