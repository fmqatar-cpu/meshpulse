const { exec } = require('child_process');
const http = require('http');

class TargetHistory {
  constructor(maxSize = 60) {
    this.maxSize = maxSize;
    this.samples = []; // { timestamp, latency, success }
  }

  addSample(latency, success) {
    const now = Date.now();
    this.samples.push({ timestamp: now, latency, success });
    if (this.samples.length > this.maxSize) {
      this.samples.shift();
    }
  }

  getStats(windowCount = 20) {
    const recent = this.samples.slice(-windowCount);
    if (recent.length === 0) {
      return {
        current: null,
        min: null,
        max: null,
        avg: null,
        jitter: null,
        lossPct: 0,
        samplesCount: 0
      };
    }

    const successes = recent.filter(s => s.success && s.latency !== null);
    const lost = recent.length - successes.length;
    const lossPct = Math.round((lost / recent.length) * 100);

    if (successes.length === 0) {
      return {
        current: null,
        min: null,
        max: null,
        avg: null,
        jitter: null,
        lossPct: 100,
        samplesCount: recent.length
      };
    }

    const latencies = successes.map(s => s.latency);
    const current = latencies[latencies.length - 1];
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const sum = latencies.reduce((acc, v) => acc + v, 0);
    const avg = Math.round((sum / latencies.length) * 10) / 10;

    // Jitter: average absolute difference between consecutive samples
    let jitterSum = 0;
    let jitterCount = 0;
    for (let i = 1; i < latencies.length; i++) {
      jitterSum += Math.abs(latencies[i] - latencies[i - 1]);
      jitterCount++;
    }
    const jitter = jitterCount > 0 ? Math.round((jitterSum / jitterCount) * 10) / 10 : 0;

    return {
      current,
      min,
      max,
      avg,
      jitter,
      lossPct,
      samplesCount: recent.length,
      history: this.samples.map(s => ({
        t: s.timestamp,
        ms: s.success ? s.latency : null
      }))
    };
  }
}

class NetworkProber {
  constructor() {
    this.targets = new Map(); // id -> TargetHistory
  }

  getOrCreateHistory(targetId, maxSize = 60) {
    if (!this.targets.has(targetId)) {
      this.targets.set(targetId, new TargetHistory(maxSize));
    }
    return this.targets.get(targetId);
  }

  async pingIcmp(host, timeoutMs = 800) {
    return new Promise((resolve) => {
      const start = process.hrtime.bigint();
      // On Windows: ping -n 1 -w <timeout_ms> <host>
      exec(`ping -n 1 -w ${timeoutMs} ${host}`, { windowsHide: true, timeout: timeoutMs + 200 }, (err, stdout) => {
        if (err || !stdout) {
          return resolve({ success: false, latency: null });
        }

        // Match "time=Xms" or "time<1ms"
        const timeMatch = stdout.match(/time(?:=|<)(\d+)ms/i);
        if (timeMatch) {
          const latency = parseInt(timeMatch[1], 10);
          return resolve({ success: true, latency });
        }

        if (stdout.includes('time<1ms')) {
          return resolve({ success: true, latency: 0.5 });
        }

        resolve({ success: false, latency: null });
      });
    });
  }

  async probeHttp(url, timeoutMs = 800) {
    return new Promise((resolve) => {
      const start = process.hrtime.bigint();
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          const end = process.hrtime.bigint();
          const latency = Number((end - start) / 1000000n);
          resolve({ success: true, latency });
        });
      });

      req.on('error', () => resolve({ success: false, latency: null }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, latency: null });
      });
    });
  }

  async probeTarget(target) {
    // target: { id, host, probeType: 'icmp' | 'http', url?: string }
    const history = this.getOrCreateHistory(target.id);
    let res;

    if (target.probeType === 'http' && target.url) {
      res = await this.probeHttp(target.url);
    } else {
      res = await this.pingIcmp(target.host);
    }

    history.addSample(res.latency, res.success);
    const stats = history.getStats();

    return {
      targetId: target.id,
      host: target.host,
      ...stats
    };
  }

  getStatsFor(targetId) {
    const history = this.targets.get(targetId);
    return history ? history.getStats() : null;
  }

  clear() {
    this.targets.clear();
  }
}

module.exports = new NetworkProber();
