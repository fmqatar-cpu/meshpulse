const BaseProvider = require('./BaseProvider');

class CustomProvider extends BaseProvider {
  constructor(customNodes = []) {
    super(
      'custom',
      'Custom / Manual Configuration',
      'Manually configure IP addresses and labels of your router and access points.'
    );
    this.customNodes = customNodes;
  }

  setCustomNodes(nodes) {
    this.customNodes = nodes;
  }

  async isApplicable() {
    return this.customNodes && this.customNodes.length > 0;
  }

  async discoverTopology(wifiInfo) {
    const nodes = [];
    const links = [];
    const probeTargets = [];

    // Client PC
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

    const rootNode = this.customNodes.find(n => n.role === 'root') || this.customNodes[0] || {
      id: 'node_custom_root',
      name: 'Primary Router',
      ip: '192.168.1.1',
      role: 'root'
    };

    const rootId = `node_${rootNode.ip.replace(/\./g, '_')}`;
    nodes.push({
      id: rootId,
      name: rootNode.name || 'Main Router',
      type: 'root',
      role: 'root',
      ip: rootNode.ip,
      status: 'online'
    });

    // Satellites
    this.customNodes.filter(n => n.role !== 'root').forEach(node => {
      const leafId = `node_${node.ip.replace(/\./g, '_')}`;
      nodes.push({
        id: leafId,
        name: node.name || `Access Point (${node.ip})`,
        type: 'satellite',
        role: 'leaf',
        ip: node.ip,
        status: 'online'
      });

      links.push({
        id: `link_${leafId}_${rootId}`,
        from: leafId,
        to: rootId,
        name: 'Backhaul Link',
        type: 'mesh_backhaul',
        media: 'Mesh Link'
      });

      probeTargets.push({
        id: `link_node_${leafId}`,
        host: node.ip,
        probeType: 'icmp'
      });
    });

    // Client to AP
    links.push({
      id: 'link_client_ap',
      from: clientNodeId,
      to: rootId,
      name: 'Local Connection',
      type: 'wifi_client',
      media: 'Wi-Fi'
    });

    // Internet
    const internetId = 'node_internet';
    nodes.push({
      id: internetId,
      name: 'Internet Gateway',
      type: 'wan',
      role: 'internet',
      ip: '1.1.1.1',
      status: 'online'
    });

    links.push({
      id: 'link_gateway_wan',
      from: rootId,
      to: internetId,
      name: 'WAN Link',
      type: 'wan_link',
      media: 'Internet'
    });

    probeTargets.push({
      id: 'link_client_ap',
      host: rootNode.ip,
      probeType: 'icmp'
    });

    probeTargets.push({
      id: 'link_client_gateway',
      host: rootNode.ip,
      probeType: 'icmp'
    });

    probeTargets.push({
      id: 'link_gateway_wan',
      host: '1.1.1.1',
      probeType: 'icmp'
    });

    return {
      systemInfo: {
        brand: 'Custom Defined',
        model: 'Manual Mesh Configuration',
        mode: 'User Configured',
        discoveredCount: nodes.length
      },
      nodes,
      links,
      probeTargets
    };
  }
}

module.exports = CustomProvider;
