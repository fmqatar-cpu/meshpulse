const { exec } = require('child_process');
const http = require('http');

function execCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function fetchJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function testDiscovery() {
  console.log('Testing discovery...');
  try {
    const ifaceOut = await execCommand('netsh wlan show interfaces');
    console.log('Got wlan interfaces output length:', ifaceOut.length);
    
    const rootStatus = await fetchJson('http://192.168.86.1/api/v1/status');
    console.log('Root model:', rootStatus.system?.modelId, 'role:', rootStatus.system?.groupRole);

    const sat1Status = await fetchJson('http://192.168.86.41/api/v1/status');
    console.log('Sat1 model:', sat1Status.system?.modelId, 'role:', sat1Status.system?.groupRole, 'ip:', sat1Status.wan?.localIpAddress);

    const sat2Status = await fetchJson('http://192.168.86.26/api/v1/status');
    console.log('Sat2 model:', sat2Status.system?.modelId, 'role:', sat2Status.system?.groupRole, 'ip:', sat2Status.wan?.localIpAddress);
  } catch (err) {
    console.error('Error:', err);
  }
}

testDiscovery();
