'use strict';

const fs = require('fs-extra');
const path = require('path');

class CacheManager {
  constructor(cacheFile) {
    this.cacheFile = cacheFile;
    this.cache = {};
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        this.cache = fs.readJsonSync(this.cacheFile);
      }
    } catch (err) {
      console.error(`Error loading cache: ${err.message}`);
      this.cache = {};
    }
  }

  get(key) {
    const entry = this.cache[key];
    if (!entry) return null;

    // Default TTL: 30 days
    const now = Date.now();
    const age = now - entry.timestamp;
    const ttl = 30 * 24 * 60 * 60 * 1000;

    if (age > ttl) {
      delete this.cache[key];
      this._save();
      return null;
    }

    return entry.data;
  }

  set(key, data) {
    this.cache[key] = {
      timestamp: Date.now(),
      data
    };
    this._save();
  }

  _save() {
    try {
      fs.ensureDirSync(path.dirname(this.cacheFile));
      fs.writeJsonSync(this.cacheFile, this.cache, { spaces: 2 });
    } catch (err) {
      console.error(`Error saving cache: ${err.message}`);
    }
  }
}

module.exports = CacheManager;
