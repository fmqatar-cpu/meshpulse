const http = require('http');
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

function fetchJson(url, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

class GoogleNestProvider extends BaseProvider {
  constructor() {
    super(
      'google_nest',
      'Google Nest Wifi / Nest Wifi Pro',
      'Direct API discovery for Google Wifi & Nest Wifi Pro systems via local telemetry endpoints.'
    );
    this.discoveredNodes = [];
  }

  async isApplicable(wifiInfo) {
    try {
      const res = await fetchJson('http://192.168.86.1/api/v1/status', 1000);
      return !!(res && (res.meshInfo || res.system?.modelId || res.software?.softwareVersion));
    } catch {
      return false;
    }
  }

  async getArpTable() {
    const map = new Map(); // ip -> mac
    const stdout = await execCommand('arp -a');
    const lines = stdout.split(/\r?\n/);

    for (const line of lines) {
      const match = line.match(/^\s*(192\.168\.86\.\d+)\s+([0-9a-fA-F-]+)/);
      if (match) {
        const ip = match[1];
        const mac = match[2].toLowerCase().replace(/-/g, ':');
        if (!ip.endsWith('.255')) {
          map.set(ip, mac);
        }
      }
    }
    return map;
  }

  async probeNestNode(ip, arpMac = null) {
    try {
      const status = await fetchJson(`http://${ip}/api/v1/status`, 1200);
      if (status && status.system) {
        return {
          ip,
          mac: arpMac,
          valid: true,
          model: status.system.modelId || 'Nest Wifi Pro',
          role: status.system.groupRole || 'unknown',
          uptime: status.system.uptime || 0,
          hardwareId: status.system.hardwareId,
          softwareVersion: status.software?.softwareVersion,
          meshChannel: status.meshInfo?.['mesh-channel'],
          meshInterface: status.meshInfo?.['mesh-interface'],
          lanLink: status.system.lan0Link,
          ethernetLink: status.wan?.ethernetLink,
          gatewayIp: status.wan?.gatewayIpAddress,
          wanOnline: status.wan?.online
        };
      }
    } catch {
      // Not a nest wifi node or timed out
    }
    return null;
  }

  async discoverTopology(wifiInfo) {
    const arpMap = await this.getArpTable();
    const candidateIps = new Set(['192.168.86.1']);
    for (const [ip] of arpMap) {
      candidateIps.add(ip);
    }

    // Always probe 192.168.86.1 first
    const rootCandidate = await this.probeNestNode('192.168.86.1', arpMap.get('192.168.86.1'));

    // Probe remaining in parallel
    const otherIps = Array.from(candidateIps).filter(ip => ip !== '192.168.86.1');
    const otherPromises = otherIps.map(ip => this.probeNestNode(ip, arpMap.get(ip)));
    const otherResults = await Promise.all(otherPromises);

    const validMap = new Map();
    if (rootCandidate) validMap.set(rootCandidate.ip, rootCandidate);
    for (const r of otherResults) {
      if (r) validMap.set(r.ip, r);
    }

    const validNodes = Array.from(validMap.values());
    this.discoveredNodes = validNodes;

    // Determine root and leaves
    const rootNode = validNodes.find(n => n.role === 'root') || validNodes.find(n => n.ip === '192.168.86.1') || {
      ip: '192.168.86.1',
      model: 'Nest Wifi Pro',
      role: 'root',
      mac: arpMap.get('192.168.86.1')
    };

    const leafNodes = validNodes.filter(n => n.ip !== rootNode.ip);

    // Determine which node the PC is connected to based on BSSID MAC prefix
    const clientBssid = (wifiInfo?.bssid || '').toLowerCase().replace(/-/g, ':');
    let connectedNode = rootNode; // default to root

    if (clientBssid) {
      const bssidPrefix = clientBssid.slice(0, 14); // first 5 octets
      // Check if root matches
      if (rootNode.mac && rootNode.mac.startsWith(bssidPrefix)) {
        connectedNode = rootNode;
      } else {
        // Check leaf nodes
        for (const leaf of leafNodes) {
          if (leaf.mac && leaf.mac.startsWith(bssidPrefix)) {
            connectedNode = leaf;
            break;
          }
        }
      }
    }

    const nodes = [];
    const links = [];
    const probeTargets = [];

    // 1. Host PC Node
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
      band: wifiInfo?.band || '5 GHz',
      channel: wifiInfo?.channel || null,
      rxRate: wifiInfo?.rxRate,
      txRate: wifiInfo?.txRate,
      status: 'online'
    });

    // 2. Root Gateway Router Node
    const rootNodeId = `node_nest_${rootNode.ip.replace(/\./g, '_')}`;
    const isClientOnRoot = (connectedNode.ip === rootNode.ip);
    nodes.push({
      id: rootNodeId,
      name: 'Nest Wifi Pro (Main Router)',
      type: 'root',
      role: 'root',
      ip: rootNode.ip,
      mac: rootNode.mac,
      model: rootNode.model,
      softwareVersion: rootNode.softwareVersion,
      uptime: rootNode.uptime,
      meshChannel: rootNode.meshChannel,
      isCurrentAP: isClientOnRoot,
      status: 'online'
    });

    // 3. Leaf Nodes (Satellites)
    leafNodes.forEach((leaf, idx) => {
      const leafId = `node_nest_${leaf.ip.replace(/\./g, '_')}`;
      const isClientOnThisLeaf = (connectedNode.ip === leaf.ip);
      const isWiredBackhaul = Boolean(leaf.ethernetLink || leaf.lanLink);
      const backhaulDesc = isWiredBackhaul 
        ? `Wired Ethernet Backhaul (${leaf.ethernetLink ? 'WAN Port' : 'LAN Port'})`
        : 'Wi-Fi 6E Wireless Mesh';

      nodes.push({
        id: leafId,
        name: `Nest Point ${idx + 1} (${leaf.ip})`,
        type: 'satellite',
        role: 'leaf',
        ip: leaf.ip,
        mac: leaf.mac,
        model: leaf.model,
        softwareVersion: leaf.softwareVersion,
        uptime: leaf.uptime,
        backhaulType: backhaulDesc,
        isWiredBackhaul,
        wanPortLinked: Boolean(leaf.ethernetLink),
        lanPortLinked: Boolean(leaf.lanLink),
        meshChannel: leaf.meshChannel,
        isCurrentAP: isClientOnThisLeaf,
        status: 'online'
      });

      // Mesh Backhaul Link (Leaf -> Root)
      const backhaulLinkId = `link_backhaul_${leaf.ip.replace(/\./g, '_')}`;
      links.push({
        id: backhaulLinkId,
        from: leafId,
        to: rootNodeId,
        name: isWiredBackhaul ? 'Wired Ethernet' : '6 GHz Mesh Backhaul',
        type: isWiredBackhaul ? 'ethernet_backhaul' : 'mesh_backhaul',
        media: isWiredBackhaul ? 'Ethernet' : 'Wireless 6GHz'
      });

      // Target to test this satellite
      probeTargets.push({
        id: `link_node_${leafId}`,
        host: leaf.ip,
        probeType: 'http',
        url: `http://${leaf.ip}/api/v1/status`
      });
    });

    // 4. Connect Host PC to its active AP (Root or Leaf)
    const activeApNodeId = `node_nest_${connectedNode.ip.replace(/\./g, '_')}`;
    links.push({
      id: 'link_client_ap',
      from: clientNodeId,
      to: activeApNodeId,
      name: `Local Wi-Fi Link (${wifiInfo?.band || '5 GHz'})`,
      type: 'wifi_client',
      media: 'Wi-Fi'
    });

    // 5. WAN / Internet Gateway
    const wanNodeId = 'node_internet';
    nodes.push({
      id: wanNodeId,
      name: 'Internet Gateway (WAN)',
      type: 'wan',
      role: 'internet',
      ip: '1.1.1.1',
      status: 'online'
    });

    links.push({
      id: 'link_gateway_wan',
      from: rootNodeId,
      to: wanNodeId,
      name: 'WAN / ISP Uplink',
      type: 'wan_link',
      media: 'Broadband'
    });

    // Active Probe Targets for Core Links
    probeTargets.push({
      id: 'link_client_ap',
      host: connectedNode.ip,
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
        brand: 'Google Nest',
        model: rootNode.model,
        mode: 'Multi-AP Mesh',
        meshChannel: rootNode.meshChannel,
        discoveredCount: validNodes.length
      },
      nodes,
      links,
      probeTargets
    };
  }

  async pollNodeTelemetry(node) {
    if (node.ip && node.ip.startsWith('192.168.86.')) {
      const res = await this.probeNestNode(node.ip);
      if (res) {
        return {
          status: 'online',
          uptime: res.uptime,
          softwareVersion: res.softwareVersion
        };
      }
      return { status: 'offline' };
    }
    return { status: 'online' };
  }
}

module.exports = GoogleNestProvider;
