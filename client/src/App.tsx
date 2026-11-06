import React, { useState, useEffect, useRef } from 'react';
import {
  Wifi,
  Activity,
  Router,
  Globe,
  Laptop,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Settings,
  RefreshCw,
  Layers,
  Clock,
  Radio,
  ArrowRight,
  TrendingUp,
  Cpu,
  Sliders,
  ExternalLink,
  Info,
  Server,
  Smartphone,
  Search,
  Users,
  Zap,
  Gauge,
  ArrowDown,
  ArrowUp
} from 'lucide-react';

import pkg from '../../package.json';

interface WifiInfo {
  connected: boolean;
  interfaceName: string;
  description: string;
  ssid: string;
  bssid: string;
  radioType: string;
  band: string;
  channel: number;
  signal: number;
  rssi: number;
  rxRate: number;
  txRate: number;
  gatewayIp?: string;
  meshBssids?: any[];
}

interface MeshNode {
  id: string;
  name: string;
  type: 'client' | 'root' | 'satellite' | 'wan' | 'modem';
  role: string;
  ip: string;
  mac?: string;
  bssid?: string;
  model?: string;
  softwareVersion?: string;
  uptime?: number;
  meshChannel?: number;
  backhaulType?: string;
  isCurrentAP?: boolean;
  status?: string;
  signal?: number;
  rssi?: number;
  band?: string;
  ethernetLinked?: boolean;
  localWanIp?: string;
}

interface MeshLink {
  id: string;
  from: string;
  to: string;
  name: string;
  type: string;
  media: string;
}

interface LinkStat {
  targetId: string;
  host: string;
  current: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  jitter: number | null;
  lossPct: number;
  samplesCount: number;
  history?: { t: number; ms: number | null }[];
}

interface Issue {
  id: string;
  severity: 'WARNING' | 'CRITICAL';
  title: string;
  description: string;
  recommendation: string;
}

interface Incident extends Issue {
  timestamp: number;
  resolvedAt: number | null;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [activeProvider, setActiveProvider] = useState<any>({ id: 'google_nest', name: 'Google Nest Wifi Pro' });
  const [providersList, setProvidersList] = useState<any[]>([]);
  const [selectedNode, setSelectedNode] = useState<MeshNode | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'topology' | 'links' | 'devices' | 'incidents'>('topology');

  // Connected Devices state
  const [devicesList, setDevicesList] = useState<any[]>([]);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [isFetchingDevices, setIsFetchingDevices] = useState(false);

  // Settings form state
  const [settingsProvider, setSettingsProvider] = useState('google_nest');
  const [settingsInterval, setSettingsInterval] = useState(1000);
  const [customIpInput, setCustomIpInput] = useState('');
  const [customNameInput, setCustomNameInput] = useState('');
  const [customNodes, setCustomNodes] = useState<any[]>([]);

  // Speedtest state (runs non-blocking in background)
  const [speedtestState, setSpeedtestState] = useState<{
    isRunning: boolean;
    currentStage: string;
    lastResult: any;
    history: any[];
  }>({
    isRunning: false,
    currentStage: 'idle',
    lastResult: null,
    history: []
  });
  const [isSpeedtestModalOpen, setIsSpeedtestModalOpen] = useState(false);
  const [speedtestAutoHourly, setSpeedtestAutoHourly] = useState(() => {
    try {
      const v = localStorage.getItem('meshpulse_speedtest_hourly');
      return v !== null ? JSON.parse(v) : true;
    } catch {
      return true;
    }
  });
  const [speedtestRunOnRescan, setSpeedtestRunOnRescan] = useState(() => {
    try {
      const v = localStorage.getItem('meshpulse_speedtest_rescan');
      return v !== null ? JSON.parse(v) : true;
    } catch {
      return true;
    }
  });

  // Automated hourly speedtest interval
  useEffect(() => {
    const timer = setInterval(() => {
      if (!speedtestAutoHourly || speedtestState.isRunning) return;
      const last = speedtestState.lastResult?.timestamp || 0;
      if (Date.now() - last >= 60 * 60 * 1000) {
        runSpeedtest();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [speedtestAutoHourly, speedtestState.isRunning, speedtestState.lastResult]);

  // Background Speedtest runner (Desktop via API, Android via direct browser fetch)
  const runSpeedtest = async () => {
    if (speedtestState.isRunning) return;

    const isAndroid = typeof (window as any).AndroidBridge !== 'undefined';
    if (!isAndroid) {
      setSpeedtestState(prev => ({ ...prev, isRunning: true, currentStage: 'download' }));
      try {
        await fetch('/api/speedtest', { method: 'POST' });
      } catch (e) {
        console.error('Trigger speedtest error:', e);
        setSpeedtestState(prev => ({ ...prev, isRunning: false, currentStage: 'idle' }));
      }
      return;
    }

    // Android standalone background test
    setSpeedtestState(prev => ({ ...prev, isRunning: true, currentStage: 'download' }));
    try {
      const t0 = Date.now();
      const res = await fetch('https://speed.cloudflare.com/__down?bytes=10000000', {
        headers: { 'Cache-Control': 'no-cache' }
      });
      const reader = res.body?.getReader();
      let totalBytes = 0;
      let firstByteTime: number | null = null;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!firstByteTime) firstByteTime = Date.now();
          totalBytes += value.length;
        }
      } else {
        const buf = await res.arrayBuffer();
        totalBytes = buf.byteLength;
      }
      const t1 = Date.now();
      const dlSec = Math.max((t1 - (firstByteTime || t0)) / 1000, 0.05);
      const downloadMbps = Math.round(((totalBytes * 8) / (dlSec * 1000000)) * 10) / 10;
      const pingMs = firstByteTime ? (firstByteTime - t0) : (t1 - t0);

      // Upload test
      setSpeedtestState(prev => ({ ...prev, currentStage: 'upload' }));
      const upBytes = 2 * 1024 * 1024;
      const upPayload = new Uint8Array(upBytes);
      const ut0 = Date.now();
      await fetch('https://speed.cloudflare.com/__up', {
        method: 'POST',
        body: upPayload
      });
      const ut1 = Date.now();
      const upSec = Math.max((ut1 - ut0) / 1000, 0.05);
      const uploadMbps = Math.round(((upBytes * 8) / (upSec * 1000000)) * 10) / 10;

      const result = {
        timestamp: Date.now(),
        downloadMbps,
        uploadMbps,
        pingMs,
        bytesDownloaded: totalBytes,
        bytesUploaded: upBytes
      };

      setSpeedtestState(prev => {
        const nextHist = [result, ...(prev.history || [])].slice(0, 30);
        try {
          localStorage.setItem('meshpulse_speedtest_history', JSON.stringify(nextHist));
          localStorage.setItem('meshpulse_speedtest_last', JSON.stringify(result));
        } catch (e) {}
        return {
          isRunning: false,
          currentStage: 'idle',
          lastResult: result,
          history: nextHist
        };
      });
    } catch (e) {
      console.error('Android background speedtest error:', e);
      setSpeedtestState(prev => ({ ...prev, isRunning: false, currentStage: 'idle' }));
    }
  };

  const wsRef = useRef<WebSocket | null>(null);

  // Fetch initial HTTP status
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setSnapshot(data);
        if (data.activeProvider) setActiveProvider(data.activeProvider);
        if (data.speedtest) setSpeedtestState(data.speedtest);
        if (data.config) {
          setSettingsProvider(data.config.selectedProvider || 'auto');
          setSettingsInterval(data.config.pingIntervalMs || 1000);
          setCustomNodes(data.config.customNodes || []);
        }
      }
    } catch (e) {
      console.error('Fetch status error:', e);
    }
  };

  // Fetch connected devices from backend or Android bridge
  const fetchDevices = async () => {
    setIsFetchingDevices(true);
    try {
      const isAndroid = typeof (window as any).AndroidBridge !== 'undefined';
      if (isAndroid) {
        const bridge = (window as any).AndroidBridge;
        if (bridge.getConnectedDevices) {
          const raw = bridge.getConnectedDevices();
          const parsed = JSON.parse(raw || '[]');
          const OUI_MAP: Record<string, { vendor: string; type: string }> = {
            'fc:91:5d': { vendor: 'Google', type: 'Nest Wifi Pro Mesh' },
            '58:70:c6': { vendor: 'Google', type: 'Nest / Home Device' },
            'bc:35:1e': { vendor: 'Google', type: 'Nest Device' },
            '38:2c:e5': { vendor: 'Google', type: 'Nest Device' },
            'f8:17:2d': { vendor: 'Apple', type: 'iPhone / Mac / iPad' },
            '98:ed:5c': { vendor: 'Apple', type: 'iPhone / Mac / iPad' },
            '84:7a:b6': { vendor: 'Apple', type: 'Apple Device' },
            'b4:b8:53': { vendor: 'Apple', type: 'Apple Device' },
            '74:f9:ca': { vendor: 'Apple', type: 'Apple Device' },
            'c0:f8:53': { vendor: 'Apple', type: 'Apple Device' },
            '90:ca:fa': { vendor: 'Samsung', type: 'Galaxy / Smart TV' },
            '54:60:09': { vendor: 'Samsung', type: 'Galaxy / Smart TV' },
            '20:1f:3b': { vendor: 'Samsung', type: 'Galaxy / Smart TV' },
            '20:f1:b2': { vendor: 'Sony', type: 'PlayStation / Bravia' },
            '38:1f:8d': { vendor: 'Sony', type: 'PlayStation 5 / Audio' },
            '1c:53:f9': { vendor: 'Intel', type: 'PC Wi-Fi Adapter' },
            'd8:1f:12': { vendor: 'Intel', type: 'PC Wi-Fi Adapter' }
          };
          const devList = parsed.map((d: any) => {
            const oui = d.mac.slice(0, 8);
            const firstByte = parseInt(d.mac.slice(0, 2), 16) || 0;
            const isRandom = (firstByte & 0x02) !== 0;
            let vendor = 'Generic Device';
            let type = 'Connected Client';
            if (OUI_MAP[oui]) {
              vendor = OUI_MAP[oui].vendor;
              type = OUI_MAP[oui].type;
            } else if (isRandom) {
              vendor = 'Private Wi-Fi Client';
              type = 'Smartphone / Tablet (Private MAC)';
            }
            return { ...d, vendor, type, isRandomized: isRandom };
          });
          setDevicesList(devList);
        }
        return;
      }

      const res = await fetch('/api/devices');
      if (res.ok) {
        const data = await res.json();
        setDevicesList(data.devices || []);
      }
    } catch (e) {
      console.error('Fetch devices error:', e);
    } finally {
      setIsFetchingDevices(false);
    }
  };

  // Fetch providers list
  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/providers');
      if (res.ok) {
        const data = await res.json();
        setProvidersList(data.available || []);
      }
    } catch (e) {
      console.error('Fetch providers error:', e);
    }
  };

  // Setup WebSocket or Android Native Bridge for continuous live streaming
  useEffect(() => {
    const isAndroid = typeof (window as any).AndroidBridge !== 'undefined';

    if (isAndroid) {
      setWsConnected(true);
      setActiveProvider({
        id: 'android_native',
        name: 'Android Mesh Engine',
        description: 'Native Wi-Fi scanning, subnet topology sweep, and ICMP telemetry'
      });

      // Load saved Android config from localStorage
      try {
        const saved = localStorage.getItem('meshpulse_android_config');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.selectedProvider) setSettingsProvider(parsed.selectedProvider);
          if (parsed.pingIntervalMs) setSettingsInterval(parsed.pingIntervalMs);
          if (parsed.customNodes) setCustomNodes(parsed.customNodes);
        }
      } catch (e) {}

      const androidHistory: Record<string, { t: number; ms: number | null }[]> = {
        link_client_ap: [],
        link_router_modem: [],
        link_gateway_wan: []
      };

      let cachedDiscoveredNodes: any[] = [];
      let lastMeshSweep = 0;

      const runAndroidTick = () => {
        try {
          const bridge = (window as any).AndroidBridge;
          const wifiRaw = bridge.getWifiInfo();
          const wifiParsed = JSON.parse(wifiRaw || '{}');

          if (!wifiParsed.connected) {
            setSnapshot((prev: any) => ({
              ...prev,
              wifi: { connected: false },
              diagnosis: { overallStatus: 'CRITICAL', healthScore: 0, issues: [{
                id: 'WIFI_DISCONNECTED',
                severity: 'CRITICAL',
                title: 'Android Wi-Fi Disconnected',
                description: 'Device is not connected to a Wi-Fi network.',
                recommendation: 'Connect to your home mesh Wi-Fi network.'
              }], incidents: [] }
            }));
            return;
          }

          const gatewayIp = wifiParsed.gatewayIp || '192.168.1.1';
          const subnetPrefix = gatewayIp.substring(0, gatewayIp.lastIndexOf('.') + 1);

          // Periodic or triggered mesh discovery sweep
          const now = Date.now();
          if (now - lastMeshSweep > 12000 || cachedDiscoveredNodes.length === 0) {
            lastMeshSweep = now;
            try {
              const rawDiscovered = bridge.discoverMeshNodes(gatewayIp, subnetPrefix);
              cachedDiscoveredNodes = JSON.parse(rawDiscovered || '[]');
            } catch (e) {
              // discovery fallback
            }
          }

          // Get visible BSSIDs
          let visibleBssids: any[] = [];
          try {
            visibleBssids = JSON.parse(bridge.getVisibleBssids() || '[]');
          } catch (e) {}

          const apPingRaw = JSON.parse(bridge.ping(gatewayIp, 1));
          const modemIp = '192.168.100.1';
          let modemPingRaw = { success: false, latency: 0 };
          try {
            modemPingRaw = JSON.parse(bridge.ping(modemIp, 1) || '{"success":false,"latency":0}');
          } catch (e) {}
          const wanPingRaw = JSON.parse(bridge.ping('1.1.1.1', 1));

          const apMs = apPingRaw.success ? Math.round(apPingRaw.latency) : null;
          const modemMs = modemPingRaw.success ? Math.round(modemPingRaw.latency) : null;
          const wanMs = wanPingRaw.success ? Math.round(wanPingRaw.latency) : null;

          androidHistory.link_client_ap.push({ t: now, ms: apMs });
          if (androidHistory.link_client_ap.length > 25) androidHistory.link_client_ap.shift();

          if (!androidHistory.link_router_modem) androidHistory.link_router_modem = [];
          androidHistory.link_router_modem.push({ t: now, ms: modemMs });
          if (androidHistory.link_router_modem.length > 25) androidHistory.link_router_modem.shift();

          androidHistory.link_gateway_wan.push({ t: now, ms: wanMs });
          if (androidHistory.link_gateway_wan.length > 25) androidHistory.link_gateway_wan.shift();

          const calcStats = (targetId: string, host: string, hist: { t: number; ms: number | null }[]) => {
            const successes = hist.filter(h => h.ms !== null).map(h => h.ms as number);
            const lossPct = hist.length > 0 ? Math.round(((hist.length - successes.length) / hist.length) * 100) : 0;
            const current = successes.length > 0 ? successes[successes.length - 1] : null;
            const avg = successes.length > 0 ? Math.round((successes.reduce((a, b) => a + b, 0) / successes.length) * 10) / 10 : 0;
            return {
              targetId,
              host,
              current,
              avg,
              min: successes.length > 0 ? Math.min(...successes) : null,
              max: successes.length > 0 ? Math.max(...successes) : null,
              lossPct,
              jitter: 1.0,
              samplesCount: hist.length,
              history: [...hist]
            };
          };

          const linkStats: Record<string, any> = {
            link_client_ap: calcStats('link_client_ap', gatewayIp, androidHistory.link_client_ap),
            link_router_modem: calcStats('link_router_modem', modemIp, androidHistory.link_router_modem),
            link_gateway_wan: calcStats('link_gateway_wan', '1.1.1.1', androidHistory.link_gateway_wan)
          };

          // Load local overrides
          let nodeOverrides: Record<string, any> = {};
          try {
            nodeOverrides = JSON.parse(localStorage.getItem('meshpulse_android_node_overrides') || '{}');
          } catch (e) {}

          const nodes: any[] = [];
          const linksArr: any[] = [];

          // 1. Client Phone Node
          nodes.push({
            id: 'node_client',
            name: 'Android Phone',
            type: 'client',
            role: 'client',
            ip: wifiParsed.localIp,
            connectedBssid: wifiParsed.bssid,
            signal: wifiParsed.signal,
            rssi: wifiParsed.rssi,
            band: wifiParsed.band,
            status: 'online'
          });

          // 2. Mesh Topology Assembly
          if (cachedDiscoveredNodes.length > 0) {
            const rootCandidate = cachedDiscoveredNodes.find(n => n.role === 'root') ||
                                  cachedDiscoveredNodes.find(n => n.ip === gatewayIp) || {
              ip: gatewayIp,
              model: 'Nest Wifi Pro',
              role: 'root',
              hardwareId: ''
            };

            const leafCandidates = cachedDiscoveredNodes.filter(n => n.ip !== rootCandidate.ip);

            // Determine which node the phone is connected to using BSSID MAC prefix matching
            const clientBssid = (wifiParsed.bssid || '').toLowerCase();
            let connectedNode = rootCandidate;

            if (clientBssid) {
              const bssidClean = clientBssid.replace(/[:-]/g, '');
              const match = leafCandidates.find(leaf => {
                const macClean = (leaf.hardwareId || leaf.mac || '').toLowerCase().replace(/[:-]/g, '');
                return macClean.length >= 8 && bssidClean.startsWith(macClean.slice(0, 8));
              });
              if (match) {
                connectedNode = match;
              }
            }

            const rootNodeId = `node_nest_${rootCandidate.ip.replace(/\./g, '_')}`;
            const isClientOnRoot = (connectedNode.ip === rootCandidate.ip);

            nodes.push({
              id: rootNodeId,
              name: `${rootCandidate.model || 'Nest Wifi Pro'} (Main Router)`,
              type: 'root',
              role: 'root',
              ip: rootCandidate.ip,
              model: rootCandidate.model,
              softwareVersion: rootCandidate.softwareVersion,
              uptime: rootCandidate.uptime,
              meshChannel: rootCandidate.meshChannel,
              isCurrentAP: isClientOnRoot,
              status: 'online'
            });

            leafCandidates.forEach((leaf, idx) => {
              const leafId = `node_nest_${leaf.ip.replace(/\./g, '_')}`;
              const isClientOnThisLeaf = (connectedNode.ip === leaf.ip);
              const override = nodeOverrides[leaf.ip];
              const autoWired = Boolean(leaf.ethernetLink || leaf.lanLink || rootCandidate.lanLink);
              const isWiredBackhaul = (override && typeof override.isWired === 'boolean')
                ? override.isWired
                : autoWired;

              const backhaulDesc = isWiredBackhaul
                ? `Wired Ethernet Backhaul (${override?.isWired ? 'Manual' : (rootCandidate.lanLink ? 'Switch Link' : 'Active')})`
                : 'Wi-Fi 6E Wireless Mesh';

              nodes.push({
                id: leafId,
                name: `Nest Point ${idx + 1} (${leaf.ip})`,
                type: 'satellite',
                role: 'leaf',
                ip: leaf.ip,
                model: leaf.model,
                softwareVersion: leaf.softwareVersion,
                uptime: leaf.uptime,
                backhaulType: backhaulDesc,
                isWiredBackhaul,
                isOverridden: (override && typeof override.isWired === 'boolean'),
                isCurrentAP: isClientOnThisLeaf,
                status: 'online'
              });

              linksArr.push({
                id: `link_backhaul_${leaf.ip.replace(/\./g, '_')}`,
                from: leafId,
                to: rootNodeId,
                name: isWiredBackhaul ? '⚡ Wired Ethernet (1G)' : '📶 Wi-Fi 6E Wireless Mesh',
                type: isWiredBackhaul ? 'ethernet_backhaul' : 'mesh_backhaul',
                media: isWiredBackhaul ? 'Ethernet 1000BASE-T' : 'Wi-Fi 6E'
              });
            });

            // Connect phone to active AP (either Leaf or Root)
            const targetApNodeId = isClientOnRoot ? rootNodeId : `node_nest_${connectedNode.ip.replace(/\./g, '_')}`;
            linksArr.push({
              id: 'link_client_ap',
              from: 'node_client',
              to: targetApNodeId,
              name: `Wi-Fi Link (${wifiParsed.signal || 100}%)`,
              type: 'wifi_client',
              media: 'Wi-Fi'
            });

            // Connect root to modem
            linksArr.push({
              id: 'link_router_modem',
              from: rootNodeId,
              to: 'node_modem',
              name: 'Router Uplink',
              type: 'wan_link',
              media: 'Gigabit Ethernet'
            });

            // Connect modem to internet
            linksArr.push({
              id: 'link_gateway_wan',
              from: 'node_modem',
              to: 'node_internet',
              name: 'WAN Broadband',
              type: 'wan_link',
              media: 'Broadband Fiber'
            });

          } else {
            // Generic Mesh / BSSID Fallback
            const matchingBssids = visibleBssids.filter((b: any) =>
              b.ssid && wifiParsed.ssid && (b.ssid === wifiParsed.ssid || b.ssid === `"${wifiParsed.ssid}"`)
            );

            const gatewayNodeId = 'node_gateway';
            const isClientOnGateway = matchingBssids.length <= 1;

            nodes.push({
              id: gatewayNodeId,
              name: `Main Router (${gatewayIp})`,
              type: 'root',
              role: 'root',
              ip: gatewayIp,
              model: 'Mesh Gateway',
              isCurrentAP: isClientOnGateway,
              status: 'online'
            });

            if (matchingBssids.length > 1) {
              matchingBssids.forEach((bssidObj, idx) => {
                const isCurrent = (wifiParsed.bssid && bssidObj.bssid.toLowerCase() === wifiParsed.bssid.toLowerCase());
                const apId = `node_ap_${idx + 1}`;
                nodes.push({
                  id: apId,
                  name: isCurrent ? `Connected AP (${bssidObj.bssid.slice(-8)})` : `Mesh Point ${idx + 1} (${bssidObj.bssid.slice(-8)})`,
                  type: 'satellite',
                  role: 'leaf',
                  bssid: bssidObj.bssid,
                  signal: bssidObj.signal,
                  rssi: bssidObj.rssi,
                  band: bssidObj.band,
                  isCurrentAP: isCurrent,
                  status: 'online'
                });

                linksArr.push({
                  id: `link_backhaul_ap_${idx + 1}`,
                  from: apId,
                  to: gatewayNodeId,
                  name: 'Wireless Mesh Backhaul',
                  type: 'mesh_backhaul',
                  media: 'Wi-Fi Backhaul'
                });
              });

              // Link phone to connected satellite or first AP
              const activeAp = nodes.find(n => n.type === 'satellite' && n.isCurrentAP) || nodes.find(n => n.type === 'satellite');
              linksArr.push({
                id: 'link_client_ap',
                from: 'node_client',
                to: activeAp ? activeAp.id : gatewayNodeId,
                name: `Wi-Fi Link (${wifiParsed.signal || 100}%)`,
                type: 'wifi_client',
                media: 'Wi-Fi'
              });
            } else {
              linksArr.push({
                id: 'link_client_ap',
                from: 'node_client',
                to: gatewayNodeId,
                name: `Wi-Fi Link (${wifiParsed.signal || 100}%)`,
                type: 'wifi_client',
                media: 'Wi-Fi'
              });
            }

            linksArr.push({
              id: 'link_router_modem',
              from: gatewayNodeId,
              to: 'node_modem',
              name: 'Router Uplink',
              type: 'wan_link',
              media: 'Gigabit Ethernet'
            });

            linksArr.push({
              id: 'link_gateway_wan',
              from: 'node_modem',
              to: 'node_internet',
              name: 'WAN Broadband',
              type: 'wan_link',
              media: 'Broadband Fiber'
            });
          }

          // 3. ISP Modem / ONT Node
          nodes.push({
            id: 'node_modem',
            name: `ISP Modem / ONT (${modemIp})`,
            type: 'modem',
            role: 'modem',
            ip: modemIp,
            status: modemPingRaw.success ? 'online' : 'offline'
          });

          // 4. Internet Gateway Node
          nodes.push({
            id: 'node_internet',
            name: 'Internet Gateway',
            type: 'wan',
            role: 'internet',
            ip: '1.1.1.1',
            status: 'online'
          });

          let healthScore = 100;
          const wanLoss = linkStats.link_gateway_wan?.lossPct || 0;
          const wanSamples = linkStats.link_gateway_wan?.samplesCount || 0;
          const apLoss = linkStats.link_client_ap?.lossPct || 0;
          const apSamples = linkStats.link_client_ap?.samplesCount || 0;
          const modemLoss = linkStats.link_router_modem?.lossPct || 0;
          const modemSamples = linkStats.link_router_modem?.samplesCount || 0;

          // Warm-up guard: Only penalize if sample count >= 8 to prevent startup false alarms
          if (wanSamples >= 8 && wanLoss > 10) {
            healthScore -= (wanLoss - 10) * 1.5;
          }
          if (apSamples >= 8 && apLoss > 10) {
            healthScore -= (apLoss - 10) * 2.0;
          }
          if (modemSamples >= 8 && modemLoss > 10) {
            healthScore -= (modemLoss - 10) * 1.5;
          }
          healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

          const overallStatus = healthScore >= 90 ? 'HEALTHY' : healthScore >= 70 ? 'DEGRADED' : 'CRITICAL';

          const issues: any[] = [];
          if (wanSamples >= 8 && wanLoss >= 15) {
            issues.push({
              id: 'WAN_LOSS',
              severity: wanLoss >= 35 ? 'CRITICAL' : 'WARNING',
              title: 'WAN Internet Packet Loss',
              description: `Experiencing ${wanLoss}% sustained packet loss to external internet (1.1.1.1).`,
              recommendation: 'Check external ISP connection or contact service provider.'
            });
          }
          if (modemSamples >= 8 && modemLoss >= 15) {
            issues.push({
              id: 'MODEM_LOSS',
              severity: modemLoss >= 35 ? 'CRITICAL' : 'WARNING',
              title: 'Router to Modem Link Degradation',
              description: `Experiencing ${modemLoss}% packet loss between primary router and modem (${modemIp}).`,
              recommendation: 'Inspect Ethernet cable connecting router WAN port to modem/ONT.'
            });
          }
          if (apSamples >= 8 && apLoss >= 15) {
            issues.push({
              id: 'CLIENT_AP_LOSS',
              severity: apLoss >= 35 ? 'CRITICAL' : 'WARNING',
              title: 'Local Wi-Fi Signal Loss',
              description: `Experiencing ${apLoss}% packet loss to active Access Point (${gatewayIp}).`,
              recommendation: 'Move closer to the nearest mesh point or check for local 2.4/5GHz interference.'
            });
          }

          setSnapshot({
            wifi: wifiParsed,
            topology: { nodes, links: linksArr },
            links: linkStats,
            diagnosis: {
              overallStatus,
              healthScore,
              issues,
              incidents: []
            }
          });
        } catch (err) {
          console.error('Android bridge error:', err);
        }
      };

      runAndroidTick();
      const interval = setInterval(runAndroidTick, 1000);
      return () => clearInterval(interval);
    }

    // Standard Desktop / Browser Mode
    fetchStatus();
    fetchProviders();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    const connectWs = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'SPEEDTEST_UPDATE') {
            setSpeedtestState(msg.data);
          } else if (msg.type === 'SNAPSHOT' || msg.type === 'TOPOLOGY_UPDATE') {
            setSnapshot(msg.data);
            if (msg.data.activeProvider) setActiveProvider(msg.data.activeProvider);
          } else if (msg.type === 'TELEMETRY_UPDATE') {
            setSnapshot((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                links: msg.data.links,
                wifi: msg.data.wifi,
                diagnosis: msg.data.diagnosis
              };
            });
          }
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        // Reconnect after 2 seconds
        setTimeout(connectWs, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWs();

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const handleRescan = async () => {
    setIsRescanning(true);
    try {
      if (typeof (window as any).AndroidBridge !== 'undefined') {
        const bridge = (window as any).AndroidBridge;
        try {
          if (bridge.triggerScan) bridge.triggerScan();
        } catch (e) {}
        setTimeout(() => setIsRescanning(false), 800);
        return;
      }
      await fetch('/api/rescan', { method: 'POST' });
      await fetchStatus();
      if (speedtestRunOnRescan) {
        runSpeedtest();
      }
    } catch (e) {
      console.error('Rescan failed:', e);
    } finally {
      setTimeout(() => setIsRescanning(false), 800);
    }
  };

  const handleSaveSettings = async () => {
    try {
      localStorage.setItem('meshpulse_speedtest_hourly', JSON.stringify(speedtestAutoHourly));
      localStorage.setItem('meshpulse_speedtest_rescan', JSON.stringify(speedtestRunOnRescan));

      const isAndroid = typeof (window as any).AndroidBridge !== 'undefined';
      if (isAndroid) {
        // Save locally for Android native mode
        localStorage.setItem('meshpulse_android_config', JSON.stringify({
          selectedProvider: settingsProvider,
          pingIntervalMs: Number(settingsInterval),
          customNodes,
          speedtestAutoHourly,
          speedtestRunOnRescan
        }));
        setIsSettingsOpen(false);
        return;
      }

      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedProvider: settingsProvider,
          pingIntervalMs: Number(settingsInterval),
          customNodes,
          speedtest: {
            enabled: speedtestAutoHourly,
            intervalMinutes: 60,
            runOnRescan: speedtestRunOnRescan
          }
        })
      });

      if (settingsProvider !== activeProvider.id) {
        await fetch('/api/provider', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: settingsProvider })
        });
      }
      setIsSettingsOpen(false);
      handleRescan();
    } catch (e) {
      console.error('Failed to save settings:', e);
      setIsSettingsOpen(false);
    }
  };

  const handleToggleNodeWired = async (ip: string, currentIsWired: boolean) => {
    try {
      const isAndroid = typeof (window as any).AndroidBridge !== 'undefined';
      if (isAndroid) {
        let overrides: Record<string, any> = {};
        try {
          overrides = JSON.parse(localStorage.getItem('meshpulse_android_node_overrides') || '{}');
        } catch (e) {}
        overrides[ip] = { isWired: !currentIsWired };
        localStorage.setItem('meshpulse_android_node_overrides', JSON.stringify(overrides));
        return;
      }
      await fetch('/api/node-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, isWired: !currentIsWired })
      });
      await fetchStatus();
    } catch (e) {
      console.error('Failed to update node override:', e);
    }
  };

  const addCustomNode = () => {
    if (!customIpInput.trim()) return;
    setCustomNodes(prev => [
      ...prev,
      {
        id: `custom_${Date.now()}`,
        name: customNameInput.trim() || `Node ${customIpInput}`,
        ip: customIpInput.trim(),
        role: prev.length === 0 ? 'root' : 'satellite'
      }
    ]);
    setCustomIpInput('');
    setCustomNameInput('');
  };

  const removeCustomNode = (idx: number) => {
    setCustomNodes(prev => prev.filter((_, i) => i !== idx));
  };

  const wifi: WifiInfo = snapshot?.wifi || { connected: false };
  const topology = snapshot?.topology || { nodes: [], links: [] };
  const links: Record<string, LinkStat> = snapshot?.links || {};
  const diagnosis = snapshot?.diagnosis || { overallStatus: 'INITIALIZING', healthScore: 100, issues: [], incidents: [] };
  const overallStatus = diagnosis.overallStatus;
  const healthScore = typeof diagnosis.healthScore === 'number' ? diagnosis.healthScore : 100;

  // Helper to format uptime in hours/days
  const formatUptime = (seconds?: number) => {
    if (!seconds) return 'N/A';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  // Helper to render sparkline
  const renderSparkline = (history?: { t: number; ms: number | null }[]) => {
    if (!history || history.length < 2) {
      return <div className="h-8 flex items-center text-xs text-slate-500">Awaiting data...</div>;
    }
    const pts = history.slice(-25);
    const maxVal = Math.max(...pts.map(p => p.ms || 0), 15);
    const width = 120;
    const height = 28;

    const points = pts.map((p, idx) => {
      const x = (idx / (pts.length - 1)) * width;
      const y = height - ((p.ms !== null ? p.ms : maxVal) / maxVal) * (height - 4) - 2;
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width={width} height={height} className="overflow-visible">
        <polyline
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-12">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40 px-2.5 sm:px-6 py-2 sm:py-3 flex items-center justify-between gap-1.5 sm:gap-2 w-full">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
            <Radio className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 sm:gap-1.5 flex-nowrap">
              <span className="font-extrabold text-sm sm:text-base tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-400 shrink-0">
                MeshPulse
              </span>
              <span className="text-[10px] font-mono px-1 py-0.2 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                v{pkg.version}
              </span>
              <span className={`inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${
                overallStatus === 'HEALTHY'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : overallStatus === 'DEGRADED'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  overallStatus === 'HEALTHY' ? 'bg-emerald-400 animate-pulse' :
                  overallStatus === 'DEGRADED' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400 animate-ping'
                }`} />
                <span className="hidden sm:inline">{overallStatus}</span>
                <span>({healthScore}%)</span>
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-1.5 truncate mt-0.5">
              <span className="truncate">System: <strong className="text-slate-200">{activeProvider.name}</strong></span>
              <span>•</span>
              <span className="flex items-center gap-1 shrink-0">
                <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span className="hidden sm:inline">{wsConnected ? 'Live 1s' : 'Connecting'}</span>
                <span className="sm:hidden">{wsConnected ? 'Live' : 'Off'}</span>
              </span>
            </p>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {wifi.connected && (
            <div className="hidden lg:flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs">
              <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Wifi className="w-3.5 h-3.5 text-cyan-400" />
                <span>{wifi.ssid}</span>
              </div>
              <span className="text-slate-500">|</span>
              <span className="text-slate-400 font-mono">{wifi.band} (Ch {wifi.channel})</span>
              <span className="text-slate-500">|</span>
              <span className="text-emerald-400 font-mono font-semibold">{wifi.signal}% ({wifi.rssi} dBm)</span>
            </div>
          )}

          {/* Non-disturbing Background Speedtest Indicator / Button */}
          {speedtestState.isRunning ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-700/60 text-cyan-300 text-xs shadow-sm">
              <Zap className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span className="font-mono text-[11px] font-semibold">
                Speedtest: {speedtestState.currentStage}...
              </span>
            </div>
          ) : speedtestState.lastResult ? (
            <button
              onClick={() => setIsSpeedtestModalOpen(true)}
              title="Click to view Speedtest telemetry and history"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition active:scale-95"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-mono font-bold text-white">{speedtestState.lastResult.downloadMbps}</span>
              <span className="text-[10px] text-slate-400 font-mono">Mbps</span>
            </button>
          ) : (
            <button
              onClick={runSpeedtest}
              title="Run background bandwidth speedtest"
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition active:scale-95"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Speedtest</span>
            </button>
          )}

          <button
            onClick={handleRescan}
            disabled={isRescanning}
            aria-label="Rescan Network"
            className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRescanning ? 'animate-spin text-cyan-400' : ''}`} />
            <span className="hidden sm:inline">{isRescanning ? 'Scanning...' : 'Rescan'}</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Configure Mesh System"
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition"
          >
            <Settings className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Configure</span>
            <span className="sm:hidden">Config</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto w-full px-6 pt-6 flex-1 flex flex-col gap-6">
        
        {/* Active Issues / Diagnostic Notification Banner */}
        {diagnosis.issues && diagnosis.issues.length > 0 ? (
          <div className="flex flex-col gap-2">
            {diagnosis.issues.map((issue: Issue, idx: number) => (
              <div
                key={idx}
                className={`p-4 rounded-xl border flex items-start justify-between gap-4 ${
                  issue.severity === 'CRITICAL'
                    ? 'bg-rose-950/40 border-rose-800/80 text-rose-200'
                    : 'bg-amber-950/40 border-amber-800/80 text-amber-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 p-2 rounded-lg ${
                    issue.severity === 'CRITICAL' ? 'bg-rose-900/60 text-rose-400' : 'bg-amber-900/60 text-amber-400'
                  }`}>
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm tracking-wide text-white">{issue.title}</h4>
                    <p className="text-xs text-slate-300 mt-0.5">{issue.description}</p>
                    {issue.recommendation && (
                      <p className="text-xs font-medium text-amber-300 mt-1 flex items-center gap-1">
                        <ArrowRight className="w-3 h-3 inline" />
                        <span>Action: {issue.recommendation}</span>
                      </p>
                    )}
                  </div>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-black/40">
                  {issue.severity}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 flex items-center justify-between text-xs font-medium">
            <div className="flex items-center gap-2.5">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>All mesh backhaul channels, client links, and WAN uplinks are functioning within normal operational parameters (0% packet drop).</span>
            </div>
            <span className="font-mono text-[11px] text-emerald-400/80">Continuous active probing</span>
          </div>
        )}

        {/* Tab Selector */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('topology')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
                activeTab === 'topology'
                  ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Mesh Architecture Map</span>
            </button>
            <button
              onClick={() => setActiveTab('links')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
                activeTab === 'links'
                  ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Hop-by-Hop Metrics</span>
            </button>
            <button
              onClick={() => setActiveTab('incidents')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
                activeTab === 'incidents'
                  ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Incident History ({diagnosis.incidents?.length || 0})</span>
            </button>
            <button
              onClick={() => { setActiveTab('devices'); fetchDevices(); }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
                activeTab === 'devices'
                  ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Connected Devices {devicesList.length > 0 ? `(${devicesList.length})` : ''}</span>
            </button>
          </div>

          <div className="text-xs text-slate-500 font-mono">
            {topology.nodes?.length || 0} nodes mapped • {topology.links?.length || 0} links monitored
          </div>
        </div>

        {/* TAB 1: TOPOLOGY MAP */}
        {activeTab === 'topology' && (
          <div className={`grid grid-cols-1 ${selectedNode ? 'lg:grid-cols-3' : 'grid-cols-1'} gap-6 transition-all duration-300`}>
            
            {/* Visual Architecture Map Canvas */}
            <div 
              onClick={() => setSelectedNode(null)}
              className={`${selectedNode ? 'lg:col-span-2' : 'col-span-1'} glass-panel p-5 flex flex-col justify-between min-h-[440px] relative transition-all duration-300 cursor-default`}
            >
              <div className="flex items-center justify-between z-10 flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-200 tracking-wide flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-400" />
                    <span>Live Physical Mesh Topology</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    {selectedNode 
                      ? 'Inspecting selected node. Click background to collapse inspector.' 
                      : 'Click any node to view hardware specifications, backhaul channel, and uptime.'}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono">
                  {/* Always-visible System Health Indicator */}
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-700/80 shadow-sm">
                    <span className="text-slate-400 text-[11px]">System Health:</span>
                    <span className={`font-bold font-mono text-xs ${
                      healthScore >= 90 ? 'text-emerald-400' :
                      healthScore >= 70 ? 'text-amber-400' : 'text-rose-400'
                    }`}>
                      {healthScore}/100
                    </span>
                  </div>

                  <div className="hidden sm:flex items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Optimal Link
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Degraded
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-400" /> Loss
                    </span>
                  </div>
                </div>
              </div>

              {/* Dynamic Interactive Node Diagram - Responsive & Visible */}
              <div className="py-8 overflow-x-auto">
                <div className="flex items-center justify-between gap-2 sm:gap-3 z-10 px-2 min-w-[680px]">
                  
                  {/* 1. Host PC */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNode(topology.nodes?.find((n: any) => n.type === 'client'));
                    }}
                    className={`cursor-pointer p-3 rounded-xl border flex flex-col items-center gap-1.5 transition hover:scale-105 shrink-0 w-[100px] ${
                      selectedNode?.type === 'client'
                        ? 'border-cyan-400 bg-cyan-950/40 ring-2 ring-cyan-500/20'
                        : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-cyan-400 shadow-md">
                      <Laptop className="w-5 h-5" />
                    </div>
                    <div className="text-center w-full">
                      <div className="text-xs font-bold text-white truncate">Host PC</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">{wifi.signal}% ({wifi.rssi} dBm)</div>
                      <div className="text-[9px] text-cyan-400 font-mono">{wifi.band || '5 GHz'}</div>
                    </div>
                  </div>

                  {/* Animated Arrow / Link 1 */}
                  <div className="flex flex-col items-center justify-center gap-1 font-mono text-[10px] shrink-0 w-[64px]">
                    <span className="text-slate-400 text-[9px]">PC ➔ AP</span>
                    <div className={`px-1.5 py-0.5 rounded font-bold border text-center ${
                      (links['link_client_ap']?.avg || 0) > 40
                        ? 'bg-amber-950/60 text-amber-400 border-amber-600/40'
                        : 'bg-emerald-950/60 text-emerald-400 border-emerald-600/40'
                    }`}>
                      {links['link_client_ap']?.current !== null ? `${links['link_client_ap']?.current} ms` : '—'}
                    </div>
                    <div className="w-12 h-0.5 bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-500 relative">
                      <div className="w-1.5 h-1.5 rounded-full bg-white absolute -top-0.5 animate-ping" />
                    </div>
                    <span className="text-[9px] text-slate-500">
                      {links['link_client_ap']?.lossPct || 0}% loss
                    </span>
                  </div>

                  {/* 2. Satellites / Access Points Stack */}
                  <div className="flex flex-col gap-2 shrink-0">
                    {topology.nodes?.filter((n: any) => n.type === 'satellite').map((sat: any) => (
                      <div
                        key={sat.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedNode(sat);
                        }}
                        className={`cursor-pointer p-2.5 rounded-xl border flex items-center gap-2.5 transition hover:scale-105 w-[165px] ${
                          sat.isCurrentAP
                            ? 'border-emerald-500/70 bg-emerald-950/20 shadow-lg shadow-emerald-500/10'
                            : selectedNode?.id === sat.id
                            ? 'border-indigo-400 bg-indigo-950/40'
                            : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-indigo-400 shrink-0">
                          <Router className="w-4 h-4" />
                        </div>
                        <div className="overflow-hidden">
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-white truncate">{sat.name}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">{sat.ip}</div>
                          <div className={`text-[9px] font-mono truncate mt-0.5 ${
                            sat.isWiredBackhaul ? 'text-emerald-400 font-bold' : 'text-indigo-400'
                          }`}>
                            {sat.isWiredBackhaul ? '⚡ Wired Ethernet (1G)' : (sat.backhaulType || 'Mesh Backhaul')}
                          </div>
                          {sat.isCurrentAP && (
                            <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold inline-block mt-0.5">
                              Connected AP
                            </span>
                          )}
                          {sat.hasLocalLanDevice && (
                            <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-semibold inline-block mt-0.5 ml-1">
                              LAN Active
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Animated Arrow / Link 2 (Backhaul) */}
                  {(() => {
                    const satellites = topology.nodes?.filter((n: any) => n.type === 'satellite') || [];
                    const activeSat = satellites.find((s: any) => s.isCurrentAP) || satellites[0];
                    const isWired = activeSat?.isWiredBackhaul || satellites.some((s: any) => s.isWiredBackhaul);

                    return (
                      <div className="flex flex-col items-center justify-center gap-1 font-mono text-[10px] shrink-0 w-[68px]">
                        <span className="text-slate-400 text-[9px]">Backhaul</span>
                        <div className={`px-1.5 py-0.5 rounded font-bold border text-center transition-all ${
                          isWired
                            ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/50 shadow-sm shadow-emerald-500/20'
                            : 'bg-indigo-950/60 text-indigo-300 border-indigo-600/40'
                        }`}>
                          {isWired ? '⚡ Wired' : '6 GHz'}
                        </div>
                        <div className={`w-12 h-0.5 relative ${
                          isWired ? 'bg-gradient-to-r from-emerald-500 to-purple-500' : 'bg-gradient-to-r from-indigo-500 to-purple-500'
                        }`}>
                          <div className={`w-1.5 h-1.5 rounded-full absolute -top-0.5 ${isWired ? 'bg-emerald-300' : 'bg-indigo-300'}`} />
                        </div>
                        <span className="text-[8px] text-slate-500">
                          {isWired ? '1 Gbps RJ45' : `Ch ${topology.systemInfo?.meshChannel || '197'}`}
                        </span>
                      </div>
                    );
                  })()}

                  {/* 3. Main Router (Root Gateway) */}
                  {(() => {
                    const rootNode = topology.nodes?.find((n: any) => n.type === 'root') || {
                      name: 'Main Router',
                      ip: wifi.gatewayIp || '192.168.1.1'
                    };
                    return (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedNode(rootNode);
                        }}
                        className={`cursor-pointer p-3 rounded-xl border flex flex-col items-center gap-1.5 transition hover:scale-105 shrink-0 w-[115px] ${
                          selectedNode?.id === rootNode.id
                            ? 'border-purple-400 bg-purple-950/40 ring-2 ring-purple-500/20'
                            : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-lg bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-md">
                          <Router className="w-5 h-5" />
                        </div>
                        <div className="text-center w-full">
                          <div className="text-xs font-bold text-white truncate">{rootNode.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">{rootNode.ip}</div>
                          <div className="text-[9px] text-purple-400 font-mono">Root Gateway</div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 4. Modem / ONT Hop (if present) or Direct Link */}
                  {(() => {
                    const modemNode = topology.nodes?.find((n: any) => n.type === 'modem');
                    const routerModemLink = links['link_router_modem'];
                    const modemWanLink = links['link_gateway_wan'];

                    if (modemNode) {
                      return (
                        <>
                          {/* Router to Modem Link */}
                          <div className="flex flex-col items-center justify-center gap-1 font-mono text-[10px] shrink-0 w-[68px]">
                            <span className="text-slate-400 text-[9px]">Router ➔ Modem</span>
                            <div className={`px-1.5 py-0.5 rounded font-bold border text-center ${
                              (routerModemLink?.lossPct || 0) > 15
                                ? 'bg-rose-950/60 text-rose-400 border-rose-600/40 animate-pulse'
                                : (routerModemLink?.avg || 0) > 30
                                ? 'bg-amber-950/60 text-amber-400 border-amber-600/40'
                                : 'bg-emerald-950/60 text-emerald-300 border-emerald-600/40'
                            }`}>
                              {routerModemLink?.current !== null ? `${routerModemLink?.current} ms` : '—'}
                            </div>
                            <div className="w-12 h-0.5 relative bg-gradient-to-r from-purple-500 to-emerald-500">
                              <div className="w-1.5 h-1.5 rounded-full bg-white absolute -top-0.5 animate-ping" />
                            </div>
                            <span className={`text-[8px] font-bold ${
                              (routerModemLink?.lossPct || 0) > 15 ? 'text-rose-400' : 'text-slate-500'
                            }`}>
                              {routerModemLink?.lossPct || 0}% loss
                            </span>
                          </div>

                          {/* Modem Node Card */}
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedNode(modemNode);
                            }}
                            className={`cursor-pointer p-3 rounded-xl border flex flex-col items-center gap-1.5 transition hover:scale-105 shrink-0 w-[110px] ${
                              selectedNode?.id === modemNode.id
                                ? 'border-emerald-400 bg-emerald-950/40 ring-2 ring-emerald-500/20'
                                : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                            }`}
                          >
                            <div className="w-10 h-10 rounded-lg bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-md">
                              <Server className="w-5 h-5" />
                            </div>
                            <div className="text-center w-full">
                              <div className="text-xs font-bold text-white truncate">ISP Modem / ONT</div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">{modemNode.ip}</div>
                              <div className="text-[9px] text-emerald-400 font-mono">Fiber Bridge</div>
                            </div>
                          </div>

                          {/* Modem to Internet WAN Link */}
                          <div className="flex flex-col items-center justify-center gap-1 font-mono text-[10px] shrink-0 w-[68px]">
                            <span className="text-slate-400 text-[9px]">Modem ➔ WAN</span>
                            <div className={`px-1.5 py-0.5 rounded font-bold border text-center ${
                              (modemWanLink?.lossPct || 0) > 15
                                ? 'bg-rose-950/60 text-rose-400 border-rose-600/40 animate-pulse'
                                : (modemWanLink?.avg || 0) > 60
                                ? 'bg-amber-950/60 text-amber-400 border-amber-600/40'
                                : 'bg-cyan-950/60 text-cyan-300 border-cyan-600/40'
                            }`}>
                              {modemWanLink?.current !== null ? `${modemWanLink?.current} ms` : '—'}
                            </div>
                            <div className={`w-12 h-0.5 relative ${
                              (modemWanLink?.lossPct || 0) > 15 ? 'bg-rose-500' : 'bg-gradient-to-r from-emerald-500 to-cyan-500'
                            }`} />
                            <span className={`text-[8px] font-bold ${
                              (modemWanLink?.lossPct || 0) > 15 ? 'text-rose-400' : 'text-slate-500'
                            }`}>
                              {modemWanLink?.lossPct || 0}% loss
                            </span>
                          </div>
                        </>
                      );
                    }

                    // Direct Root to Internet Link (fallback if no modem discovered)
                    return (
                      <div className="flex flex-col items-center justify-center gap-1 font-mono text-[10px] shrink-0 w-[68px]">
                        <span className="text-slate-400 text-[9px]">WAN Uplink</span>
                        <div className={`px-1.5 py-0.5 rounded font-bold border text-center ${
                          (links['link_gateway_wan']?.lossPct || 0) > 15
                            ? 'bg-rose-950/60 text-rose-400 border-rose-600/40 animate-pulse'
                            : 'bg-cyan-950/60 text-cyan-300 border-cyan-600/40'
                        }`}>
                          {links['link_gateway_wan']?.current !== null ? `${links['link_gateway_wan']?.current} ms` : '—'}
                        </div>
                        <div className={`w-12 h-0.5 relative ${
                          (links['link_gateway_wan']?.lossPct || 0) > 15 ? 'bg-rose-500' : 'bg-gradient-to-r from-purple-500 to-cyan-500'
                        }`} />
                        <span className={`text-[9px] font-bold ${
                          (links['link_gateway_wan']?.lossPct || 0) > 15 ? 'text-rose-400' : 'text-slate-500'
                        }`}>
                          {links['link_gateway_wan']?.lossPct || 0}% loss
                        </span>
                      </div>
                    );
                  })()}

                  {/* 5. WAN / Internet */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNode(topology.nodes?.find((n: any) => n.type === 'wan'));
                    }}
                    className={`cursor-pointer p-3 rounded-xl border flex flex-col items-center gap-1.5 transition hover:scale-105 shrink-0 w-[100px] ${
                      selectedNode?.type === 'wan'
                        ? 'border-cyan-400 bg-cyan-950/40 ring-2 ring-cyan-500/20'
                        : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-cyan-950/60 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-md">
                      <Globe className="w-5 h-5" />
                    </div>
                    <div className="text-center w-full">
                      <div className="text-xs font-bold text-white truncate">Internet</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">1.1.1.1</div>
                      <div className="text-[9px] text-cyan-400 font-mono">Cloud Edge</div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Bottom Legend / Telemetry Bar */}
              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono">
                <div>Mesh Channel: <strong className="text-slate-200">{topology.systemInfo?.meshChannel || '197 (6 GHz)'}</strong></div>
                <div>Connected BSSID: <strong className="text-slate-200">{wifi.bssid || 'Auto-Detected'}</strong></div>
                <div>PHY Rate: <strong className="text-slate-200">{wifi.txRate || 433} Mbps</strong></div>
              </div>
            </div>

            {/* Node Inspection Panel - Only rendered when a node is selected */}
            {selectedNode && (
              <div 
                onClick={(e) => e.stopPropagation()}
                className="glass-panel p-5 flex flex-col justify-between transition-all duration-300 animate-fadeIn"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-200 tracking-wide flex items-center gap-2">
                      <Info className="w-4 h-4 text-indigo-400" />
                      <span>Node Inspector</span>
                    </h3>
                    <button
                      onClick={() => setSelectedNode(null)}
                      className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold transition flex items-center gap-1"
                      title="Collapse Inspector"
                    >
                      ✕ Close
                    </button>
                  </div>

                  {(() => {
                    const node = selectedNode 
                      ? (topology.nodes?.find((n: any) => n.id === selectedNode.id || n.ip === selectedNode.ip) || selectedNode)
                      : null;
                    if (!node) return null;

                    return (
                      <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
                          <div className="text-xs text-slate-400">Node Label</div>
                          <div className="text-sm font-bold text-white mt-0.5">{node.name}</div>
                          <div className="text-xs text-indigo-400 font-mono mt-0.5">Role: {node.role}</div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                            <span className="text-slate-500 block text-[10px]">IP ADDRESS</span>
                            <span className="text-slate-200 font-bold">{node.ip}</span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                            <span className="text-slate-500 block text-[10px]">HARDWARE MODEL</span>
                            <span className="text-slate-200 font-bold">{node.model || (node.type === 'modem' ? 'ISP Modem / ONT (Unknown)' : node.type === 'wan' ? 'Cloud Edge (1.1.1.1)' : node.type === 'client' ? 'Client Host' : 'Unknown')}</span>
                          </div>
                          {node.mac && (
                            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                              <span className="text-slate-500 block text-[10px]">MAC ADDRESS</span>
                              <span className="text-slate-200 font-bold">{node.mac}</span>
                            </div>
                          )}
                          {node.uptime && (
                            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                              <span className="text-slate-500 block text-[10px]">DEVICE UPTIME</span>
                              <span className="text-emerald-400 font-bold">{formatUptime(node.uptime)}</span>
                            </div>
                          )}
                          {node.softwareVersion && (
                            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 col-span-2">
                              <span className="text-slate-500 block text-[10px]">SOFTWARE FIRMWARE</span>
                              <span className="text-slate-200">{node.softwareVersion}</span>
                            </div>
                          )}
                          {node.backhaulType && (
                            <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 col-span-2">
                              <span className="text-slate-500 block text-[10px]">ACTIVE BACKHAUL MEDIUM</span>
                              <span className={`font-bold ${node.isWiredBackhaul ? 'text-emerald-400' : 'text-cyan-400'}`}>
                                {node.backhaulType}
                              </span>
                            </div>
                          )}

                          {node.type === 'modem' && (
                            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 col-span-2 text-xs">
                              <span className="text-emerald-300 font-bold block">🌐 ISP Optical Network Terminal (ONT) / Modem</span>
                              <p className="text-slate-300 text-[11px] mt-1 leading-relaxed">
                                Upstream gateway providing WAN connectivity to your primary router. Monitored via ICMP telemetry to verify physical fiber/cable link integrity.
                              </p>
                            </div>
                          )}

                          {node.type === 'satellite' && (
                            <>
                              {node.isWiredBackhaul ? (
                                <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 col-span-2 text-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <div>
                                      <span className="text-emerald-300 font-bold block">⚡ Wired Ethernet Backhaul Active</span>
                                      <p className="text-slate-300 text-[11px] mt-1 leading-relaxed">
                                        Point is connected via physical Ethernet cable back to root router at full gigabit speed.
                                      </p>
                                    </div>
                                    <button
                                      onClick={() => handleToggleNodeWired(node.ip, true)}
                                      className="px-2.5 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition shrink-0"
                                    >
                                      Switch to Wi-Fi
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-3 rounded-lg bg-slate-900/90 border border-indigo-900/60 col-span-2 text-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <div>
                                      <span className="text-indigo-300 font-bold block">📶 Wi-Fi 6E Wireless Mesh Active</span>
                                      <p className="text-slate-400 text-[11px] mt-1 leading-relaxed">
                                        Nest Wifi Pro firmware (3.78+) bridges wired satellite ports into the internal switch without reporting it via legacy local v1 status. If this node is connected via Ethernet cable, click to activate Wired mode:
                                      </p>
                                    </div>
                                    <button
                                      onClick={() => handleToggleNodeWired(node.ip, false)}
                                      className="px-3 py-1.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white shadow transition flex items-center gap-1.5 shrink-0"
                                    >
                                      ⚡ Set as Wired
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Dynamic Composite Health Summary */}
                <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 mt-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">Composite Network Health</span>
                    <span className={`font-bold font-mono text-sm ${
                      healthScore >= 90 ? 'text-emerald-400' :
                      healthScore >= 70 ? 'text-amber-400' : 'text-rose-400'
                    }`}>
                      {healthScore} / 100
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full mt-2 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 rounded-full bg-gradient-to-r ${
                        healthScore >= 90 ? 'from-emerald-500 to-cyan-400' :
                        healthScore >= 70 ? 'from-amber-500 to-orange-400' : 'from-rose-500 to-red-600'
                      }`}
                      style={{ width: `${healthScore}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* TAB 2: HOP-BY-HOP LINK METRICS */}
        {activeTab === 'links' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Object.keys(links).map((linkId) => {
              const link = links[linkId];
              
              // Intelligent Hop Classification & Naming
              let category = 'Local AP Link';
              let hopTitle = link.host;
              let hopSubtitle = 'Local Network Hop';

              if (linkId.includes('wan')) {
                category = 'WAN Cloud Uplink';
                hopTitle = 'Internet Edge (1.1.1.1)';
                hopSubtitle = 'Public Internet Transit';
              } else if (linkId === 'link_client_ap') {
                category = 'Direct Wi-Fi Hop';
                hopTitle = `Connected AP (${link.host})`;
                hopSubtitle = 'Client Device ➔ Connected Mesh Node';
              } else if (linkId === 'link_client_gateway') {
                category = 'Mesh Transit Hop';
                hopTitle = `Main Router Gateway (${link.host})`;
                hopSubtitle = 'Client ➔ Root Gateway via Mesh Backhaul';
              } else if (linkId.includes('router_modem')) {
                category = 'Modem Uplink';
                hopTitle = `ISP Modem / ONT (${link.host})`;
                hopSubtitle = 'Root Router ➔ ISP Broadband Bridge';
              } else if (linkId.includes('node') || linkId.includes('backhaul')) {
                category = 'Satellite Mesh Backhaul';
                hopTitle = `Satellite Node (${link.host})`;
                hopSubtitle = 'Host ➔ Remote Satellite Node';
              }

              return (
                <div key={linkId} className="glass-panel p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-semibold">
                          {category}
                        </span>
                        <h4 className="text-sm font-bold text-white mt-0.5">{hopTitle}</h4>
                        <span className="text-[10px] text-slate-400 block font-normal">{hopSubtitle}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                        link.lossPct > 10 ? 'bg-rose-500/20 text-rose-400' :
                        (link.avg || 0) > 40 ? 'bg-amber-500/20 text-amber-400' :
                        'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {link.lossPct > 0 ? `${link.lossPct}% loss` : '0% loss'}
                      </span>
                    </div>

                    {/* Big Metric Display */}
                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-3xl font-extrabold text-white tracking-tight font-mono">
                        {link.current !== null ? link.current : '—'}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">ms RTT</span>
                    </div>

                    {/* Sparkline Graph */}
                    <div className="mt-3 p-2 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between">
                      <div className="text-[10px] text-slate-400 font-mono">
                        <div>Min: <strong className="text-slate-200">{link.min}ms</strong></div>
                        <div>Max: <strong className="text-slate-200">{link.max}ms</strong></div>
                      </div>
                      {renderSparkline(link.history)}
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-2 mt-3 text-xs font-mono">
                      <div className="p-2 rounded bg-slate-900/40 border border-slate-800/80">
                        <span className="text-slate-500 text-[10px] block">AVG LATENCY</span>
                        <span className="text-slate-200 font-semibold">{link.avg || 0} ms</span>
                      </div>
                      <div className="p-2 rounded bg-slate-900/40 border border-slate-800/80">
                        <span className="text-slate-500 text-[10px] block">JITTER</span>
                        <span className="text-slate-200 font-semibold">{link.jitter || 0} ms</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between font-mono">
                    <span>Samples: {link.samplesCount}</span>
                    <span className="text-emerald-400 font-semibold">Active Monitoring</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 3: INCIDENT LOG */}
        {activeTab === 'incidents' && (
          <div className="glass-panel p-6">
            <h3 className="text-sm font-bold text-slate-200 tracking-wide flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-cyan-400" />
              <span>Historical Network Incidents & Problem Timeline</span>
            </h3>

            {diagnosis.incidents && diagnosis.incidents.length > 0 ? (
              <div className="space-y-3">
                {diagnosis.incidents.map((inc: Incident, idx: number) => (
                  <div key={idx} className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 p-2 rounded-lg ${
                        inc.severity === 'CRITICAL' ? 'bg-rose-900/40 text-rose-400' : 'bg-amber-900/40 text-amber-400'
                      }`}>
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-white">{inc.title}</h4>
                          <span className="text-[10px] font-mono text-slate-400">
                            {new Date(inc.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-0.5">{inc.description}</p>
                        {inc.recommendation && (
                          <p className="text-xs text-amber-400/90 mt-1">Recommended: {inc.recommendation}</p>
                        )}
                      </div>
                    </div>
                    <div>
                      {inc.resolvedAt ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                          Resolved ({Math.round((inc.resolvedAt - inc.timestamp) / 1000)}s)
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 font-semibold animate-pulse">
                          Active Issue
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-500">
                No network incidents or link drops detected. The mesh network has maintained continuous uptime.
              </div>
            )}
          </div>
        )}

        {/* TAB 4: CONNECTED DEVICES */}
        {activeTab === 'devices' && (
          <div className="glass-panel p-6 flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-200 tracking-wide flex items-center gap-2">
                  <Users className="w-4 h-4 text-cyan-400" />
                  <span>Discovered Subnet & Mesh Connected Devices</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Real-time ARP & neighbor table mapping of active clients, smart home accessories, and mesh hardware.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={deviceSearch}
                    onChange={(e) => setDeviceSearch(e.target.value)}
                    placeholder="Search by IP, MAC, vendor..."
                    className="pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-56 sm:w-64"
                  />
                </div>
                <button
                  onClick={fetchDevices}
                  disabled={isFetchingDevices}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition active:scale-95"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFetchingDevices ? 'animate-spin text-cyan-400' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {/* Device Count Summary Chips */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span className="px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700 text-slate-300">
                Total Devices: <strong className="text-white">{devicesList.length}</strong>
              </span>
              <span className="px-2.5 py-1 rounded bg-purple-950/40 border border-purple-800/60 text-purple-300">
                Private Wi-Fi (Random MAC): <strong className="text-purple-200">{devicesList.filter(d => d.isRandomized).length}</strong>
              </span>
              <span className="px-2.5 py-1 rounded bg-indigo-950/40 border border-indigo-800/60 text-indigo-300">
                Known OUI Vendors: <strong className="text-indigo-200">{devicesList.filter(d => !d.isRandomized && d.vendor !== 'Generic Device').length}</strong>
              </span>
            </div>

            {/* Devices Grid */}
            {(() => {
              const q = deviceSearch.toLowerCase().trim();
              const filtered = devicesList.filter(d =>
                !q ||
                d.ip?.toLowerCase().includes(q) ||
                d.mac?.toLowerCase().includes(q) ||
                d.vendor?.toLowerCase().includes(q) ||
                d.type?.toLowerCase().includes(q)
              );

              if (filtered.length === 0) {
                return (
                  <div className="py-16 text-center text-xs text-slate-500">
                    {isFetchingDevices ? 'Scanning local network for connected devices...' : 'No devices found matching your search filter.'}
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filtered.map((dev: any, idx: number) => {
                    const isApple = dev.vendor?.includes('Apple');
                    const isSamsung = dev.vendor?.includes('Samsung');
                    const isGoogle = dev.vendor?.includes('Google');
                    const isSony = dev.vendor?.includes('Sony');
                    const isIntel = dev.vendor?.includes('Intel');

                    const getVendorColor = () => {
                      if (isGoogle) return 'text-purple-400 border-purple-500/30 bg-purple-950/30';
                      if (isApple) return 'text-cyan-300 border-cyan-500/30 bg-cyan-950/30';
                      if (isSamsung) return 'text-blue-400 border-blue-500/30 bg-blue-950/30';
                      if (isSony) return 'text-indigo-400 border-indigo-500/30 bg-indigo-950/30';
                      if (isIntel) return 'text-emerald-400 border-emerald-500/30 bg-emerald-950/30';
                      if (dev.isRandomized) return 'text-amber-300 border-amber-500/30 bg-amber-950/30';
                      return 'text-slate-300 border-slate-700 bg-slate-900/40';
                    };

                    return (
                      <div
                        key={dev.ip || dev.mac || idx}
                        className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between gap-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5">
                            <div className={`p-2 rounded-lg border ${getVendorColor()}`}>
                              {isGoogle ? <Router className="w-4 h-4" /> :
                               (isApple || isSamsung || dev.isRandomized) ? <Smartphone className="w-4 h-4" /> :
                               isIntel ? <Laptop className="w-4 h-4" /> :
                               <Server className="w-4 h-4" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="text-xs font-bold text-white tracking-wide">{dev.vendor || 'Unknown Vendor'}</h4>
                                {dev.isRandomized && (
                                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                                    Private MAC
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5">{dev.type || 'Connected Client'}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-[10px] font-mono text-emerald-400 font-semibold">Active</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-2 border-t border-slate-800/80">
                          <div>
                            <span className="text-slate-500 block">IP ADDRESS</span>
                            <span className="text-slate-200 font-bold">{dev.ip}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">MAC ADDRESS</span>
                            <span className="text-slate-400 truncate block">{dev.mac || '—'}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

      </main>

      {/* Configuration & Provider Switcher Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-base">Mesh System Configuration</h3>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-white text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-4">
              {/* Provider Selection */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Mesh Hardware Provider
                </label>
                <select
                  value={settingsProvider}
                  onChange={(e) => setSettingsProvider(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500"
                >
                  <option value="auto">Auto-Detect System</option>
                  <option value="google_nest">Google Nest Wifi / Nest Wifi Pro (Direct API)</option>
                  <option value="generic">Universal / Generic Mesh (Any Brand)</option>
                  <option value="custom">Manual / Custom Nodes</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  You can change from Google Nest to another mesh system at any time without losing historical data.
                </p>
              </div>

              {/* Probe Interval */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Probing Frequency
                </label>
                <select
                  value={settingsInterval}
                  onChange={(e) => setSettingsInterval(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500"
                >
                  <option value={500}>High Frequency (500 ms) - Rapid Fault Detection</option>
                  <option value={1000}>Standard (1000 ms) - Recommended</option>
                  <option value={2000}>Low Overhead (2000 ms)</option>
                </select>
              </div>

              {/* Speedtest Automation */}
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Background Speedtest Automation
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={speedtestAutoHourly}
                    onChange={(e) => setSpeedtestAutoHourly(e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>Run speedtest automatically every 1 hour (Background)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={speedtestRunOnRescan}
                    onChange={(e) => setSpeedtestRunOnRescan(e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                  />
                  <span>Run speedtest whenever network rescan completes</span>
                </label>
              </div>

              {/* Custom Nodes input if custom selected */}
              {settingsProvider === 'custom' && (
                <div className="pt-2 border-t border-slate-800">
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Define Custom Node IPs
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="IP (e.g. 192.168.1.1)"
                      value={customIpInput}
                      onChange={(e) => setCustomIpInput(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                    <input
                      type="text"
                      placeholder="Name (e.g. Office AP)"
                      value={customNameInput}
                      onChange={(e) => setCustomNameInput(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                    />
                    <button
                      onClick={addCustomNode}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold"
                    >
                      Add
                    </button>
                  </div>

                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                    {customNodes.map((n, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded bg-slate-950 text-xs">
                        <span>{n.name} ({n.ip})</span>
                        <button onClick={() => removeCustomNode(i)} className="text-rose-400 hover:text-rose-300">
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-semibold text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition"
              >
                Apply & Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SPEEDTEST DETAILS & TELEMETRY MODAL */}
      {isSpeedtestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-lg p-6 bg-slate-900/95 border border-slate-800 shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Bandwidth & Speed Telemetry</h3>
                  <p className="text-xs text-slate-400">Edge network download, upload, and latency</p>
                </div>
              </div>
              <button
                onClick={() => setIsSpeedtestModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            {/* Live Metrics Showcase */}
            <div className="grid grid-cols-3 gap-3 my-5">
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
                <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider flex items-center gap-1">
                  <ArrowDown className="w-3 h-3" /> Download
                </span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-black text-white font-mono">
                    {speedtestState.lastResult?.downloadMbps !== undefined ? speedtestState.lastResult.downloadMbps : '—'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Mbps</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
                <span className="text-[10px] font-mono text-purple-400 uppercase tracking-wider flex items-center gap-1">
                  <ArrowUp className="w-3 h-3" /> Upload
                </span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-black text-white font-mono">
                    {speedtestState.lastResult?.uploadMbps !== undefined ? speedtestState.lastResult.uploadMbps : '—'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Mbps</span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
                <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                  <Activity className="w-3 h-3" /> Latency
                </span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-black text-white font-mono">
                    {speedtestState.lastResult?.pingMs !== undefined ? speedtestState.lastResult.pingMs : '—'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">ms</span>
                </div>
              </div>
            </div>

            {/* Test Status & Trigger */}
            <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-400 block font-mono">
                  {speedtestState.isRunning
                    ? ('Status: Running ' + speedtestState.currentStage + ' test in background...')
                    : speedtestState.lastResult
                      ? ('Last test: ' + new Date(speedtestState.lastResult.timestamp).toLocaleTimeString())
                      : 'No recent test data'}
                </span>
                <span className="text-[10px] text-slate-500">
                  {speedtestAutoHourly ? 'Automated hourly testing active' : 'Automated testing paused'}
                </span>
              </div>
              <button
                onClick={runSpeedtest}
                disabled={speedtestState.isRunning}
                className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition flex items-center gap-1.5"
              >
                <Zap className={"w-3.5 h-3.5 " + (speedtestState.isRunning ? "animate-spin" : "")} />
                <span>{speedtestState.isRunning ? 'Testing...' : 'Test Bandwidth Now'}</span>
              </button>
            </div>

            {/* History List */}
            {speedtestState.history && speedtestState.history.length > 0 && (
              <div className="mt-4">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2 font-mono">
                  Recent Test Runs
                </span>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {speedtestState.history.slice(0, 8).map((run, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-lg bg-slate-950/50 border border-slate-800/80 flex items-center justify-between text-xs font-mono"
                    >
                      <span className="text-slate-400 text-[11px]">
                        {new Date(run.timestamp).toLocaleTimeString()}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-cyan-400 font-bold">{run.downloadMbps} ↓</span>
                        <span className="text-purple-400 font-bold">{run.uploadMbps} ↑</span>
                        <span className="text-slate-300">{run.pingMs}ms</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setIsSpeedtestModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
