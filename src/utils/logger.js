'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  constructor(config = {}) {
    this.level = LEVELS[config.level] ?? LEVELS.info;
    this.toConsole = config.console !== false;
    this.logFile = config.file || null;

    if (this.logFile) {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    }
  }

  _write(level, message, meta = null) {
    if (LEVELS[level] < this.level) return;

    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;

    if (this.toConsole) {
      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[method](line);
    }

    if (this.logFile) {
      fs.appendFileSync(this.logFile, line + '\n');
    }
  }

  debug(msg, meta) { this._write('debug', msg, meta); }
  info(msg, meta)  { this._write('info',  msg, meta); }
  warn(msg, meta)  { this._write('warn',  msg, meta); }
  error(msg, meta) { this._write('error', msg, meta); }

  separator(label = '') {
    const line = label
      ? `\n${'─'.repeat(20)} ${label} ${'─'.repeat(20)}\n`
      : `\n${'─'.repeat(50)}\n`;
    if (this.toConsole) console.log(line);
    if (this.logFile) fs.appendFileSync(this.logFile, line);
  }
}

module.exports = Logger;
