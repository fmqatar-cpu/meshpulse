class DiagnosisEngine {
  constructor() {
    this.incidents = [];
    this.maxIncidents = 50;
  }

  evaluate(topology, linkStats, wifiInfo, thresholds) {
    const issues = [];
    let overallStatus = 'HEALTHY'; // 'HEALTHY' | 'DEGRADED' | 'CRITICAL'

    // 1. Check Wi-Fi Local Physical Layer
    if (wifiInfo && wifiInfo.connected) {
      if (wifiInfo.rssi && wifiInfo.rssi <= thresholds.rssiCriticalDbm) {
        issues.push({
          id: 'WIFI_CRITICAL_RSSI',
          severity: 'CRITICAL',
          title: 'Critically Weak Wi-Fi Signal',
          description: `PC connection to Access Point is at ${wifiInfo.rssi} dBm (${wifiInfo.signal}%). Expect high packet loss.`,
          recommendation: 'Move PC closer to the access point or check for heavy physical obstructions.'
        });
        overallStatus = 'CRITICAL';
      } else if (wifiInfo.rssi && wifiInfo.rssi <= thresholds.rssiWarningDbm) {
        issues.push({
          id: 'WIFI_LOW_RSSI',
          severity: 'WARNING',
          title: 'Suboptimal Wi-Fi Signal Strength',
          description: `Current RSSI is ${wifiInfo.rssi} dBm (${wifiInfo.signal}%). Signal degradation may cause occasional latency spikes.`,
          recommendation: 'Consider adjusting node placement or antenna angle.'
        });
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
      }
    } else if (wifiInfo && !wifiInfo.connected) {
      issues.push({
        id: 'WIFI_DISCONNECTED',
        severity: 'CRITICAL',
        title: 'Wi-Fi Adapter Disconnected',
        description: 'The host PC Wi-Fi adapter is not currently connected to any network.',
        recommendation: 'Connect to your home mesh network SSID.'
      });
      return { overallStatus: 'CRITICAL', issues, incidents: this.incidents };
    }

    // 2. Analyze Individual Link Metrics
    const pcToApStats = linkStats['link_client_ap'];
    const pcToGatewayStats = linkStats['link_client_gateway'];
    const gatewayToWanStats = linkStats['link_gateway_wan'];

    // Check PC to AP Link
    if (pcToApStats) {
      if (pcToApStats.lossPct >= thresholds.lossCriticalPct) {
        issues.push({
          id: 'LINK_CLIENT_AP_PACKET_LOSS',
          severity: 'CRITICAL',
          title: 'High Packet Loss: PC to Access Point',
          description: `PC to AP link is experiencing ${pcToApStats.lossPct}% packet loss.`,
          recommendation: 'Check for local 2.4/5GHz interference or distance from the node.'
        });
        overallStatus = 'CRITICAL';
      } else if (pcToApStats.avg >= thresholds.latencyWarningMs) {
        issues.push({
          id: 'LINK_CLIENT_AP_HIGH_LATENCY',
          severity: 'WARNING',
          title: 'Elevated Latency to Connected Node',
          description: `Average ping to the connected AP is ${pcToApStats.avg}ms (warning threshold: ${thresholds.latencyWarningMs}ms).`,
          recommendation: 'Check airtime usage and channel contention.'
        });
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
      }
    }

    // Check Mesh Satellite Nodes & Backhaul Links
    if (topology && topology.nodes) {
      topology.nodes.forEach(node => {
        if (node.type === 'client') return;
        const nodeLink = linkStats[`link_client_${node.id}`] || linkStats[`link_node_${node.id}`];
        if (nodeLink) {
          if (nodeLink.lossPct === 100) {
            issues.push({
              id: `NODE_OFFLINE_${node.id}`,
              severity: 'CRITICAL',
              title: `Mesh Node Unreachable: ${node.name}`,
              description: `Node ${node.name} (${node.ip || node.id}) stopped responding to ping and telemetry requests.`,
              recommendation: 'Check if the node has lost power, fallen out of mesh sync, or rebooted.'
            });
            overallStatus = 'CRITICAL';
          } else if (nodeLink.lossPct >= thresholds.lossWarningPct) {
            issues.push({
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
    if (gatewayToWanStats) {
      const isWanBad = (gatewayToWanStats.avg || 0) > thresholds.latencyWarningMs || gatewayToWanStats.lossPct >= thresholds.lossWarningPct;
      const isInternalGood = pcToGatewayStats 
        ? ((pcToGatewayStats.avg || 0) < thresholds.latencyWarningMs && pcToGatewayStats.lossPct < 5)
        : true;

      if (isWanBad) {
        if (isInternalGood) {
          issues.push({
            id: 'ISP_WAN_DEGRADATION',
            severity: gatewayToWanStats.lossPct >= thresholds.lossCriticalPct ? 'CRITICAL' : 'WARNING',
            title: 'External Internet (ISP) Packet Loss Detected',
            description: `Internal home mesh is completely healthy (<${pcToGatewayStats?.avg || 3}ms, 0% loss), but WAN uplink is experiencing ${gatewayToWanStats.lossPct}% packet loss (${gatewayToWanStats.current || gatewayToWanStats.avg}ms latency).`,
            recommendation: 'Issue is outside your home mesh (ISP upstream or modem link). Check modem cable or contact ISP.'
          });
        } else {
          issues.push({
            id: 'WAN_AND_LOCAL_DEGRADATION',
            severity: 'CRITICAL',
            title: 'Widespread Latency / Packet Loss',
            description: `Experiencing ${gatewayToWanStats.lossPct}% loss to the Internet and degraded local mesh transit.`,
            recommendation: 'Restart primary router and verify cable modem connections.'
          });
        }
        if (gatewayToWanStats.lossPct >= thresholds.lossCriticalPct) {
          overallStatus = 'CRITICAL';
        } else if (overallStatus !== 'CRITICAL') {
          overallStatus = 'DEGRADED';
        }
      }
    }

    // Check Backhaul specific degradation (if connected to a leaf satellite)
    if (pcToApStats && pcToGatewayStats) {
      const backhaulEstimatedLatency = (pcToGatewayStats.avg || 0) - (pcToApStats.avg || 0);
      if (backhaulEstimatedLatency > 35 && pcToApStats.lossPct < 5) {
        issues.push({
          id: 'MESH_BACKHAUL_BOTTLENECK',
          severity: 'WARNING',
          title: 'Wireless Mesh Backhaul Congestion',
          description: `Backhaul transit time between your satellite node and the main gateway is ~${Math.round(backhaulEstimatedLatency)}ms.`,
          recommendation: 'Relocate the satellite node closer to the main router to improve backhaul signal.'
        });
        if (overallStatus !== 'CRITICAL') overallStatus = 'DEGRADED';
      }
    }

    // 4. Calculate Dynamic Composite Health Score (0 - 100)
    let score = 100;
    if (wifiInfo && wifiInfo.connected) {
      if (wifiInfo.rssi && wifiInfo.rssi <= thresholds.rssiCriticalDbm) score -= 20;
      else if (wifiInfo.rssi && wifiInfo.rssi <= thresholds.rssiWarningDbm) score -= 8;
    } else {
      score -= 50;
    }

    // Deduct for WAN packet loss
    if (gatewayToWanStats && gatewayToWanStats.lossPct > 0) {
      score -= Math.min(40, gatewayToWanStats.lossPct * 2);
    }

    // Deduct for local client-to-AP loss/latency
    if (pcToApStats) {
      if (pcToApStats.lossPct > 0) score -= Math.min(35, pcToApStats.lossPct * 2.5);
      if ((pcToApStats.avg || 0) > thresholds.latencyWarningMs) score -= 10;
    }

    // Deduct for each degraded satellite
    if (topology && topology.nodes) {
      topology.nodes.forEach(node => {
        if (node.type === 'satellite') {
          const sLink = linkStats[`link_node_${node.id}`] || linkStats[`link_client_${node.id}`];
          if (sLink) {
            if (sLink.lossPct === 100) score -= 30;
            else if (sLink.lossPct > 0) score -= Math.min(20, sLink.lossPct * 1.5);
          }
        }
      });
    }

    const healthScore = Math.max(0, Math.min(100, Math.round(score)));

    // Record new incidents in history
    this.recordIncidents(issues);

    return {
      overallStatus,
      healthScore,
      issues,
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
