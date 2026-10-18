const GoogleNestProvider = require('./GoogleNestProvider');
const GenericMeshProvider = require('./GenericMeshProvider');
const CustomProvider = require('./CustomProvider');
const configManager = require('../services/ConfigManager');

class ProviderFactory {
  constructor() {
    this.providers = new Map();
    this.googleNest = new GoogleNestProvider();
    this.generic = new GenericMeshProvider();
    this.custom = new CustomProvider(configManager.get().customNodes);

    this.register(this.googleNest);
    this.register(this.generic);
    this.register(this.custom);

    this.activeProvider = this.googleNest; // default
  }

  register(provider) {
    this.providers.set(provider.id, provider);
  }

  getAll() {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description
    }));
  }

  async resolveActiveProvider(wifiInfo) {
    const config = configManager.get();
    const selected = config.selectedProvider;

    if (selected && selected !== 'auto') {
      const match = this.providers.get(selected);
      if (match) {
        if (selected === 'custom') {
          this.custom.setCustomNodes(config.customNodes || []);
        }
        this.activeProvider = match;
        return this.activeProvider;
      }
    }

    // Auto-detection logic:
    // 1. Check if Google Nest is present
    const isGoogle = await this.googleNest.isApplicable(wifiInfo);
    if (isGoogle) {
      this.activeProvider = this.googleNest;
      return this.activeProvider;
    }

    // 2. Default to generic
    this.activeProvider = this.generic;
    return this.activeProvider;
  }

  getProvider(id) {
    return this.providers.get(id);
  }
}

module.exports = new ProviderFactory();
