class DiagnosisEngine {
  constructor() {
    this.incidents = [];
    this.maxIncidents = 50;
    // Issue debouncing map: issueId -> consecutiveTickCount
    this.issueCounters = new Map();
  }

  evaluate(topology, linkStats, wifiInfo, thresholds) {
    const candidateIssues = [];
    let overallStatus = 'HEALTHY'; // 'HEALTHY' | 'DEGRADED' | 'CRITICAL'

    // Effective thresholds with realistic minimums
    const warnLoss = Math.max(15, thresholds?.lossWarningPct || 15);
    const critLoss = Math.max(35, thresholds?.lossCriticalPct || 35);
    const warnLatency = Math.max(60, thresholds?.latencyWarningMs || 60);
    const critLatency = Math.max(150, thresholds?.latencyCriticalMs || 150);

    // 1. Check Wi-Fi Local Physical Layer
    if (wifiInfo && wifiInfo.connected) {
      if (wifiInfo.rssi && wifiInfo.rssi <= (thresholds.rssiCriticalDbm || -85)) {
        candidateIssues.push({
          id: 'WIFI_CRITICAL_RSSI',
          severity: 'CRITICAL',
          title: 'Critically Weak Wi-Fi Signal',
          description: `Device Wi-Fi signal is very weak at ${wifiInfo.rssi} dBm (${wifiInfo.signal}%). Expect intermittent throughput drops.`,
          recommendation: 'Move closer to the nearest access point or reposition the node.'
        });
        overallStatus = 'CRITICAL';
      } else if (wifiInfo.rssi && wifiInfo.rssi <= (thresholds.rssiWarningDbm || -75)) {
        candidateIssues.push({
          id: 'WIFI_LOW_RSSI',
          severity: 'WARNING',
          title: 'Suboptimal Wi-Fi Signal Strength',
          description: `Current RSSI is ${wifiInfo.rssi} dBm (${wifiInfo.signal}%). Signal is acceptable but may experience occasional latency variation.`,
          recommendation: 'Consider adjusting node placement or checking for thick walls.'
        });
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
      }
    } else if (wifiInfo && !wifiInfo.connected) {
      const discoIssue = {
        id: 'WIFI_DISCONNECTED',
        severity: 'CRITICAL',
        title: 'Wi-Fi Adapter Disconnected',
        description: 'The device Wi-Fi adapter is not currently connected to any network.',
        recommendation: 'Connect to your home mesh network SSID.'
      };
      this.recordIncidents([discoIssue]);
      return { overallStatus: 'CRITICAL', issues: [discoIssue], incidents: this.incidents };
    }

    // 2. Analyze Individual Link Metrics (with Warm-up guard)
    const pcToApStats = linkStats['link_client_ap'];
    const pcToGatewayStats = linkStats['link_client_gateway'];
    const routerToModemStats = linkStats['link_router_modem'];
    const gatewayToWanStats = linkStats['link_gateway_wan'];

    // Helper: is link warmed up?
    const isWarmedUp = (stats) => stats && (stats.samplesCount || 0) >= 8;

    // Check PC to AP Link
    if (isWarmedUp(pcToApStats)) {
      if (pcToApStats.lossPct >= critLoss) {
        candidateIssues.push({
          id: 'LINK_CLIENT_AP_PACKET_LOSS',
          severity: 'CRITICAL',
          title: 'High Packet Loss: Device to Access Point',
          description: `Wi-Fi link to your connected AP is experiencing sustained ${pcToApStats.lossPct}% packet loss.`,
          recommendation: 'Check for local 2.4/5GHz channel congestion, thick walls, or microwave interference.'
        });
        overallStatus = 'CRITICAL';
      } else if (pcToApStats.lossPct >= warnLoss) {
        candidateIssues.push({
          id: 'LINK_CLIENT_AP_MODERATE_LOSS',
          severity: 'WARNING',
          title: 'Moderate Wi-Fi Packet Loss',
          description: `Device to AP link is experiencing occasional packet loss (${pcToApStats.lossPct}%).`,
          recommendation: 'Check line-of-sight to the access point or roaming behavior.'
        });
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
      } else if (pcToApStats.avg >= warnLatency) {
        candidateIssues.push({
          id: 'LINK_CLIENT_AP_HIGH_LATENCY',
          severity: 'WARNING',
          title: 'Elevated Latency to Connected Node',
          description: `Average ping to the connected AP is ${pcToApStats.avg}ms (warning baseline: ${warnLatency}ms).`,
          recommendation: 'Check airtime usage, active heavy downloads, or background sync.'
        });
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
      }
    }

    // Check Router to Modem Link (Ethernet WAN)
    if (isWarmedUp(routerToModemStats)) {
      if (routerToModemStats.lossPct >= critLoss) {
        candidateIssues.push({
          id: 'ROUTER_MODEM_CRITICAL_LOSS',
          severity: 'CRITICAL',
          title: 'Router to Modem Cable Failure',
          description: `Main router to ISP modem link has ${routerToModemStats.lossPct}% packet loss.`,
          recommendation: 'Check the Ethernet patch cable connecting the router WAN port to the modem/ONT.'
        });
        overallStatus = 'CRITICAL';
      } else if (routerToModemStats.lossPct >= warnLoss) {
        candidateIssues.push({
          id: 'ROUTER_MODEM_MODERATE_LOSS',
          severity: 'WARNING',
          title: 'Router to Modem Cable Instability',
          description: `Experiencing ${routerToModemStats.lossPct}% packet loss between router and ISP modem.`,
          recommendation: 'Inspect the Ethernet cable between the router and modem for loose seating or bending.'
        });
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
      }
    }

    // Check Mesh Satellite Nodes & Backhaul Links
    if (topology && topology.nodes) {
      topology.nodes.forEach(node => {
        if (node.type === 'client' || node.type === 'modem' || node.type === 'wan') return;
        const nodeLink = linkStats[`link_client_${node.id}`] || linkStats[`link_node_${node.id}`];
        if (isWarmedUp(nodeLink)) {
          if (nodeLink.lossPct === 100) {
            candidateIssues.push({
              id: `NODE_OFFLINE_${node.id}`,
              severity: 'CRITICAL',
              title: `Mesh Node Unreachable: ${node.name}`,
              description: `Node ${node.name} (${node.ip || node.id}) stopped responding to ping and telemetry requests.`,
              recommendation: 'Check if the node has lost power, fallen out of mesh sync, or rebooted.'
            });
            overallStatus = 'CRITICAL';
          } else if (nodeLink.lossPct >= warnLoss) {
            candidateIssues.push({
              id: `NODE_PACKET_LOSS_${node.id}`,
              severity: 'WARNING',
              title: `Packet Loss on ${node.name}`,
              description: `Experiencing ${nodeLink.lossPct}% packet loss to node ${node.name}.`,
              recommendation: 'Check wireless backhaul line-of-sight between this satellite and the root router.'
            });
            if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
          }
        }
      });
    }

    // 3. Differential Root Cause Analysis (Internal Mesh vs External ISP)
    if (isWarmedUp(gatewayToWanStats)) {
      const isWanDegraded = gatewayToWanStats.lossPct >= warnLoss || gatewayToWanStats.avg >= warnLatency;
      const isModemCableGood = routerToModemStats ? (routerToModemStats.lossPct < warnLoss) : true;
      const isInternalMeshGood = pcToApStats ? (pcToApStats.lossPct < warnLoss) : true;

      if (isWanDegraded) {
        if (isInternalMeshGood && isModemCableGood) {
          candidateIssues.push({
            id: 'ISP_WAN_DEGRADATION',
            severity: gatewayToWanStats.lossPct >= critLoss ? 'CRITICAL' : 'WARNING',
            title: 'External Internet (ISP) Packet Loss Detected',
            description: `Internal home mesh and modem cable are healthy, but external ISP traffic is experiencing ${gatewayToWanStats.lossPct}% packet loss (${gatewayToWanStats.current || gatewayToWanStats.avg}ms latency).`,
            recommendation: 'The fluctuation is external to your home (ISP optical/broadband line). If persistent, check ISP service status.'
          });
        } else if (!isInternalMeshGood) {
          candidateIssues.push({
            id: 'WAN_AND_LOCAL_DEGRADATION',
            severity: 'CRITICAL',
            title: 'Widespread Latency / Packet Loss',
            description: `Experiencing ${gatewayToWanStats.lossPct}% loss to the Internet along with local Wi-Fi link degradation (${pcToApStats?.lossPct || 0}%).`,
            recommendation: 'Check local Wi-Fi connection first; if unresolved, restart primary router.'
          });
        }
        if (gatewayToWanStats.lossPct >= critLoss) {
          overallStatus = 'CRITICAL';
        } else if (overallStatus !== 'CRITICAL') {
          overallStatus = 'DEGRADED';
        }
      }
    }

    // 4. Debounce Filter (Hysteresis):
    // Only surface an alert if it persists for at least 3 consecutive ticks,
    // avoiding false alarm flashing on momentary 1-second drops.
    const activeIssues = [];
    const currentCandidateIds = new Set(candidateIssues.map(c => c.id));

    for (const cand of candidateIssues) {
      const count = (this.issueCounters.get(cand.id) || 0) + 1;
      this.issueCounters.set(cand.id, count);

      // Require 3 consecutive cycles (or immediate for adapter disconnect)
      if (count >= 3 || cand.id === 'WIFI_DISCONNECTED') {
        activeIssues.push(cand);
      }
    }

    // Decay counters for issues no longer present
    for (const [id, count] of Array.from(this.issueCounters.entries())) {
      if (!currentCandidateIds.has(id)) {
        if (count > 1) {
          this.issueCounters.set(id, count - 1);
        } else {
          this.issueCounters.delete(id);
        }
      }
    }

    // If no debounced issues survived, keep overallStatus clean
    if (activeIssues.length === 0 && overallStatus !== 'CRITICAL') {
      overallStatus = 'HEALTHY';
    }

    // 5. Calculate Calibrated Composite Health Score (0 - 100)
    let score = 100;
    if (wifiInfo && wifiInfo.connected) {
      if (wifiInfo.rssi && wifiInfo.rssi <= (thresholds.rssiCriticalDbm || -85)) score -= 15;
      else if (wifiInfo.rssi && wifiInfo.rssi <= (thresholds.rssiWarningDbm || -75)) score -= 5;
    } else {
      score -= 50;
    }

    // Loss penalty helper:
    // 0 - 10% loss is treated as gentle variance (e.g. 5% loss -> -2.0)
    // > 10% loss scales proportionally
    const calcLossPenalty = (lossPct) => {
      if (!lossPct || lossPct <= 0) return 0;
      if (lossPct <= 10) return lossPct * 0.4;
      return 4 + (lossPct - 10) * 1.4;
    };

    if (gatewayToWanStats && isWarmedUp(gatewayToWanStats)) {
      score -= Math.min(35, calcLossPenalty(gatewayToWanStats.lossPct));
    }

    if (routerToModemStats && isWarmedUp(routerToModemStats)) {
      score -= Math.min(25, calcLossPenalty(routerToModemStats.lossPct));
    }

    if (pcToApStats && isWarmedUp(pcToApStats)) {
      score -= Math.min(30, calcLossPenalty(pcToApStats.lossPct));
      if ((pcToApStats.avg || 0) > warnLatency) {
        score -= Math.min(12, Math.round((pcToApStats.avg - warnLatency) / 5));
      }
    }

    const healthScore = Math.max(0, Math.min(100, Math.round(score)));

    // Record new incidents in history
    this.recordIncidents(activeIssues);

    return {
      overallStatus,
      healthScore,
      issues: activeIssues,
      incidents: this.incidents.slice(0, 30)
    };
  }

  recordIncidents(currentIssues) {
    const now = Date.now();
    for (const issue of currentIssues) {
      const existing = this.incidents.find(i => i.id === issue.id && !i.resolvedAt);
      if (!existing) {
        this.incidents.unshift({
          ...issue,
          timestamp: now,
          resolvedAt: null
        });
        if (this.incidents.length > this.maxIncidents) {
          this.incidents.pop();
        }
      }
    }

    // Mark disappeared incidents as resolved
    for (const incident of this.incidents) {
      if (!incident.resolvedAt) {
        const stillPresent = currentIssues.some(i => i.id === incident.id);
        if (!stillPresent) {
          incident.resolvedAt = now;
        }
      }
    }
  }
}

module.exports = new DiagnosisEngine();
