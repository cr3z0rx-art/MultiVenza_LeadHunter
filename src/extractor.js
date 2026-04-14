'use strict';

/**
 * extractor.js
 * Pulls permit records from Florida West Coast county sources via Apify.
 *
 * Actor used: apify/puppeteer-scraper  (NOT web-scraper)
 *   — web-scraper injects jQuery which breaks on modern county SPA portals
 *   — puppeteer-scraper exposes the full Puppeteer `page` API, allowing
 *     proper navigation, form interaction, and waitFor logic
 *
 * County portal drivers:
 *   Sarasota     → Accela Citizen Access (ACA)  aca.accela.com/SARASOTA
 *   Hillsborough → eTRAKiT                       onestop.hillsboroughcounty.org
 *   Others       → generic HTML table fallback
 *
 * run(runOptions) accepts:
 *   counties         string[]  — restrict to specific county names (default: all)
 *   permitTypes      string[]  — keyword filter on permitType field (default: all)
 *   maxItemsPerSource number   — cap records per county source
 *   demoMode         boolean   — skip Apify, return realistic sample FL data
 *                                (auto-enabled when APIFY_TOKEN absent)
 *
 * RawPermit shape:
 * {
 *   permitNumber, permitType, permitDate, status,
 *   address, city, county, zip,
 *   ownerName, contractorName, contractorLic,
 *   valuation, roofYear, source,
 *   tier: 'PREMIUM'|'STANDARD', tags: string[]
 * }
 */

const { ApifyClient } = require('apify-client');
const Logger = require('./utils/logger');

const COUNTY_CONFIG = {
  Hillsborough: {
    url:    'https://www.hillsboroughcounty.org/en/residents/property-owner-tools/building-permits',
    driver: 'etrakit',
  },
  Sarasota: {
    url:    'https://aca.accela.com/SARASOTA/Cap/CapHome.aspx?module=Building&TabName=Building',
    driver: 'accela',
  },
  Pinellas: {
    url:    'https://egov.pinellascounty.org/permits/',
    driver: 'generic',
  },
  Manatee: {
    url:    'https://www.mymanatee.org/departments/building___development_services/building_permits',
    driver: 'generic',
  },
  Charlotte: {
    url:    'https://www.charlottecountyfl.gov/departments/community-development/building-construction-services',
    driver: 'generic',
  },
};

class Extractor {
  constructor(config) {
    this.config = config;
    this.logger = new Logger(config.logging);

    this._targetCities  = new Set(
      (config.region.targetCities  || []).map(c => c.trim().toUpperCase())
    );
    this._premiumCities = new Set(
      (config.region.premiumCities || []).map(c => c.trim().toUpperCase())
    );
  }

  async run(runOptions = {}) {
    this.logger.separator('EXTRACTOR');

    const token = this.config.apify.token;
    const useDemoMode = runOptions.demoMode
      || !token
      || token === '${APIFY_TOKEN}'
      || token.trim() === '';

    if (useDemoMode) {
      this.logger.warn('APIFY_TOKEN not set — running in DEMO MODE with sample Florida permit data.');
      this.logger.warn('Set APIFY_TOKEN in .env to enable live extraction.');
      return this._runDemo(runOptions);
    }

    this.client = new ApifyClient({ token });
    return this._runLive(runOptions);
  }

  // ─── Live Apify extraction ────────────────────────────────────────────────

  async _runLive(runOptions) {
    const { counties, maxItemsPerSource } = runOptions;
    const sources = this._filterSources(counties);
    this.logger.info(`Live extraction (puppeteer-scraper): ${sources.length} source(s)`,
      { counties: sources.map(s => s.name) });

    const allRecords = [];

    for (const source of sources) {
      this.logger.info(`Extracting from ${source.name}`, { url: source.url, driver: source.driver });
      try {
        const raw = await this._runActor(source, maxItemsPerSource || 25);
        const filtered = this._filterByPermitType(raw, runOptions.permitTypes);
        this.logger.info(`${source.name}: ${raw.length} scraped → ${filtered.length} after type filter`);
        allRecords.push(...filtered);
      } catch (err) {
        this.logger.error(`Failed: ${source.name}`, { error: err.message });
      }
    }

    this.logger.info(`Extraction complete. Total: ${allRecords.length} records`);
    return allRecords;
  }

  async _runActor(source, maxItems) {
    const run = await this.client.actor('apify/puppeteer-scraper').call({
      startUrls:          [{ url: source.url }],
      maxPagesPerCrawl:   5,
      maxConcurrency:     1,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
      pageFunction:       this._buildPageFunction(source.driver, source.name, maxItems),
      launchPuppeteerOptions: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    const { items } = await this.client.dataset(run.defaultDatasetId).listItems();

    // puppeteer-scraper wraps results; flatten nested arrays
    const flat = items.flatMap(item =>
      Array.isArray(item.permits) ? item.permits : Array.isArray(item) ? item : [item]
    );

    return flat.map(item => this._normalize(item, source.name, source.url));
  }

  // ─── Page function builders ───────────────────────────────────────────────

  /**
   * Returns a serialised Puppeteer page function string.
   * Puppeteer-scraper exposes context.page (Puppeteer Page) — no jQuery needed.
   */
  _buildPageFunction(driver, county, maxItems) {
    switch (driver) {
      case 'accela':    return this._accelaPageFn(county, maxItems);
      case 'etrakit':   return this._etrakitPageFn(county, maxItems);
      default:          return this._genericPageFn(county, maxItems);
    }
  }

  /**
   * Accela Citizen Access (ACA) — used by Sarasota County.
   * Searches for Building permits by permit type, waits for the results grid,
   * then extracts up to maxItems rows.
   */
  _accelaPageFn(county, maxItems) {
    return `
      async function pageFunction(context) {
        const { page, request, log } = context;
        const results = [];

        try {
          // Wait for the page to stabilise (page.waitForTimeout removed in Puppeteer v21)
          await new Promise(r => setTimeout(r, 3000));

          // ── Trigger a search for ALL recent building permits ──────────────
          // ACA search button is usually #ctl00_PlaceHolderMain_btnNewSearch
          const searchBtn = await page.$('#ctl00_PlaceHolderMain_btnNewSearch, input[value="Search"], button.ACA_Button_Style');
          if (searchBtn) {
            await searchBtn.click();
            await new Promise(r => setTimeout(r, 4000));
          }

          // ── Extract results from the ACA grid ─────────────────────────────
          // ACA renders results in a table — rows have class ACA_GridItem_FontSize or ACA_AlternatingRow_FontSize
          const rows = await page.evaluate((maxItems) => {
            const data = [];
            const rowSelectors = [
              'tr.ACA_GridItem_FontSize',
              'tr.ACA_AlternatingRow_FontSize',
              'tr[class*="GridItem"]',
              'tr[class*="AlternatingRow"]',
              '#ctl00_PlaceHolderMain_CapListGrid tr:not(:first-child)',
            ];

            let rowElements = [];
            for (const sel of rowSelectors) {
              rowElements = Array.from(document.querySelectorAll(sel));
              if (rowElements.length > 0) break;
            }

            // Fallback: any table rows with 5+ cells
            if (rowElements.length === 0) {
              rowElements = Array.from(document.querySelectorAll('table tr')).filter(r =>
                r.querySelectorAll('td').length >= 5
              );
            }

            rowElements.slice(0, maxItems).forEach(row => {
              const cells = Array.from(row.querySelectorAll('td'));
              if (cells.length < 4) return;
              const getText = (idx) => cells[idx] ? cells[idx].textContent.trim() : null;

              data.push({
                permitNumber:   getText(0) || getText(1),
                permitType:     getText(1) || getText(2),
                permitDate:     getText(3) || getText(4),
                status:         getText(2) || getText(5),
                address:        getText(5) || getText(6) || getText(3),
                ownerName:      getText(7) || getText(8) || null,
                contractorName: getText(9) || getText(10) || null,
                contractorLic:  getText(11) || null,
                valuation:      parseFloat((getText(12) || getText(13) || '').replace(/[^0-9.]/g,'')) || null,
              });
            });
            return data;
          }, ${maxItems});

          log.info('Accela ACA scraped ' + rows.length + ' rows');
          return [{ permits: rows, county: '${county}', source: request.url }];
        } catch(e) {
          log.error('Accela page function error: ' + e.message);
          return [{ permits: [], county: '${county}', error: e.message }];
        }
      }
    `;
  }

  /**
   * eTRAKiT — used by Hillsborough County.
   * Types a wildcard search, submits, waits for grid, extracts rows.
   */
  _etrakitPageFn(county, maxItems) {
    return `
      async function pageFunction(context) {
        const { page, request, log } = context;

        try {
          await new Promise(r => setTimeout(r, 3000));

          // ── Try to find and submit the search form ───────────────────────
          // eTRAKiT permit search typically has a text input for permit number/address
          const searchInput = await page.$('#PermitNumber, #txtPermitNum, input[name*="permit" i], input[id*="search" i]');
          if (searchInput) {
            await searchInput.type('%');  // wildcard
            const btn = await page.$('input[value*="Search" i], button[id*="search" i], input[type="submit"]');
            if (btn) {
              await btn.click();
              await new Promise(r => setTimeout(r, 5000));
            }
          }

          // ── Extract from the eTRAKiT results grid ────────────────────────
          const rows = await page.evaluate((maxItems) => {
            const data = [];
            const rowSelectors = [
              'tr.GridRow', 'tr.GridAltRow',
              '#PermitResults tr:not(:first-child)',
              'table#tblPermits tr:not(:first-child)',
              'table tr',
            ];

            let rowElements = [];
            for (const sel of rowSelectors) {
              rowElements = Array.from(document.querySelectorAll(sel));
              if (rowElements.length > 0) break;
            }

            rowElements.slice(0, maxItems).forEach(row => {
              const cells = Array.from(row.querySelectorAll('td'));
              if (cells.length < 4) return;
              const getText = (idx) => cells[idx] ? cells[idx].textContent.trim() : null;

              data.push({
                permitNumber:   getText(0),
                permitType:     getText(1),
                permitDate:     getText(2),
                status:         getText(3),
                address:        getText(4),
                ownerName:      getText(5) || null,
                contractorName: getText(6) || null,
                contractorLic:  getText(7) || null,
                valuation:      parseFloat((getText(8) || '').replace(/[^0-9.]/g,'')) || null,
              });
            });
            return data;
          }, ${maxItems});

          log.info('eTRAKiT scraped ' + rows.length + ' rows');
          return [{ permits: rows, county: '${county}', source: request.url }];
        } catch(e) {
          log.error('eTRAKiT page function error: ' + e.message);
          return [{ permits: [], county: '${county}', error: e.message }];
        }
      }
    `;
  }

  /**
   * Generic fallback — pure DOM, no jQuery, handles any standard HTML permit table.
   */
  _genericPageFn(county, maxItems) {
    return `
      async function pageFunction(context) {
        const { page, request, log } = context;
        await new Promise(r => setTimeout(r, 2000));

        const rows = await page.evaluate((maxItems) => {
          const data = [];
          const allRows = Array.from(document.querySelectorAll('table tr')).filter(r =>
            r.querySelectorAll('td').length >= 4
          );
          allRows.slice(0, maxItems).forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            const getText = (idx) => cells[idx] ? cells[idx].textContent.trim() : null;
            data.push({
              permitNumber:   getText(0),
              permitType:     getText(1),
              permitDate:     getText(2),
              status:         getText(3),
              address:        getText(4),
              ownerName:      getText(5) || null,
              contractorName: getText(6) || null,
              contractorLic:  getText(7) || null,
              valuation:      parseFloat((getText(8)||'').replace(/[^0-9.]/g,'')) || null,
            });
          });
          return data;
        }, ${maxItems});

        log.info('Generic scraper: ' + rows.length + ' rows from ' + request.url);
        return [{ permits: rows, county: '${county}', source: request.url }];
      }
    `;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _filterSources(counties) {
    const all = Object.entries(COUNTY_CONFIG).map(([name, cfg]) => ({ name, ...cfg }));
    if (!counties || counties.length === 0) return all;
    const upper = counties.map(c => c.toUpperCase());
    return all.filter(s => upper.includes(s.name.toUpperCase()));
  }

  _filterByPermitType(records, permitTypes) {
    if (!permitTypes || permitTypes.length === 0) return records;
    const keywords = permitTypes.map(t => t.toUpperCase());
    return records.filter(r => {
      const type = (r.permitType || '').toUpperCase();
      return keywords.some(kw => type.includes(kw));
    });
  }

  _normalize(item, county, sourceUrl) {
    const city = this._str(item.city || item.City || '') || '';
    const { tier, tags } = this._classifyCity(city);

    return {
      permitNumber:   this._str(item.permitNumber || item.permit_number || item.PermitNumber),
      permitType:     this._str(item.permitType   || item.permit_type   || item.PermitType || item.description),
      permitDate:     this._str(item.permitDate   || item.permit_date   || item.issueDate  || item.IssueDate),
      status:         this._str(item.status       || item.Status        || item.permitStatus || 'UNKNOWN'),
      address:        this._str(item.address      || item.Address       || item.siteAddress),
      city,
      county:         this._str(item.county       || county),
      zip:            this._str(item.zip          || item.Zip           || item.zipCode || ''),
      ownerName:      this._str(item.ownerName    || item.owner         || null),
      contractorName: this._str(item.contractorName || item.contractor  || item.ContractorName || null),
      contractorLic:  this._str(item.contractorLic  || item.licenseNum  || item.ContractorLicense || null),
      valuation:      parseFloat(item.valuation   || item.Valuation     || 0) || null,
      roofYear:       this._str(item.roofYear     || item.roof_year     || null),
      source:         sourceUrl,
      tier,
      tags,
    };
  }

  _classifyCity(city) {
    const upper = city.trim().toUpperCase();
    const isPremium = this._premiumCities.has(upper);
    return {
      tier: isPremium ? 'PREMIUM' : 'STANDARD',
      tags: isPremium ? ['PREMIUM'] : [],
    };
  }

  _str(val) {
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    return s === '' ? null : s;
  }

  // ─── Demo mode ────────────────────────────────────────────────────────────

  _runDemo(runOptions) {
    const { counties = ['Sarasota', 'Hillsborough'], maxItemsPerSource = 25 } = runOptions;
    this.logger.info('Generating demo dataset', { counties, maxItemsPerSource });

    const allRecords = [];
    for (const county of counties) {
      const records = this._generateCountyRecords(county, maxItemsPerSource);
      this.logger.info(`[DEMO] ${county}: generated ${records.length} records`);
      allRecords.push(...records);
    }
    this.logger.info(`[DEMO] Total sample records: ${allRecords.length}`);
    return allRecords;
  }

  _generateCountyRecords(county, limit) {
    const cityPool = DEMO_CITIES[county] || [];
    const records  = [];

    for (let i = 0; i < limit; i++) {
      const permitType = PERMIT_TYPES[i % PERMIT_TYPES.length];
      const city       = cityPool[i % cityPool.length];
      const template   = DEMO_TEMPLATES[county][i % DEMO_TEMPLATES[county].length];
      const issueDate  = randomPastDate(i);
      const permitNum  = `${county.slice(0,4).toUpperCase()}-2024-${String(1000 + i).padStart(5,'0')}`;
      const sourceUrl  = COUNTY_CONFIG[county]?.url || `https://${county.toLowerCase()}county.gov/permits`;

      const raw = {
        permitNumber:   permitNum,
        permitType:     permitType.label,
        permitDate:     issueDate,
        status:         STATUSES[i % STATUSES.length],
        address:        template.addresses[i % template.addresses.length],
        city,
        county,
        zip:            template.zips[i % template.zips.length],
        ownerName:      template.owners[i % template.owners.length],
        contractorName: i % 4 === 0 ? null : template.contractors[i % template.contractors.length],
        contractorLic:  i % 4 === 0 ? null : `CGC${1050000 + i}`,
        valuation:      template.valuations[i % template.valuations.length],
        roofYear:       permitType.id === 'roofing' ? issueDate : null,
        source:         sourceUrl,
      };

      records.push(this._normalize(raw, county, sourceUrl));
    }

    return records;
  }
}

// ─── Demo data tables ─────────────────────────────────────────────────────────

const PERMIT_TYPES = [
  { id: 'roofing',   label: 'RESIDENTIAL ROOFING - RE-ROOF' },
  { id: 'roofing',   label: 'RESIDENTIAL ROOFING - SHINGLE REPLACEMENT' },
  { id: 'roofing',   label: 'RESIDENTIAL ROOFING - TILE ROOF' },
  { id: 'new_const', label: 'NEW CONSTRUCTION - SINGLE FAMILY RESIDENTIAL' },
  { id: 'new_const', label: 'NEW CONSTRUCTION - CUSTOM HOME' },
];

const STATUSES = ['ISSUED', 'FINALED', 'APPLIED', 'EXPIRED', 'ISSUED'];

const DEMO_CITIES = {
  Sarasota:     ['Sarasota', 'Siesta Key', 'Venice', 'Nokomis', 'North Port', 'Laurel', 'Siesta Key'],
  Hillsborough: ['Tampa', 'Tampa', 'Tampa'],
};

function randomPastDate(seed) {
  const yearsAgo = 2 + (seed % 19);
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  d.setMonth(seed % 12);
  d.setDate(1 + (seed % 28));
  return d.toISOString().slice(0, 10);
}

const DEMO_TEMPLATES = {
  Sarasota: [{
    addresses:   ['4825 MIDNIGHT PASS RD','8712 CRESCENT DR','211 BEACH RD','1042 POINT OF ROCKS RD','330 CANAL RD','5415 GULF DR','918 INLETS BLVD','1724 TAMIMI TRL S','3302 BORDER RD','6201 NORTH PORT BLVD','2140 PRICE BLVD','9008 DEER HOLLOW BLVD','447 NOKOMIS AVE S','1610 LAUREL RD E','3205 TAMIAMI TRL N','7722 BARKLEY CIR','12204 PALATKA RD','890 WHITFIELD AVE','5101 CLARK RD','444 GOLDEN GATE PT','2850 RINGLING BLVD','1400 SIESTA DR','7800 N TAMIAMI TRL','301 OSPREY AVE','5009 OCEAN BLVD'],
    zips:        ['34242','34231','34285','34275','34287','34234','34239'],
    owners:      ['MARTINEZ CARLOS & ANA','JOHNSON ROBERT T','NGUYEN HENRY','SMITH PATRICIA L','ANDERSON WILLIAM','GARCIA MARIA','THOMPSON DAVID R','WHITE KAREN M','HARRIS JAMES','LEWIS BARBARA','WALKER MICHAEL','HALL LINDA','ALLEN RICHARD','YOUNG DOROTHY','KING CHARLES','WRIGHT HELEN','SCOTT JOSEPH','GREEN SANDRA','ADAMS DONALD','BAKER BETTY','NELSON GEORGE','CARTER RUTH','MITCHELL EDWARD','PEREZ MARIA','ROBERTS THOMAS'],
    contractors: ['GULF COAST ROOFING LLC','SUNCOAST BUILDERS INC','FLORIDA PREMIER ROOFING','SARASOTA CONSTRUCTION GROUP','GULF VIEW CONTRACTORS','OWNER BUILDER','COASTAL RENOVATIONS LLC','TROPICAL ROOFING SPECIALISTS'],
    valuations:  [12500,18750,9800,22000,345000,15400,480000,11200,275000,8500,390000,14300,520000,16800,9200,265000,13700,19500,440000,11900,310000,17200,8800,295000,21000],
  }],
  Hillsborough: [{
    addresses:   ['4102 HENDERSON BLVD','2215 SWANN AVE','801 S DALE MABRY HWY','5210 BAYSHORE BLVD','3800 W GANDY BLVD','1420 N ARMENIA AVE','6215 GUNN HWY','910 W KENNEDY BLVD','3311 W CYPRESS ST','714 S HOWARD AVE','4507 N CLARK AVE','2101 E LAKE AVE','1805 W PLATT ST','5310 BRIDGE ST','3915 W BAY TO BAY BLVD','2220 E HILLSBOROUGH AVE','7105 N FLORIDA AVE','1620 CHANNELSIDE DR','4800 EHRLICH RD','320 S ARMENIA AVE','5820 W LINEBAUGH AVE','2414 N ROME AVE','9001 SHELDON RD','3400 W UNION ST','1211 S MACDILL AVE'],
    zips:        ['33609','33606','33611','33629','33614','33612','33617'],
    owners:      ['RODRIGUEZ JOSE A','WILLIAMS MARY','BROWN JAMES E','DAVIS LINDA K','MILLER ROBERT','WILSON PATRICIA','MOORE CHARLES','TAYLOR BARBARA','JACKSON RICHARD','LEE HELEN','THOMAS FRANK','HERNANDEZ ANA','GONZALEZ MIGUEL','LOPEZ CARMEN','SANCHEZ PEDRO','CLARK DOROTHY','LEWIS GEORGE','ROBINSON RUTH','WALKER PAUL','HALL CAROL','ALLEN MARK','YOUNG DIANE','KING STEVEN','WRIGHT ALICE','SCOTT LARRY'],
    contractors: ['TAMPA BAY ROOFING CO','SUNBELT CONSTRUCTION INC','FLORIDA HOME BUILDERS LLC','OWNER BUILDER','HILLSBOROUGH ROOFING PROS','BAY AREA CONTRACTORS GROUP','PREMIER FLORIDA ROOFING','METRO CONSTRUCTION SERVICES'],
    valuations:  [14200,21500,9500,385000,16800,450000,12300,19700,295000,11400,375000,18200,520000,13900,22500,275000,10800,415000,17500,9100,340000,15600,490000,20100,11700],
  }],
};

module.exports = Extractor;
