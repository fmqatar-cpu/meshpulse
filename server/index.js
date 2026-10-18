const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const configManager = require('./services/ConfigManager');
const wifiScanner = require('./services/WifiScanner');
const networkProber = require('./services/NetworkProber');
const diagnosisEngine = require('./services/DiagnosisEngine');
const providerFactory = require('./providers/ProviderFactory');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// State
let currentWifiInfo = null;
let currentTopology = null;
let currentLinkStats = {};
let currentDiagnosis = { overallStatus: 'INITIALIZING', issues: [], incidents: [] };
let isScanningTopology = false;

// WebSocket Clients
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  // Send immediate state snapshot
  ws.send(JSON.stringify({
    type: 'SNAPSHOT',
    data: getFullSnapshot()
  }));

  ws.on('close', () => clients.delete(ws));
});

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

function getFullSnapshot() {
  return {
    timestamp: Date.now(),
    activeProvider: {
      id: providerFactory.activeProvider?.id || 'auto',
      name: providerFactory.activeProvider?.name || 'Auto',
      description: providerFactory.activeProvider?.description || ''
    },
    wifi: currentWifiInfo,
    topology: currentTopology,
    links: currentLinkStats,
    diagnosis: currentDiagnosis,
    config: configManager.get()
  };
}

// Topology Refresh Logic
async function refreshTopology() {
  if (isScanningTopology) return;
  isScanningTopology = true;
  try {
    const wifiData = await wifiScanner.scan();
    currentWifiInfo = wifiData.current;
    currentWifiInfo.meshBssids = wifiData.meshBssids;

    const provider = await providerFactory.resolveActiveProvider(currentWifiInfo);
    currentTopology = await provider.discoverTopology(currentWifiInfo);
  } catch (err) {
    console.error('Topology discovery error:', err);
  } finally {
    isScanningTopology = false;
  }
}

// Continuous Probing Loop
async function tickProbing() {
  if (!currentTopology || !currentTopology.probeTargets) return;

  const targets = currentTopology.probeTargets;
  const probePromises = targets.map(t => networkProber.probeTarget(t));
  const results = await Promise.all(probePromises);

  const statsMap = {};
  for (const res of results) {
    statsMap[res.targetId] = res;
  }
  currentLinkStats = statsMap;

  // Run Diagnosis
  currentDiagnosis = diagnosisEngine.evaluate(
    currentTopology,
    currentLinkStats,
    currentWifiInfo,
    configManager.get().thresholds
  );

  // Broadcast update to all connected UI clients
  broadcast({
    type: 'TELEMETRY_UPDATE',
    data: {
      timestamp: Date.now(),
      links: currentLinkStats,
      wifi: currentWifiInfo,
      diagnosis: currentDiagnosis
    }
  });
}

// Background scheduler
let probeIntervalHandle = null;
let scanCounter = 0;

async function startEngine() {
  console.log('Starting Mesh Link Monitor engine...');
  await refreshTopology();
  await tickProbing();

  const config = configManager.get();
  const intervalMs = config.pingIntervalMs || 1000;

  probeIntervalHandle = setInterval(async () => {
    scanCounter++;
    // Rescan Wi-Fi & topology every 15 seconds or if topology is empty
    if (scanCounter % 15 === 0 || !currentTopology) {
      refreshTopology().catch(console.error);
    }
    await tickProbing().catch(console.error);
  }, intervalMs);
}

// REST API
app.get('/api/status', (req, res) => {
  res.json(getFullSnapshot());
});

app.get('/api/providers', (req, res) => {
  res.json({
    active: providerFactory.activeProvider?.id,
    selected: configManager.get().selectedProvider,
    available: providerFactory.getAll()
  });
});

app.post('/api/provider', async (req, res) => {
  const { providerId } = req.body;
  if (!providerId) {
    return res.status(400).json({ error: 'providerId is required' });
  }

  configManager.update({ selectedProvider: providerId });
  await refreshTopology();
  await tickProbing();

  broadcast({
    type: 'TOPOLOGY_UPDATE',
    data: getFullSnapshot()
  });

  res.json({
    success: true,
    activeProvider: providerFactory.activeProvider?.id
  });
});

app.get('/api/config', (req, res) => {
  res.json(configManager.get());
});

app.post('/api/config', (req, res) => {
  const updated = configManager.update(req.body);
  res.json(updated);
});

app.post('/api/rescan', async (req, res) => {
  await refreshTopology();
  await tickProbing();
  broadcast({
    type: 'TOPOLOGY_UPDATE',
    data: getFullSnapshot()
  });
  res.json({ success: true, message: 'Rescan completed' });
});

// Serve frontend client dist if built
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

app.get('*', (req, res) => {
  const indexHtml = path.join(clientDist, 'index.html');
  if (require('fs').existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.send('Mesh Link Monitor API Server is running. UI is building in client/dist...');
  }
});

const PORT = process.env.PORT || 3030;
server.listen(PORT, () => {
  console.log(`Mesh Link Monitor backend running at http://localhost:${PORT}`);
  startEngine().catch(console.error);
});
