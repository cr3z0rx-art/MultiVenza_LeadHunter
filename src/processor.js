'use strict';

/**
 * processor.js
 * Ingests raw permit records, applies business rules, scores and prioritizes
 * leads, then writes categorized output files (JSON + CSV).
 *
 * Processing pipeline per record:
 *   0. City filter    — drop permits outside targetCities list
 *   1. Status filter  — drop void/withdrawn permits
 *   2. Category match — detect Roofing / CGC / Home Builder
 *   3. Valuation gate — drop permits below minimum value
 *   4. No-GC rule     — detect and boost owner-builder / unassigned permits
 *   5. 15-Year rule   — evaluate roof age, apply urgency classification
 *   6. Premium city   — apply PREMIUM tag + score boost for key zones
 *   7. Score          — compute composite lead score (0–100)
 *   8. Project Value  — TPV / Est. Net Profit 30% / Partner Share 35%
 *   9. Urgency Skill  — URGENTE flag + sales note for roof 18yr+ and CGC flood zones
 *  10. Sort           — highest score first within each category
 *  11. Write          — JSON + CSV per category
 */

const path   = require('path');
const fs     = require('fs');
const { createObjectCsvWriter } = require('csv-writer');
const Logger = require('./utils/logger');
const rules  = require('./utils/rules');

class Processor {
  constructor(config) {
    this.config     = config;
    this.logger     = new Logger(config.logging);
    this.filters    = config.filters;
    this.scoring    = config.scoring;
    this.cats       = config.leadCategories;
    this.commission = config.commission;

    // Normalized city sets for O(1) lookups
    this._targetCities  = new Set(
      (config.region.targetCities  || []).map(c => c.trim().toUpperCase())
    );
    this._premiumCities = new Set(
      (config.region.premiumCities || []).map(c => c.trim().toUpperCase())
    );

    fs.mkdirSync(config.output.directory, { recursive: true });
  }

  /**
   * Processes an array of raw permit records.
   * @param {object[]} rawRecords
   * @returns {{ leads: object[], stats: object }}
   */
  async run(rawRecords) {
    this.logger.separator('PROCESSOR');
    this.logger.info(`Processing ${rawRecords.length} raw records`);

    const leads = [];
    const stats = {
      total:       rawRecords.length,
      passed:      0,
      dropped:     0,
      byCategory:  { roofing: 0, cgc: 0, homeBuilders: 0, other: 0 },
      noGC:        0,
      roofCritical: 0,
      roofWarm:    0,
      premium:     0,
      totalProjectValue: 0,
      estNetProfitTotal: 0,
      partnerShareTotal: 0,
    };

    for (const record of rawRecords) {
      const result = this._processRecord(record);
      if (result) {
        leads.push(result);
        stats.passed++;
        stats.byCategory[result.category] = (stats.byCategory[result.category] || 0) + 1;
        if (result.flags.noGC)    stats.noGC++;
        if (result.flags.premium) stats.premium++;
        if (result.roofAnalysis.classification === 'critical') stats.roofCritical++;
        if (result.roofAnalysis.classification === 'warm')     stats.roofWarm++;
        stats.totalProjectValue += result.projectValue.totalProjectValue;
        stats.estNetProfitTotal  += result.projectValue.estNetProfit;
        stats.partnerShareTotal  += result.projectValue.partnerShare;
      } else {
        stats.dropped++;
      }
    }

    // Sort: highest score first
    leads.sort((a, b) => b.score - a.score);

    this.logger.info('Processing complete', stats);
    await this._writeOutputs(leads);

    return { leads, stats };
  }

  // ─── Per-record pipeline ──────────────────────────────────────────────────

  _processRecord(record) {
    // 0. City filter — only process permits from targetCities
    if (this.filters.cityFilter?.enabled && !this._inTargetCity(record.city)) {
      this.logger.debug('Dropped — city not in target list', { permit: record.permitNumber, city: record.city });
      return null;
    }

    // 1. Status filter
    if (!this._passesStatusFilter(record.status)) {
      this.logger.debug('Dropped by status filter', { permit: record.permitNumber, status: record.status });
      return null;
    }

    // 2. Category detection
    const category = rules.detectCategory(record.permitType, this.cats);
    if (!category) {
      this.logger.debug('No matching category — skipped', { permit: record.permitNumber, type: record.permitType });
      return null;
    }

    // 3. Valuation gate
    const valuation = record.valuation || 0;
    if (valuation > 0 && valuation < this.filters.valuationMin) {
      this.logger.debug('Dropped below valuation minimum', { permit: record.permitNumber, valuation });
      return null;
    }

    // 4. No-GC rule
    const noGC = rules.isNoGC(record.contractorName);

    // 5. 15-Year roof analysis
    const roofAnalysis = rules.applyRoofAgeRule(record, this.filters.roofAgeRule);

    // 6. Premium city — trust tier from extractor; re-verify as fallback
    const isPremium = record.tier === 'PREMIUM' || this._isPremiumCity(record.city);
    const tier      = isPremium ? 'PREMIUM' : 'STANDARD';
    const tags      = record.tags ? [...record.tags] : [];
    if (isPremium && !tags.includes('PREMIUM')) tags.push('PREMIUM');

    // 7. Score
    const score = this._calculateScore(category, noGC, roofAnalysis, valuation, isPremium, record);

    // 8. Total Project Value — market-adjusted contract value for FL West Coast
    const projectValue = this._calcProjectValue(valuation, isPremium, category);

    // 9. Urgency Skill — evaluate closing window
    const urgencyPartial = {
      category, flags: { noGC, premium: isPremium },
      roofAnalysis, status: record.status,
      city: record.city,
      projectValue,
      valuation,
    };
    const urgency = rules.evaluateUrgency(urgencyPartial, { roofUrgencyAge: 18 });
    if (urgency.urgent && !tags.includes('URGENTE')) tags.push('URGENTE');

    // 10. Build lead object
    return {
      leadId:         this._leadId(record),
      permitNumber:   record.permitNumber,
      category,
      tier,
      tags,
      permitType:     record.permitType,
      permitDate:     record.permitDate,
      status:         record.status,
      address:        record.address,
      city:           record.city,
      county:         record.county,
      zip:            record.zip,
      ownerName:      record.ownerName,
      contractorName: record.contractorName,
      contractorLic:  record.contractorLic,
      valuation,
      roofAnalysis,
      projectValue,
      flags: {
        noGC,
        premium:      isPremium,
        roofCritical: roofAnalysis.classification === 'critical',
        roofWarm:     roofAnalysis.classification === 'warm',
        highValue:    valuation >= this.scoring.highValueThreshold,
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

    // Category base boost
    if (category === 'roofing')           score += w.roofingCategory;
    else if (category === 'cgc')          score += w.cgcCategory;
    else if (category === 'homeBuilders') score += w.homeBuilderCategory;

    // No-GC boost (biggest single driver — direct access to decision-maker)
    if (noGC) score += w.noGC;

    // Roof age boost
    score += roofAnalysis.score;

    // Premium city boost — high-value market, higher close probability
    if (isPremium) score += (w.premiumCity || 20);

    // High valuation
    if (valuation >= this.scoring.highValueThreshold) score += w.highValuation;

    // Expired permit (owner hasn't completed work — warm re-engagement)
    if (record.status && record.status.toUpperCase() === 'EXPIRED') score += w.expiredPermit;

    // Recent permit (active project)
    if (this._isRecent(record.permitDate)) score += w.recentPermit;

    return Math.min(score, this.scoring.maxScore);
  }

  /**
   * Calculates the three financial columns for a lead (FL West Coast model):
   *
   *   Total Project Value  — declared permit valuation, with $250k floor applied
   *                          for PREMIUM zones (Siesta Key, Longboat Key, Lakewood Ranch).
   *                          Permit valuations in luxury coastal markets are routinely
   *                          under-declared; the floor reflects realistic contract scope.
   *
   *   Est. Net Profit (30%) — 30% margin after subcontractors, materials, and overhead.
   *                           Industry average for FL residential/commercial contractors.
   *
   *   Partner Share (35%)  — MultiVenza's 35% of the total project value.
   *                          This is the partner's gross revenue on the engagement.
   *
   * @param {number}  valuation  - raw permit valuation
   * @param {boolean} isPremium  - PREMIUM city flag
   * @param {string}  category   - 'roofing' | 'cgc' | 'homeBuilders'
   * @returns {{ declaredValuation, totalProjectValue, estNetProfit, partnerShare, marketNote }}
   */
  _calcProjectValue(valuation, isPremium, category) {
    const floor = this.commission.premium.valuationFloor; // 250000

    const totalProjectValue = isPremium && valuation < floor ? floor : valuation;
    const estNetProfit      = Math.round(totalProjectValue * 0.30 * 100) / 100;
    const partnerShare      = Math.round(totalProjectValue * 0.35 * 100) / 100;

    const marketNote = isPremium && valuation < floor
      ? `Piso PREMIUM aplicado: valor declarado $${valuation.toLocaleString()} → $${floor.toLocaleString()} (mercado FL West Coast)`
      : '';

    return {
      declaredValuation: valuation,
      totalProjectValue,
      estNetProfit,
      partnerShare,
      marketNote,
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

  // ─── City helpers ─────────────────────────────────────────────────────────

  _inTargetCity(city) {
    if (!city) return false;
    return this._targetCities.has(city.trim().toUpperCase());
  }

  _isPremiumCity(city) {
    if (!city) return false;
    return this._premiumCities.has(city.trim().toUpperCase());
  }

  // ─── Status filter ────────────────────────────────────────────────────────

  _passesStatusFilter(status) {
    if (!status) return true; // unknown status — let it through
    const upper = status.toUpperCase();
    const excluded = this.filters.permitStatus.exclude.map(s => s.toUpperCase());
    return !excluded.includes(upper);
  }

  // ─── Output writers ───────────────────────────────────────────────────────

  async _writeOutputs(leads) {
    const { directory, formats, filePrefix, separateByCategory } = this.config.output;
    const ts = new Date().toISOString().slice(0, 10);

    if (separateByCategory) {
      const categories = [...new Set(leads.map(l => l.category))];
      for (const cat of categories) {
        const subset = leads.filter(l => l.category === cat);
        const base = path.join(directory, `${filePrefix}_${cat}_${ts}`);
        if (formats.includes('json')) this._writeJSON(base + '.json', subset);
        if (formats.includes('csv'))  await this._writeCSV(base + '.csv', subset);
        this.logger.info(`Wrote ${subset.length} leads for category: ${cat}`);
      }
    } else {
      const base = path.join(directory, `${filePrefix}_${ts}`);
      if (formats.includes('json')) this._writeJSON(base + '.json', leads);
      if (formats.includes('csv'))  await this._writeCSV(base + '.csv', leads);
    }

    // Always write a master file
    this._writeJSON(path.join(directory, `${filePrefix}_all_${ts}.json`), leads);
    this.logger.info(`Total output: ${leads.length} qualified leads`);
  }

  _writeJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    this.logger.debug(`JSON written: ${filePath}`);
  }

  async _writeCSV(filePath, leads) {
    if (leads.length === 0) return;

    const writer = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'leadId',               title: 'Lead ID' },
        { id: 'score',                title: 'Score' },
        { id: 'tier',                 title: 'Tier' },
        { id: 'tags',                 title: 'Tags' },
        { id: 'category',             title: 'Category' },
        { id: 'permitNumber',         title: 'Permit #' },
        { id: 'permitType',           title: 'Permit Type' },
        { id: 'permitDate',           title: 'Permit Date' },
        { id: 'status',               title: 'Status' },
        { id: 'address',              title: 'Address' },
        { id: 'city',                 title: 'City' },
        { id: 'county',               title: 'County' },
        { id: 'zip',                  title: 'ZIP' },
        { id: 'ownerName',            title: 'Owner' },
        { id: 'contractorName',       title: 'Contractor' },
        { id: 'valuation',            title: 'Permit Valuation ($)' },
        { id: 'totalProjectValue',    title: 'Total Project Value ($)' },
        { id: 'estNetProfit',         title: 'Est. Net Profit 30% ($)' },
        { id: 'partnerShare',         title: 'MultiVenza Partner Share 35% ($)' },
        { id: 'marketNote',           title: 'Market Note' },
        { id: 'roofAge',              title: 'Roof Age (yrs)' },
        { id: 'roofClass',            title: 'Roof Classification' },
        { id: 'noGC',                 title: 'No-GC' },
        { id: 'roofCritical',         title: 'Roof Critical' },
        { id: 'roofNote',             title: 'Roof Note' },
        { id: 'source',               title: 'Source' },
        { id: 'processedAt',          title: 'Processed At' },
      ],
    });

    const rows = leads.map(l => ({
      ...l,
      tags:                (l.tags || []).join(', '),
      roofAge:             l.roofAnalysis.age,
      roofClass:           l.roofAnalysis.classification,
      roofNote:            l.roofAnalysis.note,
      noGC:             l.flags.noGC ? 'YES' : 'NO',
      roofCritical:     l.flags.roofCritical ? 'YES' : 'NO',
      totalProjectValue: l.projectValue.totalProjectValue,
      estNetProfit:      l.projectValue.estNetProfit,
      partnerShare:      l.projectValue.partnerShare,
      marketNote:        l.projectValue.marketNote,
    }));

    await writer.writeRecords(rows);
    this.logger.debug(`CSV written: ${filePath}`);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

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
