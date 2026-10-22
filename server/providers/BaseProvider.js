class BaseProvider {
  constructor(id, name, description) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  /**
   * Discovers the current mesh topology.
   * Returns: {
   *   systemInfo: { brand, model, mode, ... },
   *   nodes: [
   *     { id, name, type: 'client'|'root'|'satellite'|'wan', role, ip, mac, bssid, model, status, ... }
   *   ],
   *   links: [
   *     { id, from: nodeId, to: nodeId, type: 'wifi_client'|'mesh_backhaul'|'ethernet_backhaul'|'wan_link', media, ... }
   *   ],
   *   probeTargets: [
   *     { id: 'link_client_gateway', host: 'gateway_ip', probeType: 'icmp' },
   *     ...
   *   ]
   * }
   */
  async discoverTopology(wifiInfo) {
    throw new Error('discoverTopology() must be implemented by subclass');
  }

  /**
   * Refreshes telemetry or status for a given node.
   */
  async pollNodeTelemetry(node) {
    return { status: 'online' };
  }

  /**
   * Checks if this provider is currently applicable/detected on the network.
   */
  async isApplicable(wifiInfo) {
    return false;
  }
}

module.exports = BaseProvider;
