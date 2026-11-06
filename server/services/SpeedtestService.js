const https = require('https');
const http = require('http');

class SpeedtestService {
  constructor() {
    this.isRunning = false;
    this.currentStage = 'idle'; // 'download', 'upload', 'idle'
    this.lastResult = null;
    this.history = []; // last 30 tests
    this.maxHistory = 30;
    this.listeners = new Set();
  }

  onUpdate(fn) {
    this.listeners.add(fn);
  }

  notify(event, data) {
    for (const fn of this.listeners) {
      try { fn(event, data); } catch (e) {}
    }
  }

  getLastResult() {
    return this.lastResult;
  }

  getHistory() {
    return this.history;
  }

  getState() {
    return {
      isRunning: this.isRunning,
      currentStage: this.currentStage,
      lastResult: this.lastResult,
      history: this.history
    };
  }

  // Non-blocking background speedtest
  async run() {
    if (this.isRunning) {
      return this.getState();
    }

    this.isRunning = true;
    this.currentStage = 'download';
    this.notify('START', { stage: 'download' });

    try {
      // 1. Download Test (10 MB stream)
      const downloadResult = await this.testDownload(10 * 1024 * 1024);

      // 2. Upload Test (2 MB)
      this.currentStage = 'upload';
      this.notify('STAGE_CHANGE', { stage: 'upload' });
      const uploadResult = await this.testUpload(2 * 1024 * 1024);

      const result = {
        timestamp: Date.now(),
        downloadMbps: downloadResult.mbps,
        uploadMbps: uploadResult.mbps,
        pingMs: downloadResult.latencyMs,
        bytesDownloaded: downloadResult.bytes,
        bytesUploaded: uploadResult.bytes
      };

      this.lastResult = result;
      this.history.unshift(result);
      if (this.history.length > this.maxHistory) {
        this.history.pop();
      }

      this.currentStage = 'idle';
      this.isRunning = false;
      this.notify('COMPLETE', result);
      return result;
    } catch (err) {
      console.error('Speedtest error:', err.message);
      this.currentStage = 'idle';
      this.isRunning = false;
      this.notify('ERROR', { error: err.message });
      return null;
    }
  }

  testDownload(bytes) {
    return new Promise((resolve, reject) => {
      const url = `https://speed.cloudflare.com/__down?bytes=${bytes}`;
      const startLatency = Date.now();
      let firstByteTime = null;
      let totalBytes = 0;

      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MeshPulse/1.0'
        },
        timeout: 12000
      }, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }

        res.on('data', (chunk) => {
          if (!firstByteTime) firstByteTime = Date.now();
          totalBytes += chunk.length;
        });

        res.on('end', () => {
          const endTime = Date.now();
          const transferTimeSec = Math.max((endTime - (firstByteTime || startLatency)) / 1000, 0.05);
          const latencyMs = firstByteTime ? (firstByteTime - startLatency) : (endTime - startLatency);
          const mbps = Math.round(((totalBytes * 8) / (transferTimeSec * 1000000)) * 10) / 10;
          resolve({ mbps, latencyMs, bytes: totalBytes });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download speedtest timed out'));
      });

      req.on('error', reject);
    });
  }

  testUpload(bytes) {
    return new Promise((resolve, reject) => {
      const payload = Buffer.alloc(bytes, 0);
      const startTime = Date.now();

      const req = https.request('https://speed.cloudflare.com/__up', {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MeshPulse/1.0',
          'Content-Type': 'application/octet-stream',
          'Content-Length': bytes
        },
        timeout: 12000
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          const durationSec = Math.max((Date.now() - startTime) / 1000, 0.05);
          const mbps = Math.round(((bytes * 8) / (durationSec * 1000000)) * 10) / 10;
          resolve({ mbps, bytes });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Upload speedtest timed out'));
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

module.exports = new SpeedtestService();
