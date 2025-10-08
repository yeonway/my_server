const axios = require('axios');
const logger = require('../config/logger');

const DEFAULT_TIMEOUT = parseInt(process.env.KORCEN_TIMEOUT_MS || '1500', 10);
const DEFAULT_THRESHOLD = parseFloat(process.env.KORCEN_THRESHOLD || '0.5');
const SERVICE_URL = process.env.KORCEN_SERVICE_URL || '';
const SERVICE_ENABLED = /^true$/i.test(process.env.KORCEN_ENABLED || 'true') && Boolean(SERVICE_URL);

class KorcenClassifier {
  constructor() {
    this.enabled = SERVICE_ENABLED;
    if (!this.enabled) {
      logger.info('[korcen] ML classifier disabled (missing KORCEN_SERVICE_URL or KORCEN_ENABLED=false).');
      return;
    }

    this.client = axios.create({
      baseURL: SERVICE_URL.replace(/\/+$/, ''),
      timeout: DEFAULT_TIMEOUT,
    });

    logger.info('[korcen] ML classifier enabled. Endpoint: %s', SERVICE_URL);
  }

  isEnabled() {
    return this.enabled;
  }

  async classify(texts = [], threshold = DEFAULT_THRESHOLD) {
    if (!this.enabled || !Array.isArray(texts) || texts.length === 0) {
      return null;
    }

    try {
      const response = await this.client.post('/classify', {
        texts,
        threshold,
      });
      return response?.data || null;
    } catch (error) {
      const message = error?.response?.data?.message || error.message;
      logger.warn('[korcen] classification request failed: %s', message);
      return null;
    }
  }

  async containsAbuse(texts = [], threshold = DEFAULT_THRESHOLD) {
    const result = await this.classify(texts, threshold);
    if (!result || result.status !== 'ok') {
      return false;
    }

    if (Array.isArray(result.flagged_indices) && result.flagged_indices.length > 0) {
      return true;
    }

    const flaggedResults = Array.isArray(result.results)
      ? result.results.some((item) => item?.flagged)
      : false;
    return flaggedResults;
  }
}

module.exports = new KorcenClassifier();
