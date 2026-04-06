type DesktopComPort = {
  path: string;
  label: string;
  manufacturer: string | null;
  serialNumber: string | null;
  vendorId: string | null;
  productId: string | null;
  pnpId?: string | null;
  isCh340?: boolean;
};

type DesktopComStatus = {
  connected: boolean;
  path: string | null;
  baudRate: number;
  robotId: string | null;
  fwVersion: string | null;
  lastTelemetryAt: number | null;
  timeoutMs: number;
  telemetry: {
    battery: number;
    velocity: number;
    temp: number;
    pitch: number;
    roll: number;
    state: 'idle' | 'running' | 'hold' | 'estop' | '--';
    gait: 'walk' | 'trot' | 'stomp' | '--';
    wifi: {
      mode: string;
      ip: string;
      rssi: number;
    };
    seq: number;
    ts: number;
  } | null;
  rxCount: number;
  txCount: number;
  phase: 'DETACHED' | 'USB_ONLY' | 'PROVISIONING' | 'WIFI_PRIMARY' | 'SERIAL_FALLBACK' | 'ERROR';
  activeTransport: 'wifi' | 'serial';
  queueDepth: number;
  dropPackets: number;
  watchdogAgeMs: number;
  lastErrCode: number;
  lastErrText: string;
  lastAck: {
    at: number;
    ackId: number | null;
    status: 'OK' | 'ERROR' | 'REJECTED';
    reasonCode: number;
    reasonText: string;
    phase: 'DETACHED' | 'USB_ONLY' | 'PROVISIONING' | 'WIFI_PRIMARY' | 'SERIAL_FALLBACK' | 'ERROR';
    transport: 'wifi' | 'serial';
    fwTs: number | null;
  } | null;
  lastSignal: {
    at: number;
    type: string;
    payload: unknown;
    raw: string;
  } | null;
  lastError: string | null;
};

type DesktopRuntime = {
  platform: string;
  isDesktop: boolean;
  listComPorts: () => Promise<DesktopComPort[]>;
  connectComPort: (options: { path: string; baudRate?: number }) => Promise<{ connected: boolean; path: string; baudRate: number }>;
  disconnectComPort: () => Promise<{ connected: boolean }>;
  sendComCommand: (command: string | Record<string, unknown>) => Promise<{ ok: true; txCount: number }>;
  getComStatus: () => Promise<DesktopComStatus>;
  debugIngestSignal?: (line: string) => Promise<{ ok: boolean; reason?: string }>;
};

declare global {
  interface Window {
    desktopRuntime?: DesktopRuntime;
  }
}

export {};
