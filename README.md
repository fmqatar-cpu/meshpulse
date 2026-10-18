# MeshPulse 🌐

**Continuous Mesh Network Architecture Discovery & Link-by-Link Diagnostic Engine**

MeshPulse is a PC application designed to sit on your computer, automatically discover the multi-node mesh network architecture of your home, and continuously test every hop link-by-link (Client ➔ Access Point ➔ Mesh Backhaul ➔ Root Gateway ➔ Internet WAN) in real time.

---

## Key Features

1. **Automatic Multi-Hop Mesh Discovery**:
   - **Native Google Nest Wifi & Nest Wifi Pro Engine**: Communicates directly with local node endpoints (`/api/v1/status`) to discover the primary router (`root`) and all satellite points (`leaf`), their hardware IDs, uptime, firmware, and backhaul channels (e.g. 6 GHz Wi-Fi 6E channel 197).
   - **BSSID & Radio Association**: Cross-references the PC's active Wi-Fi radio (`wlanapi.dll` / `netsh wlan`) to determine exactly which physical room satellite your PC is connected to.
   - **Pluggable & Extensible Provider Architecture**: Seamlessly switch between **Google Nest Wifi Pro**, **Universal / Generic Mesh (Any Brand)**, or **Custom Manual Nodes** via the configuration modal.

2. **Continuous Link-by-Link Testing Engine**:
   - High-frequency micro-probes (configurable: 500ms, 1000ms, 2000ms).
   - Monitors:
     - **Hop 1: Host PC ➔ Connected Access Point** (Signal RSSI, PHY Tx/Rx rate, local latency, packet drop)
     - **Hop 2: Satellite Node ➔ Root Gateway** (Wireless 6 GHz mesh backhaul transit time, backhaul packet loss)
     - **Hop 3: Root Gateway ➔ Internet (WAN)** (ISP uplink latency, DNS resolution, external packet loss)

3. **Differential Root-Cause Diagnosis**:
   - Distinguishes between internal Wi-Fi/mesh degradation vs. external ISP/cable modem outages.
   - Detects co-channel airtime interference, DFS radar channel switches, and weak satellite backhauls.
   - Maintains an active Incident History log with timestamps and resolution durations.

4. **Real-Time Interactive Dashboard**:
   - Modern React + Tailwind dark-mode UI with live WebSocket streaming.
   - Animated SVG topology diagram showing live pulsing links and hop-by-hop latency sparklines.

---

## Getting Started

### 1. Launch the Application
Run the start command from the project root:
```bash
npm start
```

Open your browser and navigate to:
```
http://localhost:3030
```

### 2. Switching Mesh Systems Later
To switch to a different mesh router brand in the future:
1. Click **Configure** in the top navigation bar.
2. Select:
   - **Google Nest Wifi Pro** (Automatic local diagnostic API)
   - **Universal / Generic Mesh** (RF beacon scanner + ARP differential probing — works on Asus, TP-Link Deco, Netgear Orbi, eero, etc.)
   - **Manual / Custom Nodes** (Manually specify node IPs and labels)
3. Click **Apply & Save Settings**. The network map will automatically re-index.
