const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'data', 'config.json');

const DEFAULT_CONFIG = {
  selectedProvider: 'auto', // 'auto', 'google_nest', 'generic', 'custom'
  pingIntervalMs: 1000,
  historyRetention: 60, // keep 60 historical data points
  targets: {
    internetHost: '1.1.1.1',
    fallbackInternetHost: '8.8.8.8'
  },
  thresholds: {
    latencyWarningMs: 40,
    latencyCriticalMs: 100,
    lossWarningPct: 5,
    lossCriticalPct: 20,
    rssiWarningDbm: -72,
    rssiCriticalDbm: -82,
    jitterWarningMs: 25
  },
  customNodes: []
};

class ConfigManager {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      } else {
        this.save();
      }
    } catch (e) {
      console.warn('Could not load config file, using defaults:', e.message);
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  save() {
    try {
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save config:', e.message);
    }
  }

  get() {
    return this.config;
  }

  update(newFields) {
    this.config = { ...this.config, ...newFields };
    this.save();
    return this.config;
  }
}

module.exports = new ConfigManager();
