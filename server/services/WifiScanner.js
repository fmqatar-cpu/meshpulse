const { exec } = require('child_process');

function execCommand(cmd, timeoutMs = 4000) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      if (err) resolve('');
      else resolve(stdout || '');
    });
  });
}

class WifiScanner {
  async getInterfaceInfo() {
    const stdout = await execCommand('netsh wlan show interfaces');
    if (!stdout) {
      return {
        connected: false,
        error: 'No Wi-Fi interface detected or command failed'
      };
    }

    const info = {
      connected: false,
      interfaceName: '',
      description: '',
      ssid: '',
      bssid: '',
      radioType: '',
      band: '',
      channel: null,
      signal: 0,
      rssi: null,
      rxRate: null,
      txRate: null
    };

    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([^:]+)\s*:\s*(.+)$/);
      if (!match) continue;
      const key = match[1].trim().toLowerCase();
      const val = match[2].trim();

      if (key === 'name') info.interfaceName = val;
      else if (key === 'description') info.description = val;
      else if (key === 'state') info.connected = val.toLowerCase() === 'connected';
      else if (key === 'ssid') info.ssid = val;
      else if (key === 'ap bssid' || key === 'bssid') info.bssid = val.toLowerCase();
      else if (key === 'radio type') info.radioType = val;
      else if (key === 'band') info.band = val;
      else if (key === 'channel') info.channel = parseInt(val, 10) || null;
      else if (key === 'signal') info.signal = parseInt(val.replace('%', ''), 10) || 0;
      else if (key === 'rssi') info.rssi = parseInt(val, 10) || null;
      else if (key === 'receive rate (mbps)') info.rxRate = parseFloat(val) || null;
      else if (key === 'transmit rate (mbps)') info.txRate = parseFloat(val) || null;
    }

    // If RSSI is missing from netsh on some Windows versions, approximate it from Signal percentage:
    // RSSI ~= (Signal / 2) - 100
    if (info.rssi === null && info.signal > 0) {
      info.rssi = Math.round((info.signal / 2) - 100);
    }

    return info;
  }

  async getVisibleBSSIDs(filterSsid = null) {
    const stdout = await execCommand('netsh wlan show networks mode=bssid');
    if (!stdout) return [];

    const networks = [];
    let currentSsid = '';
    let currentBssid = null;

    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      const ssidMatch = line.match(/^SSID\s+\d+\s*:\s*(.*)$/);
      if (ssidMatch) {
        currentSsid = ssidMatch[1].trim();
        continue;
      }

      const bssidMatch = line.match(/^\s*BSSID\s+\d+\s*:\s*([0-9a-fA-F:-]+)/);
      if (bssidMatch) {
        if (currentBssid) {
          networks.push(currentBssid);
        }
        currentBssid = {
          ssid: currentSsid,
          bssid: bssidMatch[1].toLowerCase().replace(/-/g, ':'),
          signal: 0,
          rssi: null,
          channel: null,
          band: '',
          radioType: ''
        };
        continue;
      }

      if (currentBssid) {
        const propMatch = line.match(/^\s*([^:]+)\s*:\s*(.+)$/);
        if (propMatch) {
          const k = propMatch[1].trim().toLowerCase();
          const v = propMatch[2].trim();
          if (k === 'signal') {
            const sig = parseInt(v.replace('%', ''), 10) || 0;
            currentBssid.signal = sig;
            currentBssid.rssi = Math.round((sig / 2) - 100);
          } else if (k === 'channel') {
            currentBssid.channel = parseInt(v, 10) || null;
          } else if (k === 'band') {
            currentBssid.band = v;
          } else if (k === 'radio type') {
            currentBssid.radioType = v;
          }
        }
      }
    }

    if (currentBssid) {
      networks.push(currentBssid);
    }

    if (filterSsid) {
      return networks.filter(n => n.ssid.toLowerCase() === filterSsid.toLowerCase());
    }

    return networks;
  }

  async scan() {
    const iface = await this.getInterfaceInfo();
    let visible = [];
    if (iface.ssid) {
      visible = await this.getVisibleBSSIDs(iface.ssid);
    }
    return {
      current: iface,
      meshBssids: visible
    };
  }
}

module.exports = new WifiScanner();
