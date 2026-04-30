'use strict';

/**
 * processor.js
 * Ingests raw permit records, applies business rules, scores and prioritizes
 * leads, then writes categorized output files (JSON + CSV).
 * 
 * Performance Optimized: Uses parallel processing for async tasks like Geocoding.
 */

const path = require('path');
const fs = require('fs-extra');
const { createObjectCsvWriter } = require('csv-writer');
const Logger = require('./utils/logger');
const rules = require('./utils/rules');
const { validateAddress } = require('./utils/address_validator');
const Geocoder = require('./utils/geocoder');
const { cleanName, cleanAddress, splitName, standardizeUSPS } = require('./utils/cleaner');

class Processor {
  constructor(config) {
    this.config = config;
    this.logger = new Logger(config.logging);
    this.filters = config.filters;
    this.scoring = config.scoring;
    this.cats = config.leadCategories;
    this.commission = config.commission;
    this.geocoder = new Geocoder(process.env.GOOGLE_MAPS_API_KEY);

    // Normalized city sets for O(1) lookups
    this._targetCities = new Set(
      (config.region.targetCities || []).map(c => c.trim().toUpperCase())
    );
    this._premiumCities = new Set(
      (config.region.premiumCities || []).map(c => c.trim().toUpperCase())
    );

    fs.mkdirSync(config.output.directory, { recursive: true });
  }

  /**
   * Processes an array of raw permit records in parallel.
   * @param {object[]} rawRecords
   * @param {number} concurrency - Limit for parallel processing
   * @returns {Promise<{ leads: object[], stats: object }>}
   */
  async run(rawRecords, concurrency = 10) {
    this.logger.separator('PROCESSOR (PARALLEL MODE)');
    this.logger.info(`Processing ${rawRecords.length} raw records with concurrency ${concurrency}`);

    const leads = [];
    const competitors = [];
    const stats = {
      total: rawRecords.length,
      passed: 0,
      dropped: 0,
      byCategory: { roofing: 0, cgc: 0, homeBuilders: 0, other: 0 },
      noGC: 0,
      roofCritical: 0,
      roofWarm: 0,
      premium: 0,
      totalProjectValue: 0,
      estNetProfitTotal: 0,
    };

    const queue = [...rawRecords];
    const activeTasks = [];

    const worker = async (record) => {
      try {
        const result = await this._processRecord(record);
        if (result) {
          if (result.isCompetitor) {
            competitors.push(result.data);
            stats.dropped++;
          } else {
            leads.push(result);
            stats.passed++;
            stats.byCategory[result.category] = (stats.byCategory[result.category] || 0) + 1;
            if (result.flags.noGC) stats.noGC++;
            if (result.flags.premium) stats.premium++;
            if (result.roofAnalysis.classification === 'critical') stats.roofCritical++;
            if (result.roofAnalysis.classification === 'warm') stats.roofWarm++;
            stats.totalProjectValue += result.projectValue.totalProjectValue;
            stats.estNetProfitTotal += result.projectValue.estNetProfit;
          }
        } else {
          stats.dropped++;
        }
      } catch (err) {
        this.logger.error(`Error processing record ${record.permitNumber}: ${err.message}`);
        stats.dropped++;
      }
    };

    // Parallel execution loop
    while (queue.length > 0 || activeTasks.length > 0) {
      while (activeTasks.length < concurrency && queue.length > 0) {
        const record = queue.shift();
        const task = worker(record).then(() => {
          activeTasks.splice(activeTasks.indexOf(task), 1);
        });
        activeTasks.push(task);
      }
      if (activeTasks.length > 0) {
        await Promise.race(activeTasks);
      }
    }

    // Sort: highest score first
    leads.sort((a, b) => b.score - a.score);

    this.logger.info('Processing complete', stats);
    await this._writeOutputs(leads);

    return { leads, competitors, stats };
  }

  // ─── Per-record pipeline (Async) ──────────────────────────────────────────

  async _processRecord(record) {
    // 0. City filter (only for Florida leads if an explicit targetCities list is configured)
    if (this.filters.cityFilter?.enabled && record.state === 'FL' && !this._inTargetCity(record.city)) {
      return null;
    }

    // 0.5 Keyword filter
    if (this.filters.keywordFilter?.enabled) {
      const typeStr = (record.permitType || '').toUpperCase();
      const hasMatch = this.filters.keywordFilter.allowed.some(kw => typeStr.includes(kw));
      if (!hasMatch) return null;
    }

    // --- FILTRO DE PRODUCCIÓN ESTRICTO ---
    const sourceStr = (record.source || '').toUpperCase();
    if (sourceStr.includes('DEMO')) {
      this.logger.debug(`Dropped ${record.permitNumber}: Source is DEMO`);
      return null;
    }

    if (!record.valuation || record.valuation <= 0) {
      this.logger.debug(`Dropped ${record.permitNumber}: No real valuation`);
      return null;
    }

    if (!record.address || record.address.length < 5) {
      this.logger.debug(`Dropped ${record.permitNumber}: Incomplete physical address`);
      return null;
    }

    // Hard Filter No-GC (HotRadar priority)
    if (!rules.isNoGC(record.contractorName)) {
      return null;
    }

    // 1. Status filter
    if (!this._passesStatusFilter(record.status)) {
      return null;
    }

    // 2. Category detection
    const category = rules.detectCategory(record.permitType, this.cats);
    if (!category) {
      return null;
    }

    // 3. Valuation gate
    const valuation = record.valuation || 0;
    if (valuation > 0 && valuation < this.filters.valuationMin) {
      return null;
    }

    // 4. No-GC rule
    const noGC = rules.isNoGC(record.contractorName);

    // 4b. Hard No-GC filter when requireNoGC is enabled
    if (this.filters.requireNoGC && !noGC) {
      if (record.contractorName && record.contractorName.trim().length > 2) {
        return {
          isCompetitor: true,
          data: {
            permitNumber: record.permitNumber,
            state: record.state || 'FL',
            county: record.county || null,
            city: record.city || null,
            contractorName: cleanName(record.contractorName),
            projectType: category,
            valuation: valuation,
            permitDate: record.permitDate || null
          }
        };
      }
      return null;
    }

    // 5. 15-Year roof analysis
    const roofAnalysis = rules.applyRoofAgeRule(record, this.filters.roofAgeRule);

    // 6. Premium city
    const isPremium = record.tier === 'PREMIUM' || this._isPremiumCity(record.city);

    // 8. Total Project Value
    const projectValue = this._calcProjectValue(valuation, isPremium, category);

    // Tier
    const tier = projectValue.tierName;
    const tags = record.tags ? [...record.tags] : [];
    if (isPremium && !tags.includes('PREMIUM')) tags.push('PREMIUM');

    // Add EXPANSION_TEST for non-FL
    if (record.state && record.state !== 'FL' && !tags.includes('EXPANSION_TEST')) {
      tags.push('EXPANSION_TEST');
    }

    // 7. Score
    const score = this._calculateScore(category, noGC, roofAnalysis, valuation, isPremium, record);

    // 8. Total Project Value (moved up)

    // 9. Address validation & Robust Geocoding
    let addrValidation = validateAddress(record.address, record.city, record.zip);
    
    // If local validation fails but we have Google Maps API, attempt robust check
    if (addrValidation.status === 'UNVERIFIED' && process.env.GOOGLE_MAPS_API_KEY) {
        const geoResult = await this.geocoder.geocode(record.address, record.city, record.zip);
        if (geoResult) {
            addrValidation = {
                normalizedAddress: geoResult.formattedAddress,
                status: geoResult.partialMatch ? 'CORRECTED' : 'VALID',
                note: geoResult.partialMatch ? 'Corregido vía Google Maps' : 'Verificado vía Google Maps'
            };
        }
    }

    if (addrValidation.status === 'UNVERIFIED' && !tags.includes('DIRECCIÓN_UNVERIFIED')) {
      tags.push('DIRECCIÓN_UNVERIFIED');
    }

    // 10. Urgency Skill
    const urgencyPartial = {
      category, flags: { noGC, premium: isPremium },
      roofAnalysis, status: record.status,
      city: record.city,
      projectValue,
      valuation,
    };
    const urgency = rules.evaluateUrgency(urgencyPartial, { roofUrgencyAge: 18 });
    if (urgency.urgent && !tags.includes('URGENTE')) tags.push('URGENTE');

    const cleanedOwner = cleanName(record.ownerName);
    const { firstName, lastName } = splitName(cleanedOwner);
    const uspsAddress = standardizeUSPS(addrValidation.normalizedAddress || record.address);

    if (cleanedOwner) {
      if (lastName === '') {
        if (!tags.includes('COMMERCIAL')) tags.push('COMMERCIAL');
      } else {
        if (!tags.includes('HOT_LEAD')) tags.push('HOT_LEAD');
      }
    }

    // 11. Build lead object
    return {
      leadId: this._leadId(record),
      permitNumber: record.permitNumber,
      category,
      tier,
      tags,
      permitType: record.permitType,
      permitDate: record.permitDate,
      status: record.status,
      address: cleanAddress(record.address),
      addressUSPS: uspsAddress,
      addressFormatted: addrValidation.normalizedAddress,
      addressStatus: addrValidation.status,
      addressNote: addrValidation.note,
      city: record.city,
      state: record.state || (
        record.city?.toUpperCase().includes('HOUSTON') ? 'TX' :
        record.city?.toUpperCase().includes('PHOENIX') ? 'AZ' :
        record.city?.toUpperCase().includes('ATLANTA') ? 'GA' : 'FL'
      ),
      county: record.county,
      zip: record.zip,
      ownerName: cleanedOwner,
      firstName,
      lastName,
      contractorName: cleanName(record.contractorName),
      contractorLic: record.contractorLic,
      valuation,
      roofAnalysis,
      projectValue,
      flags: {
        noGC,
        premium: isPremium,
        roofCritical: roofAnalysis.classification === 'critical',
        roofWarm: roofAnalysis.classification === 'warm',
        highValue: valuation >= this.scoring.highValueThreshold,
      },
      urgency,
      score,
      source: record.source,
      processedAt: new Date().toISOString(),
    };
  }

  // ─── Scoring ──────────────────────────────────────────────────────────────

  _calculateScore(category, noGC, roofAnalysis, valuation, isPremium, record) {
    const w = this.scoring.weights;
    let score = this.scoring.baseScore;

    if (category === 'roofing') score += w.roofingCategory;
    else if (category === 'cgc') score += w.cgcCategory;
    else if (category === 'homeBuilders') score += w.homeBuilderCategory;

    if (noGC) score += w.noGC;
    score += roofAnalysis.score;
    if (isPremium) score += (w.premiumCity || 20);
    if (valuation >= this.scoring.highValueThreshold) score += w.highValuation;
    if (record.status && record.status.toUpperCase() === 'EXPIRED') score += w.expiredPermit;
    if (this._isRecent(record.permitDate)) score += w.recentPermit;

    return Math.min(score, this.scoring.maxScore);
  }

  _calcProjectValue(valuation, isPremium, category) {
    let estNetProfit = 125;
    let tierName = 'plata';
    
    if (valuation > 70000) {
      estNetProfit = 500;
      tierName = 'diamante';
    } else if (valuation >= 30000) {
      estNetProfit = 250;
      tierName = 'oro';
    }

    return {
      declaredValuation: valuation,
      totalProjectValue: valuation,
      estNetProfit,
      tierName,
      marketNote: ''
    };
  }

  _isRecent(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d)) return false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.scoring.recentPermitDays);
    return d >= cutoff;
  }

  _inTargetCity(city) {
    if (!city) return false;
    return this._targetCities.has(city.trim().toUpperCase());
  }

  _isPremiumCity(city) {
    if (!city) return false;
    return this._premiumCities.has(city.trim().toUpperCase());
  }

  _passesStatusFilter(status) {
    if (!status) return true;
    const upper = status.toUpperCase();
    const excluded = this.filters.permitStatus.exclude.map(s => s.toUpperCase());
    return !excluded.includes(upper);
  }

  async _writeOutputs(leads) {
    const { directory, formats, filePrefix, separateByCategory } = this.config.output;
    const ts = new Date().toISOString().slice(0, 10);

    await fs.ensureDir(directory);

    if (separateByCategory) {
      const categories = [...new Set(leads.map(l => l.category))];
      for (const cat of categories) {
        const subset = leads.filter(l => l.category === cat);
        const base = path.join(directory, `${filePrefix}_${cat}_${ts}`);
        if (formats.includes('json')) this._writeJSON(base + '.json', subset);
        if (formats.includes('csv')) await this._writeCSV(base + '.csv', subset);
        this.logger.info(`Wrote ${subset.length} leads for category: ${cat}`);
      }
    } else {
      const base = path.join(directory, `${filePrefix}_${ts}`);
      if (formats.includes('json')) this._writeJSON(base + '.json', leads);
      if (formats.includes('csv')) await this._writeCSV(base + '.csv', leads);
    }

    this._writeJSON(path.join(directory, `${filePrefix}_all_${ts}.json`), leads);
    await this._writeDialerExport(directory, leads);
    this.logger.info(`Total output: ${leads.length} qualified leads`);
  }

  _writeJSON(filePath, data) {
    fs.outputJsonSync(filePath, data, { spaces: 2 });
  }

  async _writeCSV(filePath, leads) {
    if (leads.length === 0) return;

    const writer = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'leadId', title: 'Lead ID' },
        { id: 'score', title: 'Score' },
        { id: 'tier', title: 'Tier' },
        { id: 'tags', title: 'Tags' },
        { id: 'category', title: 'Category' },
        { id: 'permitNumber', title: 'Permit #' },
        { id: 'permitType', title: 'Permit Type' },
        { id: 'permitDate', title: 'Permit Date' },
        { id: 'status', title: 'Status' },
        { id: 'address', title: 'Address' },
        { id: 'addressFormatted', title: 'Dirección Google Maps' },
        { id: 'addressStatus', title: 'Estado Dirección' },
        { id: 'city', title: 'City' },
        { id: 'county', title: 'County' },
        { id: 'zip', title: 'ZIP' },
        { id: 'ownerName', title: 'Owner' },
        { id: 'contractorName', title: 'Contractor' },
        { id: 'valuation', title: 'Permit Valuation ($)' },
        { id: 'totalProjectValue', title: 'Total Project Value ($)' },
        { id: 'estNetProfit', title: 'Est. Net Profit 35% ($)' },
        { id: 'marketNote', title: 'Market Note' },
        { id: 'roofAge', title: 'Roof Age (yrs)' },
        { id: 'roofClass', title: 'Roof Classification' },
        { id: 'noGC', title: 'No-GC' },
        { id: 'roofCritical', title: 'Roof Critical' },
        { id: 'roofNote', title: 'Roof Note' },
        { id: 'source', title: 'Source' },
        { id: 'processedAt', title: 'Processed At' },
      ],
    });

    const rows = leads.map(l => ({
      ...l,
      tags: (l.tags || []).join(', '),
      roofAge: l.roofAnalysis.age,
      roofClass: l.roofAnalysis.classification,
      roofNote: l.roofAnalysis.note,
      noGC: l.flags.noGC ? 'YES' : 'NO',
      roofCritical: l.flags.roofCritical ? 'YES' : 'NO',
      totalProjectValue: l.projectValue.totalProjectValue,
      estNetProfit: l.projectValue.estNetProfit,
      marketNote: l.projectValue.marketNote,
    }));

    await writer.writeRecords(rows);
  }

  async _writeDialerExport(directory, leads) {
    if (leads.length === 0) return;
    const filePath = path.join(directory, 'leads_para_marcador.csv');
    const writer = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'firstName', title: 'First_Name' },
        { id: 'lastName', title: 'Last_Name' },
        { id: 'addressUSPS', title: 'Address' },
        { id: 'city', title: 'City' },
        { id: 'zip', title: 'Zip' },
        { id: 'permitNumber', title: 'Permit_ID' },
      ],
    });

    const rows = leads.map(l => ({
      firstName: l.firstName,
      lastName: l.lastName,
      addressUSPS: l.addressUSPS,
      city: l.city,
      zip: l.zip,
      permitNumber: l.permitNumber,
    }));

    await writer.writeRecords(rows);
    this.logger.info(`Wrote dialer export to ${filePath}`);
  }

  _leadId(record) {
    const base = [record.county, record.permitNumber, record.address]
      .filter(Boolean)
      .join('_')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .toUpperCase();
    return base || `LEAD_${Date.now()}`;
  }
}

module.exports = Processor;
