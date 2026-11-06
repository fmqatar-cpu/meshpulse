const { exec } = require('child_process');

const OUI_DATABASE = {
  // Google / Nest
  'fc:91:5d': { vendor: 'Google', type: 'Nest Wifi Pro Mesh' },
  '58:70:c6': { vendor: 'Google', type: 'Nest / Home Speaker' },
  'bc:35:1e': { vendor: 'Google', type: 'Nest Hub / Smart Display' },
  '38:2c:e5': { vendor: 'Google', type: 'Nest / Chromecast' },
  '18:b4:30': { vendor: 'Google Nest', type: 'Nest Thermostat / Cam' },
  '64:16:66': { vendor: 'Google Nest', type: 'Nest Cam / Doorbell' },
  'd4:f5:47': { vendor: 'Google', type: 'Pixel / Home Device' },
  '3c:5a:37': { vendor: 'Google', type: 'Chromecast with Google TV' },

  // Apple
  'f8:17:2d': { vendor: 'Apple', type: 'iPhone / Mac / iPad' },
  '98:ed:5c': { vendor: 'Apple', type: 'iPhone / Mac / iPad' },
  '84:7a:b6': { vendor: 'Apple', type: 'Apple Device' },
  'b4:b8:53': { vendor: 'Apple', type: 'Apple Device' },
  '74:f9:ca': { vendor: 'Apple', type: 'Apple Device' },
  'c0:f8:53': { vendor: 'Apple', type: 'Apple Device' },
  '14:7d:da': { vendor: 'Apple', type: 'iPhone / iPad' },
  '28:6a:ba': { vendor: 'Apple', type: 'MacBook / Mac Studio' },
  '3c:06:30': { vendor: 'Apple', type: 'Apple Watch / HomePod' },
  'a4:83:e7': { vendor: 'Apple', type: 'Apple TV' },

  // Samsung
  '90:ca:fa': { vendor: 'Samsung', type: 'Galaxy / Smart TV' },
  '54:60:09': { vendor: 'Samsung', type: 'Galaxy / Smart TV' },
  '20:1f:3b': { vendor: 'Samsung', type: 'Galaxy / Smart TV' },
  '18:de:50': { vendor: 'Samsung', type: 'Smart Appliance / TV' },
  '48:44:f7': { vendor: 'Samsung', type: 'Galaxy Device' },
  'dc:71:44': { vendor: 'Samsung', type: 'Galaxy Smartphone' },

  // Sony
  '20:f1:b2': { vendor: 'Sony', type: 'PlayStation / Bravia' },
  '38:1f:8d': { vendor: 'Sony', type: 'PlayStation 5 / Audio' },
  '00:23:24': { vendor: 'Sony', type: 'PlayStation Network' },

  // Intel / Microsoft / PC
  '1c:53:f9': { vendor: 'Intel', type: 'PC Wi-Fi Adapter' },
  'd8:1f:12': { vendor: 'Intel', type: 'PC Wi-Fi Adapter' },
  '00:15:5d': { vendor: 'Microsoft', type: 'Windows / Surface' },
  'b4:43:0d': { vendor: 'Microsoft', type: 'Xbox Series X/S' },
  'ec:24:b8': { vendor: 'Dell', type: 'Dell Laptop / Desktop' },
  '3c:52:82': { vendor: 'HP', type: 'HP Laptop / Printer' },

  // Amazon
  '34:2e:b7': { vendor: 'Amazon', type: 'Echo / Fire TV' },
  '68:54:5a': { vendor: 'Amazon', type: 'Echo / Fire TV' },
  'd0:53:49': { vendor: 'Amazon', type: 'Echo / Fire TV' },
  '44:65:0d': { vendor: 'Amazon', type: 'Kindle / Tablet' },
  '78:e1:03': { vendor: 'Amazon', type: 'Echo Dot / Show' },

  // Smart Home / IoT
  'b0:be:76': { vendor: 'TP-Link', type: 'Kasa / Tapo Smart Plug' },
  '50:ec:50': { vendor: 'Tuya Smart', type: 'Smart Home / Light Strip' },
  '60:a4:4c': { vendor: 'Tuya Smart', type: 'Smart Switch / Sensor' },
  '00:17:88': { vendor: 'Philips Hue', type: 'Hue Bridge / Lights' },
  'd8:31:34': { vendor: 'Roku', type: 'Roku Streaming Player' },
  'b8:27:eb': { vendor: 'Raspberry Pi', type: 'Pi Single Board PC' },
  'dc:a6:32': { vendor: 'Raspberry Pi', type: 'Raspberry Pi 4/5' },
  '8c:85:90': { vendor: 'Nintendo', type: 'Nintendo Switch' },
  '64:90:c1': { vendor: 'LG Electronics', type: 'webOS Smart TV' }
};

class DeviceScanner {
  constructor() {
    this.cachedDevices = [];
    this.lastScanTime = 0;
  }

  async scan(localIp = '192.168.86.56', gatewayIp = '192.168.86.1') {
    const now = Date.now();
    // Cache for 8 seconds
    if (this.cachedDevices.length > 0 && (now - this.lastScanTime) < 8000) {
      return this.cachedDevices;
    }

    const arpEntries = await this.readArpTable();
    const devices = [];

    for (const entry of arpEntries) {
      const { ip, mac } = entry;
      const oui = mac.slice(0, 8);
      const firstByte = parseInt(mac.slice(0, 2), 16) || 0;
      const isRandomized = (firstByte & 0x02) !== 0;

      let vendor = 'Generic Network Device';
      let type = 'Connected Client';

      if (OUI_DATABASE[oui]) {
        vendor = OUI_DATABASE[oui].vendor;
        type = OUI_DATABASE[oui].type;
      } else if (isRandomized) {
        vendor = 'Private Wi-Fi Client';
        type = 'Smartphone / Tablet (Private MAC)';
      }

      const isRouter = (ip === gatewayIp);
      const isThisDevice = (ip === localIp);

      if (isRouter) {
        type = 'Main Mesh Router';
      } else if (isThisDevice) {
        type = 'Host PC (This System)';
      }

      devices.push({
        ip,
        mac,
        vendor,
        type,
        isRandomized,
        isRouter,
        isThisDevice,
        status: 'online',
        lastSeen: now
      });
    }

    // Sort: Router first, then This Device, then by IP
    devices.sort((a, b) => {
      if (a.isRouter) return -1;
      if (b.isRouter) return 1;
      if (a.isThisDevice) return -1;
      if (b.isThisDevice) return 1;
      const aNum = a.ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0);
      const bNum = b.ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0);
      return aNum - bNum;
    });

    this.cachedDevices = devices;
    this.lastScanTime = now;
    return devices;
  }

  readArpTable() {
    return new Promise((resolve) => {
      exec('arp -a', { windowsHide: true, timeout: 3000 }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const lines = stdout.split(/\r?\n/);
        const map = new Map();

        for (const line of lines) {
          const match = line.match(/^\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\s+([0-9a-fA-F-]+)/);
          if (match) {
            const ip = match[1];
            const mac = match[2].toLowerCase().replace(/-/g, ':');
            if (
              !ip.endsWith('.255') &&
              !ip.endsWith('.0') &&
              !ip.startsWith('224.') &&
              !ip.startsWith('239.') &&
              mac !== 'ff:ff:ff:ff:ff:ff'
            ) {
              map.set(ip, { ip, mac });
            }
          }
        }
        resolve(Array.from(map.values()));
      });
    });
  }
}

module.exports = new DeviceScanner();
