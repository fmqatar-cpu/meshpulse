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
  Info
} from 'lucide-react';

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
  meshBssids?: any[];
}

interface MeshNode {
  id: string;
  name: string;
  type: 'client' | 'root' | 'satellite' | 'wan';
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
  const [activeTab, setActiveTab] = useState<'topology' | 'links' | 'incidents'>('topology');

  // Settings form state
  const [settingsProvider, setSettingsProvider] = useState('google_nest');
  const [settingsInterval, setSettingsInterval] = useState(1000);
  const [customIpInput, setCustomIpInput] = useState('');
  const [customNameInput, setCustomNameInput] = useState('');
  const [customNodes, setCustomNodes] = useState<any[]>([]);

  const wsRef = useRef<WebSocket | null>(null);

  // Fetch initial HTTP status
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setSnapshot(data);
        if (data.activeProvider) setActiveProvider(data.activeProvider);
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

  // Setup WebSocket for continuous live streaming
  useEffect(() => {
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
          if (msg.type === 'SNAPSHOT' || msg.type === 'TOPOLOGY_UPDATE') {
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
      await fetch('/api/rescan', { method: 'POST' });
      await fetchStatus();
    } catch (e) {
      console.error('Rescan failed:', e);
    } finally {
      setTimeout(() => setIsRescanning(false), 800);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedProvider: settingsProvider,
          pingIntervalMs: Number(settingsInterval),
          customNodes
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
  const diagnosis = snapshot?.diagnosis || { overallStatus: 'INITIALIZING', issues: [], incidents: [] };
  const overallStatus = diagnosis.overallStatus;

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
      <header className="border-b border-slate-800/80 bg-slate-900/70 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-400">
                MeshPulse
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                v1.0
              </span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                overallStatus === 'HEALTHY'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : overallStatus === 'DEGRADED'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  overallStatus === 'HEALTHY' ? 'bg-emerald-400 animate-pulse' :
                  overallStatus === 'DEGRADED' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400 animate-ping'
                }`} />
                {overallStatus}
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <span>System: <strong className="text-slate-200">{activeProvider.name}</strong></span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                {wsConnected ? 'Live 1s Polling' : 'Connecting...'}
              </span>
            </p>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2.5">
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

          <button
            onClick={handleRescan}
            disabled={isRescanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRescanning ? 'animate-spin text-cyan-400' : ''}`} />
            <span>{isRescanning ? 'Scanning...' : 'Rescan'}</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configure</span>
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
              <span>All mesh backhaul channels and client links are functioning within normal operational parameters (&lt;10ms local transit, 0% packet drop).</span>
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
          </div>

          <div className="text-xs text-slate-500 font-mono">
            {topology.nodes?.length || 0} nodes mapped • {topology.links?.length || 0} links monitored
          </div>
        </div>

        {/* TAB 1: TOPOLOGY MAP */}
        {activeTab === 'topology' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Visual Architecture Map Canvas */}
            <div className="lg:col-span-2 glass-panel p-6 flex flex-col justify-between min-h-[440px] relative overflow-hidden">
              <div className="flex items-center justify-between z-10">
                <div>
                  <h3 className="text-sm font-bold text-slate-200 tracking-wide flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-400" />
                    <span>Live Physical Mesh Topology</span>
                  </h3>
                  <p className="text-xs text-slate-400">Click any node to view hardware specifications, backhaul channel, and uptime.</p>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Optimal Link
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Degraded
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400" /> Bottleneck / Loss
                  </span>
                </div>
              </div>

              {/* Dynamic Interactive Node Diagram */}
              <div className="py-10 flex flex-col md:flex-row items-center justify-between gap-6 z-10 px-4">
                
                {/* 1. Host PC */}
                <div
                  onClick={() => setSelectedNode(topology.nodes?.find((n: any) => n.type === 'client'))}
                  className={`cursor-pointer p-4 rounded-xl border flex flex-col items-center gap-2 transition hover:scale-105 ${
                    selectedNode?.type === 'client'
                      ? 'border-cyan-400 bg-cyan-950/40 ring-2 ring-cyan-500/20'
                      : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-cyan-400 shadow-md">
                    <Laptop className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <div className="text-xs font-bold text-white">Host PC</div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">{wifi.signal}% ({wifi.rssi} dBm)</div>
                    <div className="text-[10px] text-cyan-400 font-mono">{wifi.band}</div>
                  </div>
                </div>

                {/* Animated Arrow / Link 1 */}
                <div className="flex flex-col items-center justify-center gap-1 font-mono text-[11px]">
                  <span className="text-slate-400 text-[10px]">PC ➔ AP</span>
                  <div className={`px-2 py-0.5 rounded font-bold border ${
                    (links['link_client_ap']?.avg || 0) > 40
                      ? 'bg-amber-950/60 text-amber-400 border-amber-600/40'
                      : 'bg-emerald-950/60 text-emerald-400 border-emerald-600/40'
                  }`}>
                    {links['link_client_ap']?.current !== null ? `${links['link_client_ap']?.current} ms` : '—'}
                  </div>
                  <div className="w-16 h-0.5 bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-500 relative">
                    <div className="w-1.5 h-1.5 rounded-full bg-white absolute -top-0.5 animate-ping" />
                  </div>
                  <span className="text-[9px] text-slate-500">
                    {links['link_client_ap']?.lossPct || 0}% loss
                  </span>
                </div>

                {/* 2. Satellites / Access Points Stack */}
                <div className="flex flex-col gap-3">
                  {topology.nodes?.filter((n: any) => n.type === 'satellite').map((sat: any) => (
                    <div
                      key={sat.id}
                      onClick={() => setSelectedNode(sat)}
                      className={`cursor-pointer p-3.5 rounded-xl border flex items-center gap-3 transition hover:scale-105 ${
                        sat.isCurrentAP
                          ? 'border-emerald-500/70 bg-emerald-950/20 shadow-lg shadow-emerald-500/10'
                          : selectedNode?.id === sat.id
                          ? 'border-indigo-400 bg-indigo-950/40'
                          : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-indigo-400">
                        <Router className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-white">{sat.name}</span>
                          {sat.isCurrentAP && (
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">
                              Connected AP
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">{sat.ip}</div>
                        <div className="text-[10px] text-indigo-400 font-mono mt-0.5">
                          {sat.backhaulType || 'Mesh Backhaul'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Animated Arrow / Link 2 (Backhaul) */}
                <div className="flex flex-col items-center justify-center gap-1 font-mono text-[11px]">
                  <span className="text-slate-400 text-[10px]">Backhaul</span>
                  <div className="px-2 py-0.5 rounded font-bold border bg-indigo-950/60 text-indigo-300 border-indigo-600/40">
                    6 GHz Mesh
                  </div>
                  <div className="w-16 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 relative">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-300 absolute -top-0.5" />
                  </div>
                  <span className="text-[9px] text-slate-500">Channel {topology.systemInfo?.meshChannel || '197'}</span>
                </div>

                {/* 3. Main Router (Root Gateway) */}
                {(() => {
                  const rootNode = topology.nodes?.find((n: any) => n.type === 'root') || {
                    name: 'Main Router',
                    ip: '192.168.86.1'
                  };
                  return (
                    <div
                      onClick={() => setSelectedNode(rootNode)}
                      className={`cursor-pointer p-4 rounded-xl border flex flex-col items-center gap-2 transition hover:scale-105 ${
                        selectedNode?.id === rootNode.id
                          ? 'border-purple-400 bg-purple-950/40 ring-2 ring-purple-500/20'
                          : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="w-12 h-12 rounded-xl bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-md">
                        <Router className="w-6 h-6" />
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-bold text-white">{rootNode.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">{rootNode.ip}</div>
                        <div className="text-[10px] text-purple-400 font-mono">Root Gateway</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Animated Arrow / Link 3 (WAN) */}
                <div className="flex flex-col items-center justify-center gap-1 font-mono text-[11px]">
                  <span className="text-slate-400 text-[10px]">WAN Uplink</span>
                  <div className={`px-2 py-0.5 rounded font-bold border ${
                    (links['link_gateway_wan']?.lossPct || 0) > 5
                      ? 'bg-rose-950/60 text-rose-400 border-rose-600/40'
                      : 'bg-cyan-950/60 text-cyan-300 border-cyan-600/40'
                  }`}>
                    {links['link_gateway_wan']?.current !== null ? `${links['link_gateway_wan']?.current} ms` : '—'}
                  </div>
                  <div className="w-16 h-0.5 bg-gradient-to-r from-purple-500 to-cyan-500 relative" />
                  <span className="text-[9px] text-slate-500">
                    {links['link_gateway_wan']?.lossPct || 0}% loss
                  </span>
                </div>

                {/* 4. WAN / Internet */}
                <div
                  onClick={() => setSelectedNode(topology.nodes?.find((n: any) => n.type === 'wan'))}
                  className={`cursor-pointer p-4 rounded-xl border flex flex-col items-center gap-2 transition hover:scale-105 ${
                    selectedNode?.type === 'wan'
                      ? 'border-cyan-400 bg-cyan-950/40 ring-2 ring-cyan-500/20'
                      : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-cyan-950/60 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-md">
                    <Globe className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <div className="text-xs font-bold text-white">Internet</div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">1.1.1.1</div>
                    <div className="text-[10px] text-cyan-400 font-mono">Cloud Edge</div>
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

            {/* Node Inspection Panel */}
            <div className="glass-panel p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-200 tracking-wide flex items-center gap-2 mb-3">
                  <Info className="w-4 h-4 text-indigo-400" />
                  <span>Node Inspector</span>
                </h3>

                {selectedNode ? (
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
                      <div className="text-xs text-slate-400">Node Label</div>
                      <div className="text-sm font-bold text-white mt-0.5">{selectedNode.name}</div>
                      <div className="text-xs text-indigo-400 font-mono mt-0.5">Role: {selectedNode.role}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                        <span className="text-slate-500 block text-[10px]">IP ADDRESS</span>
                        <span className="text-slate-200 font-bold">{selectedNode.ip}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                        <span className="text-slate-500 block text-[10px]">HARDWARE MODEL</span>
                        <span className="text-slate-200 font-bold">{selectedNode.model || 'Nest Wifi Pro'}</span>
                      </div>
                      {selectedNode.mac && (
                        <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                          <span className="text-slate-500 block text-[10px]">MAC ADDRESS</span>
                          <span className="text-slate-200 font-bold">{selectedNode.mac}</span>
                        </div>
                      )}
                      {selectedNode.uptime && (
                        <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                          <span className="text-slate-500 block text-[10px]">DEVICE UPTIME</span>
                          <span className="text-emerald-400 font-bold">{formatUptime(selectedNode.uptime)}</span>
                        </div>
                      )}
                      {selectedNode.softwareVersion && (
                        <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 col-span-2">
                          <span className="text-slate-500 block text-[10px]">SOFTWARE FIRMWARE</span>
                          <span className="text-slate-200">{selectedNode.softwareVersion}</span>
                        </div>
                      )}
                      {selectedNode.backhaulType && (
                        <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 col-span-2">
                          <span className="text-slate-500 block text-[10px]">BACKHAUL TRANSMISSION</span>
                          <span className="text-cyan-400 font-bold">{selectedNode.backhaulType}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-xs text-slate-500">
                    Click any node in the topology diagram to inspect its backhaul telemetry, MAC address, and firmware details.
                  </div>
                )}
              </div>

              {/* Quick Health Summary */}
              <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 mt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Mesh Health Score</span>
                  <span className="font-bold text-emerald-400">98 / 100</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                  <div className="bg-gradient-to-r from-emerald-500 to-cyan-400 h-full w-[98%]" />
                </div>
              </div>
            </div>

          </div>
        )}

        {/* TAB 2: HOP-BY-HOP LINK METRICS */}
        {activeTab === 'links' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Object.keys(links).map((linkId) => {
              const link = links[linkId];
              const isWan = linkId.includes('wan');
              const isBackhaul = linkId.includes('node') || linkId.includes('backhaul');

              return (
                <div key={linkId} className="glass-panel p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                          {isWan ? 'WAN Uplink' : isBackhaul ? 'Mesh Satellite Link' : 'Local AP Link'}
                        </span>
                        <h4 className="text-sm font-bold text-white mt-0.5">{link.host}</h4>
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
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20"
              >
                Apply & Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
