const { app, BrowserWindow, Menu, Tray } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow = null;
let serverProcess = null;
const SERVER_PORT = process.env.PORT || 3030;

function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode === 200 || res.statusCode === 304) {
          resolve();
        } else {
          retry();
        }
      }).on('error', retry);
    };

    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Server start timed out'));
      } else {
        setTimeout(check, 250);
      }
    };

    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    title: 'MeshPulse - Continuous Mesh Link Diagnostics',
    backgroundColor: '#0b0f19',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Start internal Express + WebSocket server
function startInternalServer() {
  try {
    require('../server/index.js');
  } catch (err) {
    console.error('Failed to start internal server:', err);
  }
}

app.whenReady().then(async () => {
  startInternalServer();
  try {
    await waitForServer(`http://localhost:${SERVER_PORT}/api/status`, 12000);
  } catch (e) {
    console.warn('Wait for server error (proceeding to load):', e.message);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
