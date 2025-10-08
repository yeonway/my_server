const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

const AUTOSTART = /^true$/i.test(process.env.KORCEN_AUTOSTART || 'false');
const PYTHON_BIN = process.env.KORCEN_PYTHON || 'python';
const WORKING_DIR = path.join(__dirname, '..');
const SCRIPT_PATH = process.env.KORCEN_SCRIPT_PATH
  ? path.resolve(process.env.KORCEN_SCRIPT_PATH)
  : path.join(WORKING_DIR, 'ml', 'korcen_service.py');

class KorcenProcessManager {
  constructor() {
    this.child = null;
    this.stopping = false;
    this.cleanupRegistered = false;
    if (!AUTOSTART) {
      logger.info('[korcen] Autostart disabled. Set KORCEN_AUTOSTART=true to enable.');
    }
  }

  shouldAutoStart() {
    return AUTOSTART;
  }

  ensureStarted() {
    if (!this.shouldAutoStart()) return;
    if (this.child) return;

    if (!fs.existsSync(SCRIPT_PATH)) {
      logger.warn('[korcen] Cannot autostart service. Missing script at %s', SCRIPT_PATH);
      return;
    }

    logger.info('[korcen] Starting Python classifier via %s %s', PYTHON_BIN, SCRIPT_PATH);
    this.child = spawn(PYTHON_BIN, [SCRIPT_PATH], {
      cwd: WORKING_DIR,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child.stdout.on('data', (data) => {
      const message = data.toString().trim();
      if (message) logger.info('[korcen:py] %s', message);
    });
    this.child.stderr.on('data', (data) => {
      const message = data.toString().trim();
      if (message) logger.warn('[korcen:py] %s', message);
    });

    this.child.on('exit', (code, signal) => {
      logger.info('[korcen] Python classifier exited (code=%s, signal=%s)', code, signal);
      const wasStopping = this.stopping;
      this.child = null;
      this.stopping = false;
      if (!wasStopping && this.shouldAutoStart()) {
        logger.info('[korcen] Autostart disabled after unexpected exit. Restart manually if needed.');
      }
    });

    if (!this.cleanupRegistered) {
      const shutdown = () => this.stop();
      process.once('exit', shutdown);
      this.cleanupRegistered = true;
    }
  }

  stop() {
    if (!this.child) return;
    this.stopping = true;
    logger.info('[korcen] Stopping Python classifier');
    this.child.kill();
    this.child = null;
  }
}

module.exports = new KorcenProcessManager();
