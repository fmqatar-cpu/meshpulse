const { exec } = require('child_process');
const BaseProvider = require('./BaseProvider');

function execCommand(cmd, timeoutMs = 3000) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      if (err) resolve('');
      else resolve(stdout || '');
    });
  });
}

class GenericMeshProvider extends BaseProvider {
  constructor() {
    super(
      'generic',
      'Universal / Generic Mesh (Any Brand)',
      'Brand-agnostic provider using Wi-Fi RF beacon scanning, ARP discovery, and gateway differential probing.'
    );
  }

  async isApplicable(wifiInfo) {
    return true; // Always available as a fallback
  }

  async getDefaultGateway() {
    const stdout = await execCommand('ipconfig');
    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/Default Gateway[ .]*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i);
      if (match && match[1] !== '0.0.0.0') {
        return match[1];
      }
    }
    return '192.168.1.1';
  }

  async discoverTopology(wifiInfo) {
    const gatewayIp = await this.getDefaultGateway();
    const visibleBssids = wifiInfo?.meshBssids || [];

    const nodes = [];
    const links = [];
    const probeTargets = [];

    // 1. Host PC
    const clientNodeId = 'node_client';
    nodes.push({
      id: clientNodeId,
      name: 'Host PC',
      type: 'client',
      role: 'client',
      ip: 'Local Host',
      connectedBssid: wifiInfo?.bssid || '',
      signal: wifiInfo?.signal || 100,
      rssi: wifiInfo?.rssi || -50,
      band: wifiInfo?.band || 'Wi-Fi',
      status: 'online'
    });

    // 2. Gateway Router Node
    const gatewayNodeId = 'node_gateway';
    nodes.push({
      id: gatewayNodeId,
      name: `Main Router (${gatewayIp})`,
      type: 'root',
      role: 'root',
      ip: gatewayIp,
      model: 'Mesh Gateway',
      status: 'online'
    });

    // 3. Additional Access Points from BSSID scan
    if (visibleBssids.length > 1) {
      visibleBssids.forEach((bssidObj, idx) => {
        const isCurrent = (wifiInfo?.bssid && bssidObj.bssid.toLowerCase() === wifiInfo.bssid.toLowerCase());
        const apId = `node_ap_${idx + 1}`;
        nodes.push({
          id: apId,
          name: isCurrent ? `Connected AP (BSSID: ${bssidObj.bssid.slice(-8)})` : `Satellite AP ${idx + 1} (${bssidObj.bssid.slice(-8)})`,
          type: 'satellite',
          role: 'leaf',
          bssid: bssidObj.bssid,
          signal: bssidObj.signal,
          rssi: bssidObj.rssi,
          channel: bssidObj.channel,
          band: bssidObj.band,
          status: 'online'
        });

        // Link Satellite to Gateway
        links.push({
          id: `link_backhaul_ap_${idx + 1}`,
          from: apId,
          to: gatewayNodeId,
          name: 'Wireless Backhaul',
          type: 'mesh_backhaul',
          media: 'Wi-Fi Backhaul'
        });
      });

      // Link Client to current AP
      links.push({
        id: 'link_client_ap',
        from: clientNodeId,
        to: 'node_ap_1',
        name: `Wi-Fi Link (${wifiInfo?.signal || 100}%)`,
        type: 'wifi_client',
        media: 'Wi-Fi'
      });
    } else {
      // Single AP or bridge
      links.push({
        id: 'link_client_ap',
        from: clientNodeId,
        to: gatewayNodeId,
        name: `Wi-Fi Link (${wifiInfo?.signal || 100}%)`,
        type: 'wifi_client',
        media: 'Wi-Fi'
      });
    }

    // 4. Internet Node
    const internetNodeId = 'node_internet';
    nodes.push({
      id: internetNodeId,
      name: 'Internet Gateway',
      type: 'wan',
      role: 'internet',
      ip: '1.1.1.1',
      status: 'online'
    });

    links.push({
      id: 'link_gateway_wan',
      from: gatewayNodeId,
      to: internetNodeId,
      name: 'WAN Uplink',
      type: 'wan_link',
      media: 'Broadband'
    });

    // Probing targets
    probeTargets.push({
      id: 'link_client_ap',
      host: gatewayIp,
      probeType: 'icmp'
    });

    probeTargets.push({
      id: 'link_client_gateway',
      host: gatewayIp,
      probeType: 'icmp'
    });

    probeTargets.push({
      id: 'link_gateway_wan',
      host: '1.1.1.1',
      probeType: 'icmp'
    });

    return {
      systemInfo: {
        brand: 'Generic Mesh / Wi-Fi',
        model: 'Standard 802.11 Multi-AP',
        mode: 'BSSID Discovered',
        gateway: gatewayIp,
        discoveredCount: visibleBssids.length || 1
      },
      nodes,
      links,
      probeTargets
    };
  }

  async pollNodeTelemetry(node) {
    return { status: 'online' };
  }
}

module.exports = GenericMeshProvider;
