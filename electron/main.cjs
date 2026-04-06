const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { execFile } = require('node:child_process');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const isDev = !app.isPackaged;
const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3000';
let rendererServer = null;
let serialBridge = null;

const serialState = {
  connected: false,
  path: null,
  baudRate: 115200,
  robotId: null,
  fwVersion: null,
  lastTelemetryAt: null,
  timeoutMs: 3000,
  telemetry: null,
  rxCount: 0,
  txCount: 0,
  lastSignal: null,
  lastAck: null,
  phase: 'DETACHED',
  activeTransport: 'serial',
  queueDepth: 0,
  dropPackets: 0,
  watchdogAgeMs: 0,
  lastErrCode: 0,
  lastErrText: 'ok',
  lastError: null,
};

const phaseSet = new Set(['DETACHED', 'USB_ONLY', 'PROVISIONING', 'WIFI_PRIMARY', 'SERIAL_FALLBACK', 'ERROR']);
const transportSet = new Set(['wifi', 'serial']);

function normalizePhase(value) {
  const phase = String(value ?? '').trim().toUpperCase();
  return phaseSet.has(phase) ? phase : null;
}

function normalizeTransport(value) {
  const transport = String(value ?? '').trim().toLowerCase();
  return transportSet.has(transport) ? transport : null;
}

function reasonCodeToText(code) {
  const numeric = Number(code);
  switch (numeric) {
    case 0x00:
      return 'ok';
    case 0x01:
      return 'stale_ttl';
    case 0x02:
      return 'duplicate_id';
    case 0x03:
      return 'prov_locked';
    case 0x04:
      return 'dual_active';
    case 0x05:
      return 'malformed';
    case 0x06:
      return 'not_armed';
    default:
      return 'unknown';
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTelemetry(payload) {
  const wifi = isRecord(payload.wifi) ? payload.wifi : {};
  const velocity = Number(payload.velocity ?? 0);
  const temp = Number(payload.temp ?? 0);
  const pitch = Number(payload.pitch ?? 0);
  const roll = Number(payload.roll ?? 0);
  const battery = Number(payload.battery ?? -1);
  const seq = Number(payload.seq ?? 0);
  const ts = Number(payload.ts ?? Date.now());
  const state = String(payload.state ?? '--').toLowerCase();
  const gait = String(payload.gait ?? '--').toLowerCase();

  return {
    battery: Number.isFinite(battery) ? battery : -1,
    velocity: Number.isFinite(velocity) ? velocity : 0,
    temp: Number.isFinite(temp) ? temp : 0,
    pitch: Number.isFinite(pitch) ? pitch : 0,
    roll: Number.isFinite(roll) ? roll : 0,
    state: ['idle', 'running', 'hold', 'estop'].includes(state) ? state : '--',
    gait: ['walk', 'trot', 'stomp'].includes(gait) ? gait : '--',
    wifi: {
      mode: String(wifi.mode ?? 'off'),
      ip: String(wifi.ip ?? '--'),
      rssi: Number.isFinite(Number(wifi.rssi ?? 0)) ? Number(wifi.rssi ?? 0) : 0,
    },
    seq: Number.isFinite(seq) ? seq : 0,
    ts: Number.isFinite(ts) ? ts : Date.now(),
  };
}

function execPowerShell(command) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve(String(stdout || '').trim());
      },
    );
  });
}

function resetSerialState() {
  serialState.connected = false;
  serialState.path = null;
  serialState.robotId = null;
  serialState.fwVersion = null;
  serialState.lastTelemetryAt = null;
  serialState.telemetry = null;
  serialState.rxCount = 0;
  serialState.txCount = 0;
  serialState.lastSignal = null;
  serialState.lastAck = null;
  serialState.phase = 'DETACHED';
  serialState.activeTransport = 'serial';
  serialState.queueDepth = 0;
  serialState.dropPackets = 0;
  serialState.watchdogAgeMs = 0;
  serialState.lastErrCode = 0;
  serialState.lastErrText = 'ok';
  serialState.lastError = null;
}

function splitLines(chunk, carry) {
  const combined = `${carry}${chunk}`;
  const lines = combined.split(/\r?\n/);
  const tail = lines.pop() ?? '';
  return { lines, tail };
}

function sanitizeOutgoingSerialCommand(command) {
  const trimmed = String(command || '').trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('action:')) {
    return trimmed.slice('action:'.length).trim();
  }

  return trimmed;
}

function buildSerialBridgeScript(pathName, baudRate) {
  const safePath = String(pathName).replace(/'/g, "''");
  const safeBaud = Number.isFinite(baudRate) ? Math.max(1200, Math.round(baudRate)) : 115200;

  return `
$ErrorActionPreference = 'Stop'
$port = New-Object System.IO.Ports.SerialPort('${safePath}', ${safeBaud}, 'None', 8, 'One')
$port.NewLine = "\`n"
$port.ReadTimeout = 50
$port.WriteTimeout = 500
$port.DtrEnable = $true
$port.RtsEnable = $true
$port.Open()
Write-Output 'INFO|OPENED'
$inputTask = [Console]::In.ReadLineAsync()
$buffer = ''
try {
  while ($true) {
    while ($port.BytesToRead -gt 0) {
      $chunk = $port.ReadExisting()
      if ($null -eq $chunk) { break }
      $buffer += $chunk
      while ($buffer.Contains("\`n")) {
        $idx = $buffer.IndexOf("\`n")
        $line = $buffer.Substring(0, $idx).Trim("\`r")
        $buffer = $buffer.Substring($idx + 1)
        if ($line.Length -gt 0) {
          Write-Output ("RX|" + $line)
        }
      }
    }

    if ($inputTask.IsCompleted) {
      $cmd = $inputTask.Result
      if ($null -eq $cmd) { break }
      $trimmed = $cmd.Trim()
      if ($trimmed.Length -gt 0) {
        $port.WriteLine($trimmed)
      }
      $inputTask = [Console]::In.ReadLineAsync()
    }

    Start-Sleep -Milliseconds 15
  }
}
catch {
  Write-Output ("ERR|" + $_.Exception.Message)
}
finally {
  if ($port.IsOpen) { $port.Close() }
  Write-Output 'INFO|CLOSED'
}
`;
}

async function stopSerialBridge() {
  if (!serialBridge) {
    return;
  }

  const worker = serialBridge;
  serialBridge = null;

  try {
    if (worker.stdin && !worker.stdin.destroyed) {
      worker.stdin.end();
    }
  } catch {
    // Ignore shutdown stream errors.
  }

  if (!worker.killed) {
    worker.kill();
  }
}

async function startSerialBridge(pathName, baudRate) {
  await stopSerialBridge();

  const script = buildSerialBridgeScript(pathName, baudRate);
  const worker = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  serialBridge = worker;

  let stdoutCarry = '';
  worker.stdout.on('data', (chunk) => {
    const next = splitLines(String(chunk || ''), stdoutCarry);
    stdoutCarry = next.tail;

    for (const line of next.lines) {
      const text = line.trim();
      if (!text) {
        continue;
      }

      if (text.startsWith('RX|')) {
        const rxPayload = text.slice(3);
        serialState.rxCount += 1;
        updateSignal(rxPayload);
        continue;
      }

      if (text.startsWith('ERR|')) {
        const message = text.slice(4) || 'Serial bridge error';
        serialState.lastError = message;
        serialState.lastErrText = message;
        updateSignal(JSON.stringify({ type: 'error', message, ts: Date.now() }));
        continue;
      }

      if (text.startsWith('INFO|')) {
        const message = text.slice(5) || 'bridge';
        updateSignal(JSON.stringify({ type: 'info', message, ts: Date.now() }));
      }
    }
  });

  worker.stderr.on('data', (chunk) => {
    const message = String(chunk || '').trim();
    if (!message) {
      return;
    }
    serialState.lastError = message;
  });

  worker.on('exit', (code) => {
    if (serialBridge === worker) {
      serialBridge = null;
    }

    if (serialState.connected) {
      serialState.connected = false;
      serialState.path = null;
      serialState.lastTelemetryAt = null;
      serialState.phase = 'ERROR';

      const exitCode = code === null ? 'unknown' : String(code);
      serialState.lastError = `Serial bridge exited (${exitCode})`;
      serialState.lastErrText = serialState.lastError;
      updateSignal(JSON.stringify({ type: 'error', message: serialState.lastError, ts: Date.now() }));
    }
  });
}

function updateSignal(rawLine) {
  const raw = rawLine.trim();
  if (!raw) {
    return;
  }

  let payload = raw;
  let type = 'text';

  try {
    payload = JSON.parse(raw);
    type = 'json';

    if (isRecord(payload)) {
      const messageType = String(payload.type ?? '').toLowerCase();
      if (messageType === 'ack') {
        type = 'ack';
        serialState.robotId = typeof payload.robot_id === 'string' ? payload.robot_id : serialState.robotId;
        serialState.fwVersion = typeof payload.fw === 'string' ? payload.fw : serialState.fwVersion;

        const phase = normalizePhase(payload.phase);
        if (phase) {
          serialState.phase = phase;
        }

        const transport = normalizeTransport(payload.transport);
        if (transport) {
          serialState.activeTransport = transport;
        }

        const reasonCode = Number.isFinite(Number(payload.reason_code)) ? Number(payload.reason_code) : 0;
        const reasonText = typeof payload.reason_text === 'string' ? payload.reason_text : reasonCodeToText(reasonCode);
        const status = typeof payload.status === 'string' ? payload.status.toUpperCase() : 'OK';

        serialState.lastErrCode = reasonCode;
        serialState.lastErrText = reasonText;
        serialState.lastAck = {
          at: Date.now(),
          ackId: Number.isFinite(Number(payload.ack_id)) ? Number(payload.ack_id) : null,
          status,
          reasonCode,
          reasonText,
          phase: serialState.phase,
          transport: serialState.activeTransport,
          fwTs: Number.isFinite(Number(payload.fw_ts)) ? Number(payload.fw_ts) : null,
        };
      }

      if (messageType === 'telemetry') {
        type = 'telemetry';
        serialState.telemetry = normalizeTelemetry(payload);
        serialState.lastTelemetryAt = Date.now();

        const navMeta = isRecord(payload.nav_meta) ? payload.nav_meta : {};
        const phase = normalizePhase(navMeta.phase);
        if (phase) {
          serialState.phase = phase;
        }

        const transport = normalizeTransport(navMeta.transport);
        if (transport) {
          serialState.activeTransport = transport;
        }

        const queueDepth = Number(navMeta.q_depth ?? serialState.queueDepth);
        serialState.queueDepth = Number.isFinite(queueDepth) ? Math.max(0, Math.floor(queueDepth)) : serialState.queueDepth;

        const dropPackets = Number(navMeta.drp_pkts ?? serialState.dropPackets);
        serialState.dropPackets = Number.isFinite(dropPackets) ? Math.max(0, Math.floor(dropPackets)) : serialState.dropPackets;

        const watchdogAgeMs = Number(navMeta.watchdog_age_ms ?? serialState.watchdogAgeMs);
        serialState.watchdogAgeMs = Number.isFinite(watchdogAgeMs) ? Math.max(0, Math.floor(watchdogAgeMs)) : serialState.watchdogAgeMs;

        const lastErrCode = Number(navMeta.last_err_code ?? serialState.lastErrCode);
        if (Number.isFinite(lastErrCode)) {
          serialState.lastErrCode = Math.max(0, Math.floor(lastErrCode));
        }
        const lastErrText = typeof navMeta.last_err_text === 'string'
          ? navMeta.last_err_text
          : reasonCodeToText(serialState.lastErrCode);
        serialState.lastErrText = lastErrText;
      }
    }
  } catch {
    if (/ack|ok|ready/i.test(raw)) {
      type = 'ack';
    } else if (/err|fail|panic/i.test(raw)) {
      type = 'error';
    } else if (/telemetry|imu|battery|rssi/i.test(raw)) {
      type = 'telemetry';
    }
  }

  serialState.lastSignal = {
    at: Date.now(),
    type,
    payload,
    raw,
  };
}

async function closeSerialPort() {
  await stopSerialBridge();
  resetSerialState();
}

function extractComPath(record) {
  const deviceId = String(record.DeviceID || '').trim();
  if (/^COM\d+$/i.test(deviceId)) {
    return deviceId.toUpperCase();
  }

  const name = String(record.Name || '');
  const match = name.match(/\((COM\d+)\)/i);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }

  return null;
}

function isCh340Device(record) {
  const haystack = `${record.Name || ''} ${record.PNPDeviceID || ''}`.toUpperCase();
  return /CH340|CH341|WCH\.CN|VID_1A86/.test(haystack);
}

async function listComPorts() {
  if (process.platform !== 'win32') {
    return [];
  }

  const comRaw = await execPowerShell(`
    $ports = [System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object;
    if ($ports) { $ports | ConvertTo-Json -Compress } else { '[]' }
  `);

  let comParsed = [];
  try {
    comParsed = comRaw ? JSON.parse(comRaw) : [];
  } catch {
    comParsed = [];
  }

  const comList = Array.isArray(comParsed) ? comParsed : [comParsed];
  const normalizedPorts = comList
    .map((port) => String(port || '').trim().toUpperCase())
    .filter((port) => /^COM\d+$/i.test(port));

  if (normalizedPorts.length === 0) {
    return [];
  }

  let pnpParsed = [];
  try {
    const pnpRaw = await execPowerShell(`
      $pnp = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '\\(COM\\d+\\)' } |
        Select-Object Name,PNPDeviceID;
      if ($pnp) { $pnp | ConvertTo-Json -Compress } else { '[]' }
    `);
    pnpParsed = pnpRaw ? JSON.parse(pnpRaw) : [];
  } catch {
    pnpParsed = [];
  }

  const pnpRecords = Array.isArray(pnpParsed) ? pnpParsed : [pnpParsed];
  const pnpByCom = new Map();

  for (const record of pnpRecords) {
    const comPath = extractComPath(record);
    if (!comPath) {
      continue;
    }

    pnpByCom.set(comPath, {
      name: String(record.Name || comPath).trim(),
      pnpId: String(record.PNPDeviceID || '').trim() || null,
      isCh340: isCh340Device(record),
    });
  }

  const dedup = new Map();

  for (const pathName of normalizedPorts) {
    const pnp = pnpByCom.get(pathName);
    const ch340 = Boolean(pnp?.isCh340);
    const pnpId = pnp?.pnpId || null;
    const deviceName = pnp?.name || pathName;

    if (!pathName) {
      continue;
    }

    dedup.set(pathName, {
      path: pathName,
      label: ch340 ? `${pathName} • CH340` : `${pathName} • ${deviceName}`,
      manufacturer: null,
      serialNumber: null,
      vendorId: null,
      productId: null,
      pnpId,
      isCh340: ch340,
    });
  }

  return [...dedup.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

async function connectComPort(pathName, baudRate = 115200) {
  await closeSerialPort();

  const ports = await listComPorts();
  const exists = ports.some((port) => port.path === pathName);
  if (!exists) {
    throw new Error(`Port not found: ${pathName}`);
  }

  serialState.connected = true;
  serialState.path = pathName;
  serialState.baudRate = baudRate;
  serialState.lastError = null;
  updateSignal('{"type":"status","value":"connected"}');
  await startSerialBridge(pathName, baudRate);

  return {
    connected: serialState.connected,
    path: serialState.path,
    baudRate: serialState.baudRate,
  };
}

async function sendComCommand(message) {
  if (!serialState.connected) {
    throw new Error('COM port is not connected');
  }

  if (!serialBridge || !serialBridge.stdin || serialBridge.stdin.destroyed) {
    throw new Error('Serial bridge is not available');
  }

  const payload = typeof message === 'string' ? sanitizeOutgoingSerialCommand(message) : JSON.stringify(message);
  if (!payload) {
    throw new Error('Empty command');
  }

  serialBridge.stdin.write(`${payload}\n`);
  serialState.txCount += 1;

  return {
    ok: true,
    txCount: serialState.txCount,
  };
}

function ingestIncomingSignal(line) {
  if (!serialState.connected) {
    return { ok: false, reason: 'not-connected' };
  }

  serialState.rxCount += 1;
  updateSignal(line);
  return { ok: true };
}

function getComStatus() {
  const now = Date.now();
  const timeoutMs = serialState.lastTelemetryAt ? now - serialState.lastTelemetryAt : Number.POSITIVE_INFINITY;

  return {
    connected: serialState.connected,
    path: serialState.path,
    baudRate: serialState.baudRate,
    robotId: serialState.robotId,
    fwVersion: serialState.fwVersion,
    lastTelemetryAt: serialState.lastTelemetryAt,
    timeoutMs,
    telemetry: serialState.telemetry,
    rxCount: serialState.rxCount,
    txCount: serialState.txCount,
    phase: serialState.phase,
    activeTransport: serialState.activeTransport,
    queueDepth: serialState.queueDepth,
    dropPackets: serialState.dropPackets,
    watchdogAgeMs: serialState.watchdogAgeMs,
    lastErrCode: serialState.lastErrCode,
    lastErrText: serialState.lastErrText,
    lastAck: serialState.lastAck,
    lastSignal: serialState.lastSignal,
    lastError: serialState.lastError,
  };
}

ipcMain.handle('desktop:list-com-ports', async () => listComPorts());
ipcMain.handle('desktop:connect-com-port', async (_event, options) => connectComPort(options.path, options.baudRate));
ipcMain.handle('desktop:disconnect-com-port', async () => {
  await closeSerialPort();
  return { connected: false };
});
ipcMain.handle('desktop:send-com-command', async (_event, command) => sendComCommand(command));
ipcMain.handle('desktop:get-com-status', async () => getComStatus());
ipcMain.handle('desktop:debug-ingest-signal', async (_event, line) => ingestIncomingSignal(String(line || '')));

async function createRendererServer() {
  if (rendererServer) {
    return rendererServer;
  }

  const gatewayBase = (process.env.URLAB_GATEWAY_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
  const distDir = path.join(__dirname, '..', 'dist');
  const rendererApp = express();

  rendererApp.use(express.static(distDir, { index: false }));

  rendererApp.use('/api', async (req, res) => {
    try {
      const targetUrl = `${gatewayBase}${req.originalUrl}`;
      const headers = { ...req.headers };
      delete headers.host;

      const init = {
        method: req.method,
        headers,
      };

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        init.body = req;
        init.duplex = 'half';
      }

      const upstream = await fetch(targetUrl, init);
      res.status(upstream.status);

      upstream.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'transfer-encoding') {
          return;
        }
        res.setHeader(key, value);
      });

      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'gateway proxy error';
      res.status(502).json({ ok: false, error: message });
    }
  });

  rendererApp.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  const server = http.createServer(rendererApp);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to resolve renderer server address'));
        return;
      }

      rendererServer = {
        server,
        url: `http://127.0.0.1:${address.port}`,
      };

      console.log('[electron] renderer server ready:', rendererServer.url);
      resolve(rendererServer);
    });
  });
}

async function loadMainWindow(mainWindow) {
  if (isDev) {
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  const { url } = await createRendererServer();
  await mainWindow.loadURL(url);

  if (process.env.URLAB_ELECTRON_DEBUG === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[electron] renderer loaded:', mainWindow.webContents.getURL());
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    console.error('[electron] did-fail-load:', { code, description, validatedURL });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[electron] render-process-gone:', details);
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const source = String(sourceId || '');
    const text = String(message || '');
    if (
      source.startsWith('devtools://') &&
      (text.includes('Autofill.enable') || text.includes('Autofill.setAddresses'))
    ) {
      return;
    }
    console.log(`[renderer:${level}] ${sourceId}:${line} ${message}`);
  });

  void loadMainWindow(mainWindow).catch((error) => {
    console.error('[electron] window load failed:', error);
  });
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void closeSerialPort();

  if (rendererServer) {
    rendererServer.server.close();
    rendererServer = null;
  }
});
