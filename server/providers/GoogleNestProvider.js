const http = require('http');
const { exec } = require('child_process');
const BaseProvider = require('./BaseProvider');
const configManager = require('../services/ConfigManager');

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
    this.knownNestIps = new Set();
  }

  async getNetworkInfo() {
    const stdout = await execCommand('ipconfig');
    const lines = stdout.split(/\r?\n/);
    let gatewayIp = null;
    let localIp = null;

    for (const line of lines) {
      const ipMatch = line.match(/IPv4 Address[ .]*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i);
      if (ipMatch) {
        localIp = ipMatch[1];
      }
      const gwMatch = line.match(/Default Gateway[ .]*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/i);
      if (gwMatch && gwMatch[1] !== '0.0.0.0') {
        gatewayIp = gwMatch[1];
        break;
      }
    }

    if (!gatewayIp) {
      const routeOut = await execCommand('powershell -Command "(Get-NetRoute -DestinationPrefix \'0.0.0.0/0\' -ErrorAction SilentlyContinue | Select-Object -First 1).NextHop"');
      const trimmed = (routeOut || '').trim();
      if (/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(trimmed) && trimmed !== '0.0.0.0') {
        gatewayIp = trimmed;
      }
    }

    const subnetPrefix = gatewayIp ? gatewayIp.split('.').slice(0, 3).join('.') + '.' : null;
    return { gatewayIp, localIp, subnetPrefix };
  }

  async isApplicable(wifiInfo) {
    try {
      const net = await this.getNetworkInfo();
      if (!net.gatewayIp) return false;
      const res = await fetchJson(`http://${net.gatewayIp}/api/v1/status`, 1000);
      return !!(res && (res.meshInfo || res.system?.modelId || res.software?.softwareVersion));
    } catch {
      return false;
    }
  }

  async getArpTable(subnetPrefix) {
    const map = new Map(); // ip -> mac
    const stdout = await execCommand('arp -a');
    const lines = stdout.split(/\r?\n/);

    for (const line of lines) {
      const match = line.match(/^\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\s+([0-9a-fA-F-]+)/);
      if (match) {
        const ip = match[1];
        const mac = match[2].toLowerCase().replace(/-/g, ':');
        const inSubnet = subnetPrefix ? ip.startsWith(subnetPrefix) : true;
        if (inSubnet && !ip.endsWith('.255') && !ip.endsWith('.0') && !ip.startsWith('224.') && !ip.startsWith('239.')) {
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

  async sweepSubnet(subnetPrefix) {
    if (!subnetPrefix) return [];
    const foundIps = [];
    const promises = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${subnetPrefix}${i}`;
      promises.push(
        fetchJson(`http://${ip}/api/v1/status`, 800)
          .then(res => {
            if (res && res.system && res.system.modelId) {
              foundIps.push(ip);
            }
          })
          .catch(() => {})
      );
    }
    await Promise.all(promises);
    return foundIps;
  }

  async discoverTopology(wifiInfo) {
    const net = await this.getNetworkInfo();
    const gatewayIp = net.gatewayIp || '192.168.1.1';
    const arpMap = await this.getArpTable(net.subnetPrefix);
    const candidateIps = new Set([gatewayIp, ...this.knownNestIps]);
    for (const [ip] of arpMap) {
      candidateIps.add(ip);
    }

    // Always probe dynamically discovered gateway first
    const rootCandidate = await this.probeNestNode(gatewayIp, arpMap.get(gatewayIp));

    // Probe known & ARP candidates in parallel
    const otherIps = Array.from(candidateIps).filter(ip => ip !== gatewayIp);
    const otherPromises = otherIps.map(ip => this.probeNestNode(ip, arpMap.get(ip)));
    const otherResults = await Promise.all(otherPromises);

    const validMap = new Map();
    if (rootCandidate) {
      validMap.set(rootCandidate.ip, rootCandidate);
      this.knownNestIps.add(rootCandidate.ip);
    }
    for (const r of otherResults) {
      if (r) {
        validMap.set(r.ip, r);
        this.knownNestIps.add(r.ip);
      }
    }

    // If we only found the root or no satellites yet, perform a fast parallel subnet sweep
    if (validMap.size <= 1 && net.subnetPrefix) {
      const sweptIps = await this.sweepSubnet(net.subnetPrefix);
      const freshArp = await this.getArpTable(net.subnetPrefix);
      for (const ip of sweptIps) {
        this.knownNestIps.add(ip);
        if (!validMap.has(ip)) {
          const node = await this.probeNestNode(ip, freshArp.get(ip));
          if (node) validMap.set(node.ip, node);
        }
      }
    }

    const validNodes = Array.from(validMap.values());
    this.discoveredNodes = validNodes;

    // Refresh ARP mappings for any node that might have been missing ARP
    const finalArp = await this.getArpTable(net.subnetPrefix);
    for (const node of validNodes) {
      if (!node.mac && finalArp.has(node.ip)) {
        node.mac = finalArp.get(node.ip);
      }
    }

    // Determine root and leaves
    const rootNode = validNodes.find(n => n.role === 'root') || validNodes.find(n => n.ip === gatewayIp) || {
      ip: gatewayIp,
      model: 'Nest Wifi Pro',
      role: 'root',
      mac: finalArp.get(gatewayIp) || arpMap.get(gatewayIp)
    };

    const leafNodes = validNodes.filter(n => n.ip !== rootNode.ip);

    // Determine which node the PC is connected to based on BSSID MAC matching:
    // On Google Nest, the Wi-Fi BSSID and Ethernet MAC share the exact same OUI and first 4-5 octets,
    // differing typically only in the last octet (e.g., fc:91:5d:cd:00:a0 vs fc:91:5d:cd:00:a9).
    const clientBssid = (wifiInfo?.bssid || '').toLowerCase().replace(/-/g, ':');
    let connectedNode = rootNode; // default to root

    if (clientBssid) {
      const bssidPrefix5 = clientBssid.slice(0, 15); // first 5 octets (e.g. "fc:91:5d:cd:00:")
      const bssidPrefix4 = clientBssid.slice(0, 12); // first 4 octets (e.g. "fc:91:5d:cd:")

      // 1. Try 5-octet match first (highest accuracy)
      let match = leafNodes.find(leaf => leaf.mac && leaf.mac.startsWith(bssidPrefix5));
      if (!match && rootNode.mac && rootNode.mac.startsWith(bssidPrefix5)) {
        match = rootNode;
      }

      // 2. Fallback to 4-octet match if last octet range varies by more than 16
      if (!match) {
        match = leafNodes.find(leaf => leaf.mac && leaf.mac.startsWith(bssidPrefix4));
        if (!match && rootNode.mac && rootNode.mac.startsWith(bssidPrefix4)) {
          match = rootNode;
        }
      }

      if (match) {
        connectedNode = match;
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
    const nodeOverrides = configManager.get().nodeOverrides || {};

    leafNodes.forEach((leaf, idx) => {
      const leafId = `node_nest_${leaf.ip.replace(/\./g, '_')}`;
      const isClientOnThisLeaf = (connectedNode.ip === leaf.ip);
      const override = nodeOverrides[leaf.ip];
      // Dynamic wired backhaul detection:
      // 1. Direct hardware carrier flag from satellite (if reported by firmware)
      // 2. Correlation with root router's physical LAN port:
      //    In Nest systems, if rootNode.lanLink === true (meaning the primary router's LAN port is linked to a switch or cable)
      //    and the satellite is an active leaf node with IP assigned, it is auto-detected as wired!
      // 3. User manual override (if present)
      const autoWired = Boolean(leaf.ethernetLink || leaf.lanLink || (rootNode.lanLink === true));
      const isWiredBackhaul = (override && typeof override.isWired === 'boolean')
        ? override.isWired
        : autoWired;

      const backhaulDesc = isWiredBackhaul 
        ? `Wired Ethernet Backhaul (${override?.isWired ? 'Manual Confirmation' : (rootNode.lanLink ? 'Auto-Detected via Switch' : 'Carrier Active')})`
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
        isOverridden: (override && typeof override.isWired === 'boolean'),
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
        name: isWiredBackhaul ? 'Wired Ethernet (1 Gbps)' : '6 GHz Mesh Backhaul',
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
    if (node.ip && node.ip !== 'Local Host' && node.ip !== '1.1.1.1') {
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
