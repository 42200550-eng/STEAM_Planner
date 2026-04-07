import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppCopy } from '../i18n';
import {
  isArmControlEnabled,
  isMotionControlEnabled,
  parseCapabilityFromRecord,
  parseFlag,
  reasonCodeLabel,
  type RuntimeCapability,
} from '../lib/firmwareContract';

type CommandTemplate = {
  label: string;
  duration: number;
};

type MissionBlock = {
  id: string;
  label: string;
  duration: number;
};

type StudioTuningState = {
  stepSpeed: number;
  bodyHeight: number;
  jointAmplitude: number;
};

type GraphPoint = {
  id: number;
  ts: number;
  pitch: number;
  roll: number;
};

const libraryBlocks: CommandTemplate[] = [
  { label: 'Tien toi', duration: 3 },
  { label: 'Lui lai', duration: 2 },
  { label: 'Re trai', duration: 1.5 },
  { label: 'Re phai', duration: 1.5 },
  { label: 'Dung', duration: 0.8 },
  { label: 'Quet cam bien', duration: 2.2 },
];

const movementKeys = ['W', 'A', 'S', 'D'] as const;
const actionKeys = ['1', '2', '3', '4', '5'] as const;
const keyboardKeys = [...movementKeys, ...actionKeys, 'SPACE'] as const;

type GhostKey = (typeof keyboardKeys)[number];
type ActionKey = (typeof actionKeys)[number];
type SegmentTab = 'control' | 'studio' | 'calib' | 'wifi' | 'log';
type ActionPreset = 'sit' | 'stretch' | 'butt_up' | 'jump' | 'hi';
const actionPresetOrder: ActionPreset[] = ['sit', 'stretch', 'butt_up', 'jump', 'hi'];
type FirmwareAction =
  | 'arm'
  | 'hold'
  | 'estop'
  | 'clear_estop'
  | 'stop'
  | 'status'
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'sit'
  | 'stretch'
  | 'butt_up'
  | 'jump'
  | 'hi'
  | 'speed'
  | 'height'
  | 'walk'
  | 'trot'
  | 'stomp';

type ComPortOption = {
  path: string;
  label: string;
  isCh340?: boolean;
};

type SerialLogEntry = {
  id: number;
  ts: number;
  direction: 'TX' | 'RX';
  text: string;
};

type RobotInventoryItem = {
  robotId: string;
  chipMac: string;
  firmwareVersion: string;
  controlUdpPort: string;
  lastKnownIp: string;
  healthState: string;
  wifiReady: boolean;
  lastServiceAt: number;
};

type CalibJointKey = '1h' | '1s' | '2h' | '2s' | '3h' | '3s' | '4h' | '4s';

type RuntimePhase = 'DETACHED' | 'USB_ONLY' | 'PROVISIONING' | 'WIFI_PRIMARY' | 'SERIAL_FALLBACK' | 'ERROR';
type RuntimeTransport = 'wifi' | 'serial';
type ConnectionUxState = 'DISCONNECTED' | 'LINK_REACHABLE' | 'READY_AP_FALLBACK' | 'READY_STA_PRIMARY' | 'DEGRADED';
type LinkMode = 'sta_primary' | 'ap_fallback' | 'unknown';

function formatControlLabel(action: FirmwareAction, value?: number) {
  if (action === 'speed' && typeof value === 'number') {
    return `speed:${value}`;
  }
  if (action === 'height' && typeof value === 'number') {
    return `height:${value}`;
  }
  return action;
}

function getSerialCommandForAction(action: FirmwareAction, value?: number) {
  const serialMode = parseEnvString('VITE_SERIAL_PROTOCOL_MODE', 'text').toLowerCase();

  if (action === 'speed' && typeof value === 'number') {
    const normalized = Math.max(0, Math.min(10, value)) / 10;
    return `speed=${normalized.toFixed(2)}`;
  }

  if (action === 'height' && typeof value === 'number') {
    const mm = Math.round(50 + (Math.max(0, Math.min(100, value)) / 100) * 70);
    return `hgt=${mm}`;
  }

  const serialMap: Record<FirmwareAction, string> = serialMode === 'legacy-keymap'
    ? {
        arm: 'start',
        hold: 'hold',
        estop: 'es',
        clear_estop: 'ec',
        stop: 'stop',
        status: 'status',
        forward: 'w',
        backward: parseEnvString('VITE_SERIAL_BACKWARD_COMMAND', 'backward'),
        left: 'a',
        right: 'd',
        sit: 'act sit',
        stretch: 'act stretch',
        butt_up: 'act butt_up',
        jump: 'act jump',
        hi: 'act hi',
        speed: '',
        height: '',
        walk: 'gait=1',
        trot: 'gait=0',
        stomp: 'stomp',
      }
    : {
        arm: 'arm',
        hold: 'hold',
        estop: 'es',
        clear_estop: 'ec',
        stop: 'stop',
        status: 'status',
        forward: 'forward',
        backward: 'backward',
        left: 'left',
        right: 'right',
        sit: 'act sit',
        stretch: 'act stretch',
        butt_up: 'act butt_up',
        jump: 'act jump',
        hi: 'act hi',
        speed: '',
        height: '',
        walk: 'gait=1',
        trot: 'gait=0',
        stomp: 'stomp',
      };

  return serialMap[action] || '';
}

function resolveGatewayEndpoint(path: string) {
  const configuredBase = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_GATEWAY_BASE_URL?.trim();
  if (configuredBase) {
    return `${configuredBase.replace(/\/$/, '')}${path}`;
  }

  if (window.location.protocol === 'file:') {
    return `http://127.0.0.1:8787${path}`;
  }

  return path;
}

function parseEnvInt(name: string, fallback: number, min: number, max: number) {
  const raw = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.round(parsed);
  return Math.max(min, Math.min(max, normalized));
}

function parseEnvBool(name: string, fallback: boolean) {
  const raw = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }

  return fallback;
}

function parseEnvString(name: string, fallback: string) {
  const raw = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[name];
  if (typeof raw !== 'string') {
    return fallback;
  }

  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function isActionKey(key: GhostKey): key is ActionKey {
  return key === '1' || key === '2' || key === '3' || key === '4' || key === '5';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type UdpGatewayResult =
  | {
      ok: true;
      replyTimedOut: boolean;
      udpReplyRaw: string | null;
      udpReply: Record<string, unknown> | null;
      replyCount?: number;
      udpReplies?: Array<{
        udpReplyRaw: string | null;
        udpReply: Record<string, unknown> | null;
        replyFrom: string | null;
      }>;
      forwardedTo?: string;
      forwardedWithoutReply?: boolean;
    }
  | {
      ok: false;
      error: string;
    };

function getSavedRuntimeTarget() {
  try {
    const raw = localStorage.getItem('steam_planner_runtime_udp_target_v1');
    if (!raw) {
      return { host: '', port: '9000' };
    }

    const parsed = JSON.parse(raw) as { host?: unknown; port?: unknown };
    const host = typeof parsed.host === 'string' ? parsed.host.trim() : '';
    const port = typeof parsed.port === 'string' ? parsed.port.trim() : '9000';
    return {
      host,
      port: /^\d+$/.test(port) ? port : '9000',
    };
  } catch {
    return { host: '', port: '9000' };
  }
}

function getRuntimeTargetFromStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  const saved = getSavedRuntimeTarget();
  if (!saved.host || !/^\d+$/.test(saved.port)) {
    return null;
  }

  const normalizedPort = Number(saved.port);
  if (!Number.isFinite(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    return null;
  }

  return {
    targetHost: saved.host,
    targetPort: normalizedPort,
  };
}

async function sendRobotCommand(
  commandEnvelope: Record<string, unknown>,
  options?: { awaitReply?: boolean },
): Promise<UdpGatewayResult> {
  try {
    const shouldAwaitReply = options?.awaitReply !== false;
    const runtimeTarget = getRuntimeTargetFromStorage();
    const response = await fetch(resolveGatewayEndpoint('/api/udp-gateway'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        frame: commandEnvelope,
        awaitReply: shouldAwaitReply,
        ...(runtimeTarget ?? {}),
      }),
    });
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const detail = typeof errorBody?.error === 'string' ? errorBody.error : '';
      return { ok: false as const, error: detail || `udp gateway ${response.status}` };
    }

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const udpReply = isRecord(body?.udpReply) ? body.udpReply : null;
    const udpReplyRaw = typeof body?.udpReplyRaw === 'string' ? body.udpReplyRaw : null;
    const udpReplies = Array.isArray(body?.udpReplies)
      ? body!.udpReplies
          .map((entry) => {
            if (!isRecord(entry)) {
              return null;
            }
            return {
              udpReplyRaw: typeof entry.raw === 'string'
                ? entry.raw
                : (typeof entry.udpReplyRaw === 'string' ? entry.udpReplyRaw : null),
              udpReply: isRecord(entry.parsed)
                ? entry.parsed
                : (isRecord(entry.udpReply) ? entry.udpReply : null),
              replyFrom: typeof entry.replyFrom === 'string' ? entry.replyFrom : null,
            };
          })
          .filter((entry): entry is { udpReplyRaw: string | null; udpReply: Record<string, unknown> | null; replyFrom: string | null } => entry !== null)
      : undefined;
    const replyTimedOut = Boolean(body?.replyTimedOut);
    const replyCount = Number.isFinite(Number(body?.replyCount)) ? Number(body?.replyCount) : undefined;
    const forwardedTo = typeof body?.forwardedTo === 'string' ? body.forwardedTo : undefined;
    const forwardedWithoutReply = Boolean(body?.forwardedWithoutReply);

    return {
      ok: true as const,
      replyTimedOut,
      udpReplyRaw,
      udpReply,
      replyCount,
      udpReplies,
      forwardedTo,
      forwardedWithoutReply,
    };
  } catch {
    return { ok: false as const, error: 'udp gateway unreachable' };
  }
}

async function sendSerialCommand(command: string | Record<string, unknown>) {
  if (!window.desktopRuntime?.isDesktop) {
    return { ok: false as const, error: 'desktop runtime unavailable' };
  }

  try {
    await window.desktopRuntime.sendComCommand(command);
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'serial send failed';
    return { ok: false as const, error: message };
  }
}

async function dispatchFirmwareAction(
  action: FirmwareAction,
  cmdId: number,
  value: number | undefined,
) {
  const params = typeof value === 'number' ? { value } : {};
  const timestamp = Date.now();

  const udpEnvelope: Record<string, unknown> = {
    type: 'control_action',
    schema_v: 3,
    cmd_id: cmdId,
    ts_client: timestamp,
    ack_required: true,
    ttl_ms: 1200,
    action,
    params,
  };

  return sendRobotCommand(udpEnvelope);
}

function sleepWithAbort(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Timeline aborted', 'AbortError'));
      return;
    }

    const onAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException('Timeline aborted', 'AbortError'));
    };

    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function normalizeKey(input: string): GhostKey | null {
  const upper = input.toUpperCase();
  if (upper === 'W' || upper === 'A' || upper === 'S' || upper === 'D') {
    return upper;
  }
  if (upper === '1' || upper === '2' || upper === '3' || upper === '4' || upper === '5') {
    return upper;
  }
  if (input === ' ') {
    return 'SPACE';
  }
  return null;
}

function normalizeCode(code: string): GhostKey | null {
  if (code === 'KeyW') {
    return 'W';
  }
  if (code === 'KeyA') {
    return 'A';
  }
  if (code === 'KeyS') {
    return 'S';
  }
  if (code === 'KeyD') {
    return 'D';
  }
  if (code === 'Digit1' || code === 'Numpad1') {
    return '1';
  }
  if (code === 'Digit2' || code === 'Numpad2') {
    return '2';
  }
  if (code === 'Digit3' || code === 'Numpad3') {
    return '3';
  }
  if (code === 'Digit4' || code === 'Numpad4') {
    return '4';
  }
  if (code === 'Digit5' || code === 'Numpad5') {
    return '5';
  }
  if (code === 'Space') {
    return 'SPACE';
  }

  return null;
}

function parseLinkStatus(raw: string) {
  const line = raw.trim();
  const lower = line.toLowerCase();
  const maybeLinkStatus = lower.includes('link_status')
    || lower.includes('link:')
    || lower.includes('wifi_')
    || lower.includes('robot_id')
    || lower.includes('udp_port')
    || lower.includes('capability')
    || lower.includes('can_arm')
    || lower.includes('can_motion')
    || lower.includes('can_service')
    || lower.includes('calib_write_requires_com');
  const hasIpToken = /\bip\s*=\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})\b/i.test(line);

  if (!maybeLinkStatus && !hasIpToken) {
    return null;
  }

  const pick = (pattern: RegExp) => {
    const match = line.match(pattern);
    return match?.[1]?.trim() ?? null;
  };

  const ip = pick(/\bip\s*=\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})\b/i);
  const robotId = pick(/\brobot[_-]?id\s*=\s*([^,\s]+)/i);
  const udpPort = pick(/\b(?:control_)?udp[_-]?port\s*=\s*(\d{1,5})\b/i);
  const rssi = pick(/\brssi\s*=\s*(-?\d{1,3})\b/i);
  const wifiConnected = pick(/\bwifi_connected\s*=\s*([01])\b/i);
  const apFallback = pick(/\bap_fallback\s*=\s*([01])\b/i);
  const canArm = pick(/\bcan_arm\s*=\s*([^,\s]+)/i);
  const canMotion = pick(/\bcan_motion\s*=\s*([^,\s]+)/i);
  const canService = pick(/\bcan_service\s*=\s*([^,\s]+)/i);
  const calibWriteRequiresCom = pick(/\bcalib_write_requires_com\s*=\s*([^,\s]+)/i);

  let mode: 'off' | 'sta' | 'ap' | null = null;
  if (apFallback === '1') {
    mode = 'ap';
  } else if (wifiConnected === '1') {
    mode = 'sta';
  } else if (lower.includes('mode=sta') || lower.includes('mode:sta') || lower.includes('sta=')) {
    mode = 'sta';
  } else if (lower.includes('mode=ap') || lower.includes('mode:ap') || lower.includes('softap')) {
    mode = 'ap';
  } else if (lower.includes('wifi_off') || lower.includes('mode=off') || lower.includes('mode:off')) {
    mode = 'off';
  }

  return {
    ip,
    robotId,
    udpPort,
    rssi: rssi !== null ? Number(rssi) : null,
    mode,
    capability: {
      canArm: parseFlag(canArm),
      canMotion: parseFlag(canMotion),
      canService: parseFlag(canService),
      calibWriteRequiresCom: parseFlag(calibWriteRequiresCom),
    },
    raw: line,
  };
}

function ackRecoveryGuidance(reasonCode: number, reasonText: string) {
  switch (reasonCode) {
    case 108:
      return 'REJECTED 108 • Robot chua STA primary, hay ket noi router truoc khi ARM';
    case 107:
      return 'REJECTED 107 • Robot chua armed, bam ARM khi can_arm=1';
    case 105:
      return 'REJECTED 105 • Queue/parse loi, giam toc do gui lenh va thu lai';
    case 103:
      return 'REJECTED 103 • Lenh trung cmd_id, app se gui lenh moi';
    case 102:
      return 'REJECTED 102 • TTL het han, kiem tra network delay';
    case 100:
      return 'REJECTED 100 • Payload khong hop le, can dong bo schema';
    default:
      return `REJECTED • ${reasonText}`;
  }
}

function resolveReplyFrame(reply: Record<string, unknown>) {
  if (isRecord(reply.frame)) {
    return reply.frame;
  }
  if (isRecord(reply.data)) {
    return reply.data;
  }
  return reply;
}

function resolveReplyTag(reply: Record<string, unknown>) {
  const event = typeof reply.event === 'string' ? reply.event : '';
  const type = typeof reply.type === 'string' ? reply.type : '';
  const frame = typeof reply.frame === 'string' ? reply.frame : '';
  return (event || type || frame).trim().toLowerCase();
}

function parseAckEnvelope(reply: Record<string, unknown>) {
  const tag = resolveReplyTag(reply);
  const isAck = tag === 'control_ack' || tag === 'ack';

  const ackIdRaw = Number(reply.ack_id ?? reply.cmd_id);
  const ackId = Number.isFinite(ackIdRaw) ? ackIdRaw : null;

  const codeRaw = Number(reply.code ?? reply.reason_code);
  const code = Number.isFinite(codeRaw) ? codeRaw : null;

  const statusRaw = typeof reply.status === 'string' ? reply.status.toUpperCase() : '';
  const ok = typeof reply.ok === 'boolean'
    ? reply.ok
    : (statusRaw ? statusRaw === 'OK' : code === 0);

  const reasonText = typeof reply.msg === 'string'
    ? reply.msg
    : (typeof reply.reason_text === 'string' ? reply.reason_text : '');

  return {
    isAck,
    ackId,
    code,
    ok,
    reasonText,
  };
}

function hasTelemetryEnvelope(reply: Record<string, unknown>) {
  const ack = parseAckEnvelope(reply);
  if (ack.isAck) {
    return false;
  }

  const tag = resolveReplyTag(reply);
  return tag === 'telemetry'
    || tag === 'telemetry_update'
    || typeof reply.robot_state === 'string'
    || parseCapabilityFromRecord(reply) !== null
    || isRecord(reply.capability)
    || (isRecord(reply.payload)
      && (
        isRecord(reply.payload.capability)
        || parseCapabilityFromRecord(reply.payload) !== null
        || typeof reply.payload.robot_state === 'string'
      ));
}

export function MonolithicDashboard({
  t,
}: {
  t: AppCopy;
}) {
  const [endpoint, setEndpoint] = useState('');
  const [comPorts, setComPorts] = useState<ComPortOption[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [ping, setPing] = useState(0);
  const [signalNote, setSignalNote] = useState('No signal');
  const [connectionState, setConnectionState] = useState<ConnectionUxState>('DISCONNECTED');
  const [linkMode, setLinkMode] = useState<LinkMode>('unknown');
  const [armReady, setArmReady] = useState(false);
  const [capability, setCapability] = useState<RuntimeCapability>({
    canArm: false,
    canMotion: false,
    canService: true,
    calibWriteRequiresCom: true,
  });
  const [activeSegment, setActiveSegment] = useState<SegmentTab>('control');
  const [robotId, setRobotId] = useState('--');
  const [fwVersion, setFwVersion] = useState('--');
  const [runtimeState, setRuntimeState] = useState<'idle' | 'running' | 'hold' | 'estop' | '--'>('--');
  const [runtimeGait, setRuntimeGait] = useState<'walk' | 'trot' | 'stomp' | '--'>('--');
  const [runtimePhase, setRuntimePhase] = useState<RuntimePhase>('DETACHED');
  const [runtimeTransport, setRuntimeTransport] = useState<RuntimeTransport>('serial');
  const [runtimeTelemetry, setRuntimeTelemetry] = useState({
    battery: -1,
    velocity: 0,
    temp: 0,
    pitch: 0,
    roll: 0,
    wifiMode: 'off',
    wifiIp: '--',
    wifiRssi: 0,
    seq: 0,
  });
  const [serialLogs, setSerialLogs] = useState<SerialLogEntry[]>([]);
  const initialActiveKeys: Record<GhostKey, boolean> = {
    W: false,
    A: false,
    S: false,
    D: false,
    '1': false,
    '2': false,
    '3': false,
    '4': false,
    '5': false,
    SPACE: false,
  };
  const [activeKeys, setActiveKeys] = useState<Record<GhostKey, boolean>>(initialActiveKeys);
  const [blocks, setBlocks] = useState<MissionBlock[]>([
    { id: 'm1', label: 'Tien toi', duration: 3 },
    { id: 'm2', label: 'Re trai', duration: 1.5 },
    { id: 'm3', label: 'Dung', duration: 0.8 },
  ]);
  const [dragText, setDragText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [activeTimelineId, setActiveTimelineId] = useState<string | null>(null);
  const [actionBindings, setActionBindings] = useState<Record<ActionKey, ActionPreset>>({
    '1': 'sit',
    '2': 'butt_up',
    '3': 'jump',
    '4': 'hi',
    '5': 'stretch',
  });
  const [studioTuning, setStudioTuning] = useState<StudioTuningState>({
    stepSpeed: 50,
    bodyHeight: 52,
    jointAmplitude: 46,
  });
  const [rawCommand, setRawCommand] = useState('status');
  const [calibStep, setCalibStep] = useState(1);
  const [calibAngles, setCalibAngles] = useState<Record<CalibJointKey, number>>({
    '1h': 90,
    '1s': 90,
    '2h': 90,
    '2s': 90,
    '3h': 90,
    '3s': 90,
    '4h': 90,
    '4s': 90,
  });
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiRobotId, setWifiRobotId] = useState('RB-01');
  const [wifiUdpPort, setWifiUdpPort] = useState('9000');
  const [wifiTargetHost, setWifiTargetHost] = useState(() => getSavedRuntimeTarget().host);
  const [wifiTargetPort, setWifiTargetPort] = useState(() => getSavedRuntimeTarget().port);
  const [wifiMessage, setWifiMessage] = useState('');
  const [wifiReady, setWifiReady] = useState(false);
  const [wifiAckAt, setWifiAckAt] = useState<number | null>(null);
  const [wifiTelemetryAt, setWifiTelemetryAt] = useState<number | null>(null);
  const [wifiForwardAt, setWifiForwardAt] = useState<number | null>(null);
  const [inventory, setInventory] = useState<RobotInventoryItem[]>(() => {
    try {
      const raw = localStorage.getItem('steam_planner_robot_inventory_v1');
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as RobotInventoryItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [graphPoints, setGraphPoints] = useState<GraphPoint[]>([]);
  const [lastControlUpdate, setLastControlUpdate] = useState<string>('idle');
  const [provisionWizardStep, setProvisionWizardStep] = useState<'detect' | 'flash' | 'provision' | 'reboot' | 'discover' | 'done'>('detect');
  const isTimelineRunningRef = useRef(false);
  const timelineAbortRef = useRef<AbortController | null>(null);
  const logIdRef = useRef(0);
  const lastProcessedSignalAtRef = useRef(0);
  const lastProcessedAckAtRef = useRef(0);
  const sliderDebounceRef = useRef<{
    speed: number | null;
    height: number | null;
    amplitude: number | null;
  }>({
    speed: null,
    height: null,
    amplitude: null,
  });
  const graphWindowMs = 8000;
  const watchdogTimeoutMs = parseEnvInt('VITE_WATCHDOG_TIMEOUT_MS', 1500, 300, 10000);
  const heartbeatIntervalMs = parseEnvInt('VITE_WATCHDOG_HEARTBEAT_MS', 300, 120, 2000);
  const fallbackBudgetMs = parseEnvInt('VITE_WATCHDOG_FALLBACK_MS', 3000, 500, 10000);
  const serialLinkTimeoutMs = parseEnvInt('VITE_SERIAL_LINK_TIMEOUT_MS', 15000, 3000, 120000);
  const disableLinkTimeout = parseEnvBool('VITE_DISABLE_LINK_TIMEOUT', false);
  const strictAckConnected = parseEnvBool('VITE_WIFI_STRICT_ACK', false);
  const watchdogHeartbeatAction = parseEnvString('VITE_WATCHDOG_HEARTBEAT_ACTION', '').toLowerCase();
  const heartbeatActionCandidates = useMemo(() => {
    if (!watchdogHeartbeatAction) {
      return [] as string[];
    }

    const parsed = watchdogHeartbeatAction
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);

    const safeActions = new Set(['heartbeat', 'status']);
    const unique = [...new Set(parsed)].filter((item) => safeActions.has(item));
    if (!unique.includes('heartbeat')) {
      unique.unshift('heartbeat');
    }
    if (!unique.includes('status')) {
      unique.push('status');
    }

    return unique;
  }, [watchdogHeartbeatAction]);
  const ackFreshnessMs = watchdogTimeoutMs;
  const heartbeatTimeoutLimit = Math.max(2, Math.ceil(fallbackBudgetMs / heartbeatIntervalMs));
  const isDesktopRuntime = Boolean(window.desktopRuntime?.isDesktop);
  const nextCmdIdRef = useRef(1000);
  const lastControlAtRef = useRef(0);
  const heartbeatTickRef = useRef(0);
  const heartbeatInFlightRef = useRef(false);
  const hasMotionIntentRef = useRef(false);
  const wifiTimeoutStreakRef = useRef(0);
  const watchdogFallbackLatchedRef = useRef(false);
  const activeHeartbeatActionIndexRef = useRef(0);
  const heartbeatProbeFailureStreakRef = useRef(0);
  const lastHeartbeatCmdIdRef = useRef<number | null>(null);
  const heartbeatMalformedStreakRef = useRef(0);
  const heartbeatDisabledRef = useRef(false);
  const serialSessionConnectedRef = useRef(false);
  const activeKeysRef = useRef<Record<GhostKey, boolean>>(initialActiveKeys);
  const serialCommandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSerialOfflineWarnAtRef = useRef(0);
  const lastStopSentAtRef = useRef(0);
  const connectionStateRef = useRef<ConnectionUxState>('DISCONNECTED');
  const armReadyRef = useRef(false);
  const capabilityRef = useRef<RuntimeCapability>({
    canArm: false,
    canMotion: false,
    canService: true,
    calibWriteRequiresCom: true,
  });
  const lastCapabilitySnapshotRef = useRef('');
  const ackWindowMs = parseEnvInt('VITE_WIFI_ACK_WINDOW_MS', 1100, 300, 5000);
  const telemetryFreshMs = parseEnvInt('VITE_WIFI_TELEMETRY_FRESH_MS', 1800, 500, 8000);
  const degradedMs = parseEnvInt('VITE_WIFI_DEGRADED_MS', 5000, 1000, 15000);

  useEffect(() => {
    localStorage.setItem('steam_planner_robot_inventory_v1', JSON.stringify(inventory));
  }, [inventory]);

  useEffect(() => {
    localStorage.setItem(
      'steam_planner_runtime_udp_target_v1',
      JSON.stringify({
        host: wifiTargetHost.trim(),
        port: wifiTargetPort.trim() || '9000',
      }),
    );
  }, [wifiTargetHost, wifiTargetPort]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    armReadyRef.current = armReady;
  }, [armReady]);

  useEffect(() => {
    capabilityRef.current = capability;
  }, [capability]);

  useEffect(() => {
    const snapshot = `can_arm=${capability.canArm ? 1 : 0} can_motion=${capability.canMotion ? 1 : 0} can_service=${capability.canService ? 1 : 0} calib_write_requires_com=${capability.calibWriteRequiresCom ? 1 : 0}`;
    if (snapshot === lastCapabilitySnapshotRef.current) {
      return;
    }

    lastCapabilitySnapshotRef.current = snapshot;
    appendLog('RX', `CAPABILITY ${snapshot}`);
  }, [capability]);

  const availableSegments = ['control', 'studio', 'calib', 'wifi', 'log'] as SegmentTab[];

  useEffect(() => {
    if (availableSegments.includes(activeSegment)) {
      return;
    }
    setActiveSegment(availableSegments[0]);
  }, [activeSegment, availableSegments]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const ackAge = wifiAckAt === null ? Number.POSITIVE_INFINITY : now - wifiAckAt;
      const telemetryAge = wifiTelemetryAt === null ? Number.POSITIVE_INFINITY : now - wifiTelemetryAt;
      const hasAnyEvidence = Number.isFinite(ackAge) || Number.isFinite(telemetryAge);
      const ackFresh = ackAge <= ackWindowMs;
      const telemetryFresh = telemetryAge <= telemetryFreshMs;
      const evidenceFresh = Math.min(ackAge, telemetryAge) <= degradedMs;

      if (ackFresh && telemetryFresh) {
        setConnectionState(linkMode === 'ap_fallback' ? 'READY_AP_FALLBACK' : 'READY_STA_PRIMARY');
        return;
      }

      if (ackFresh) {
        setConnectionState('LINK_REACHABLE');
        return;
      }

      if (hasAnyEvidence && evidenceFresh) {
        setConnectionState('DEGRADED');
        return;
      }

      setConnectionState('DISCONNECTED');
    }, 150);

    return () => {
      window.clearInterval(timer);
    };
  }, [linkMode, wifiAckAt, wifiTelemetryAt]);

  useEffect(() => {
    if (connectionState === 'DISCONNECTED') {
      return;
    }

    let alive = true;
    const timer = window.setInterval(() => {
      if (!alive) {
        return;
      }

      void (async () => {
        const statusResult = await dispatchFirmwareAction('status', nextCommandId(), undefined);
        applyUdpResult(statusResult);
      })();
    }, 500);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [connectionState]);

  useEffect(() => {
    if (wifiReady) {
      return;
    }

    if (connectionState === 'READY_AP_FALLBACK' || connectionState === 'READY_STA_PRIMARY' || connectionState === 'LINK_REACHABLE') {
      setWifiReady(true);
      setWifiMessage('Wi-Fi link detected. Runtime control is now signal-enabled.');
    }
  }, [connectionState, wifiReady]);

  const upsertInventoryItem = (partial: Partial<RobotInventoryItem> & { robotId: string }) => {
    setInventory((current) => {
      const now = Date.now();
      const idx = current.findIndex((item) => item.robotId === partial.robotId);
      const base: RobotInventoryItem = idx >= 0
        ? current[idx]
        : {
            robotId: partial.robotId,
            chipMac: '--',
            firmwareVersion: '--',
            controlUdpPort: '9000',
            lastKnownIp: '--',
            healthState: 'service_required',
            wifiReady: false,
            lastServiceAt: now,
          };
      const nextItem: RobotInventoryItem = {
        ...base,
        ...partial,
        lastServiceAt: now,
      };

      if (idx >= 0) {
        const cloned = [...current];
        cloned[idx] = nextItem;
        return cloned;
      }

      return [nextItem, ...current].slice(0, 20);
    });
  };

  useEffect(() => {
    activeHeartbeatActionIndexRef.current = 0;
    heartbeatProbeFailureStreakRef.current = 0;
    heartbeatMalformedStreakRef.current = 0;
    heartbeatDisabledRef.current = false;
  }, [watchdogHeartbeatAction]);

  const effectiveHeartbeatActions = heartbeatActionCandidates;

  const nextCommandId = () => {
    nextCmdIdRef.current += 1;
    return nextCmdIdRef.current;
  };

  const sendWifiHeartbeat = async () => {
    if (effectiveHeartbeatActions.length === 0) {
      return;
    }

    if (heartbeatDisabledRef.current) {
      return;
    }

    if (heartbeatInFlightRef.current) {
      return;
    }
    heartbeatInFlightRef.current = true;

    try {
      heartbeatTickRef.current += 1;
      const now = Date.now();
      const heartbeatTtlMs = Math.max(3000, watchdogTimeoutMs * 3);
      const heartbeatAction = effectiveHeartbeatActions[Math.min(activeHeartbeatActionIndexRef.current, effectiveHeartbeatActions.length - 1)] || effectiveHeartbeatActions[0];
      const heartbeatEnvelope: Record<string, unknown> = {
        schema_v: 1,
        cmd_id: nextCommandId(),
        cmd_type: heartbeatAction === 'arm' || heartbeatAction === 'hold' || heartbeatAction === 'stop' || heartbeatAction === 'estop'
          ? 'system'
          : 'config',
        source: 'wifi',
        ttl_ms: heartbeatTtlMs,
        ack_required: true,
        ts_client: now,
        payload: {
          action: heartbeatAction,
          lease_ms: watchdogTimeoutMs,
        },
      };

      const envelopeCmdId = Number(heartbeatEnvelope.cmd_id);
      lastHeartbeatCmdIdRef.current = Number.isFinite(envelopeCmdId) ? envelopeCmdId : null;

      const hbResult = await sendRobotCommand(heartbeatEnvelope, { awaitReply: true });
      applyUdpResult(hbResult, { fromHeartbeat: true });
    } finally {
      heartbeatInFlightRef.current = false;
    }
  };

  const appendLog = (direction: 'TX' | 'RX', text: string) => {
    logIdRef.current += 1;
    const next: SerialLogEntry = {
      id: logIdRef.current,
      ts: Date.now(),
      direction,
      text,
    };

    setSerialLogs((current) => {
      const merged = [next, ...current];
      return merged.length > 500 ? merged.slice(0, 500) : merged;
    });
  };

  const logWatchdogEvent = (event: string, detail?: string) => {
    const message = detail ? `WDG ${event} • ${detail}` : `WDG ${event}`;
    appendLog('RX', message);
  };

  const markControlUpdate = (label: string) => {
    lastControlAtRef.current = Date.now();
    setLastControlUpdate(`${label} @ ${new Date().toLocaleTimeString('en-GB', { hour12: false })}`);
  };

  const applyUdpResult = (result: UdpGatewayResult, options?: { appendAck?: boolean; fromHeartbeat?: boolean }) => {
    const triggerWatchdogFallback = () => {
      if (watchdogFallbackLatchedRef.current) {
        return;
      }
      watchdogFallbackLatchedRef.current = true;

      logWatchdogEvent('fallback_error', `streak=${wifiTimeoutStreakRef.current}`);
      setRuntimePhase('ERROR');
      setRuntimeTransport('wifi');
      setRuntimeTelemetry((current) => ({
        ...current,
        wifiMode: 'off',
      }));
      setSignalNote('WATCHDOG DEGRADED • NO FALLBACK');
    };

    if (!result.ok) {
      if (options?.fromHeartbeat) {
        wifiTimeoutStreakRef.current += 1;
        logWatchdogEvent('hb_error', `${wifiTimeoutStreakRef.current}/${heartbeatTimeoutLimit}`);
        if (wifiTimeoutStreakRef.current >= heartbeatTimeoutLimit) {
          triggerWatchdogFallback();
        } else {
          setSignalNote(`WATCHDOG WARNING • heartbeat error (${wifiTimeoutStreakRef.current}/${heartbeatTimeoutLimit})`);
        }
      }
      return;
    }

    setWifiForwardAt(Date.now());

    if (options?.fromHeartbeat && result.forwardedWithoutReply) {
      wifiTimeoutStreakRef.current += 1;
      logWatchdogEvent('hb_no_ack', `${wifiTimeoutStreakRef.current}/${heartbeatTimeoutLimit}`);
      setSignalNote(`WATCHDOG WARNING • forwarded-only (${wifiTimeoutStreakRef.current}/${heartbeatTimeoutLimit})`);

      if (wifiTimeoutStreakRef.current >= heartbeatTimeoutLimit) {
        triggerWatchdogFallback();
      }

      if (wifiAckAt !== null) {
        setPing(Math.max(0, Date.now() - wifiAckAt));
      }
      return;
    }

    if (result.udpReply) {
      if (options?.appendAck && typeof result.replyCount === 'number' && result.replyCount > 1) {
        appendLog('RX', `UDP bundle frames=${result.replyCount}`);
      }

      const primaryReply = resolveReplyFrame(result.udpReply);
      const supplementalReplies = Array.isArray(result.udpReplies)
        ? result.udpReplies
            .slice(1)
            .map((entry) => (entry.udpReply ? resolveReplyFrame(entry.udpReply) : null))
            .filter((entry): entry is Record<string, unknown> => entry !== null)
        : [];
      const allReplies = [primaryReply, ...supplementalReplies];
      const ackNow = Date.now();

      setRuntimeTransport('wifi');
      setRuntimePhase((current) => (current === 'ERROR' || current === 'DETACHED' ? 'WIFI_PRIMARY' : current));
      setRuntimeTelemetry((current) => ({ ...current, wifiMode: 'sta' }));

      const applyCapabilityPatch = (candidate: unknown) => {
        const parsed = parseCapabilityFromRecord(candidate);
        if (!parsed) {
          return;
        }
        setCapability((current) => ({
          ...current,
          ...parsed,
        }));
      };

      for (const frame of allReplies) {
        const linkModeRaw = typeof frame.link_mode === 'string' ? frame.link_mode.toLowerCase() : '';
        if (linkModeRaw === 'ap_fallback' || linkModeRaw === 'sta_primary') {
          setLinkMode(linkModeRaw);
        }

        const phase = typeof frame.phase === 'string' ? frame.phase.toUpperCase() : '';
        if (phase === 'DETACHED' || phase === 'USB_ONLY' || phase === 'PROVISIONING' || phase === 'WIFI_PRIMARY' || phase === 'SERIAL_FALLBACK' || phase === 'ERROR') {
          setRuntimePhase(phase as RuntimePhase);
        }

        const transport = typeof frame.transport === 'string' ? frame.transport.toLowerCase() : '';
        if (transport === 'wifi' || transport === 'serial') {
          setRuntimeTransport(transport as RuntimeTransport);
        }

        if (!hasTelemetryEnvelope(frame)) {
          continue;
        }

        setWifiTelemetryAt(ackNow);
        const robotState = String(frame.robot_state ?? '').toLowerCase();
        if (robotState === 'idle' || robotState === 'running' || robotState === 'hold' || robotState === 'estop') {
          setRuntimeState(robotState);
          if (robotState === 'running') {
            setArmReady(true);
          }
          if (robotState === 'hold' || robotState === 'estop') {
            setArmReady(false);
          }
        }

        const velocity = Number(frame.velocity);
        const temp = Number(frame.body_temperature);
        const battery = Number(frame.battery_percent);
        const rssi = Number(frame.wifi_rssi);
        setRuntimeTelemetry((current) => ({
          ...current,
          velocity: Number.isFinite(velocity) ? velocity : current.velocity,
          temp: Number.isFinite(temp) ? temp : current.temp,
          battery: Number.isFinite(battery) ? battery : current.battery,
          wifiRssi: Number.isFinite(rssi) ? rssi : current.wifiRssi,
        }));

        applyCapabilityPatch(frame);
        applyCapabilityPatch(frame.capability);

        const payload = frame.payload;
        if (isRecord(payload)) {
          applyCapabilityPatch(payload);
          applyCapabilityPatch(payload.capability);
          const ip = typeof payload.ip === 'string' ? payload.ip : null;
          const mode = typeof payload.mode === 'string' ? payload.mode.toLowerCase() : null;
          const payloadRssi = Number(payload.rssi);
          setRuntimeTelemetry((current) => ({
            ...current,
            wifiIp: ip ?? current.wifiIp,
            wifiMode: mode ?? current.wifiMode,
            wifiRssi: Number.isFinite(payloadRssi) ? payloadRssi : current.wifiRssi,
          }));
        }
      }

      const ackFrame = allReplies.find((entry) => parseAckEnvelope(entry).isAck) ?? null;
      if (!ackFrame) {
        if (options?.fromHeartbeat) {
          wifiTimeoutStreakRef.current += 1;
          logWatchdogEvent('hb_no_ack_frame', `${wifiTimeoutStreakRef.current}/${heartbeatTimeoutLimit}`);
          if (wifiTimeoutStreakRef.current >= heartbeatTimeoutLimit) {
            triggerWatchdogFallback();
          }
        }

        if (wifiAckAt !== null) {
          setPing(Math.max(0, Date.now() - wifiAckAt));
        }
        return;
      }

      const ackEnvelope = parseAckEnvelope(ackFrame);
      const reasonCode = Number.isFinite(ackEnvelope.code) ? Number(ackEnvelope.code) : Number(ackFrame.reason_code);
      const status = ackEnvelope.ok ? 'OK' : 'ERROR';
      const reasonText = reasonCodeLabel(
        Number.isFinite(reasonCode) ? reasonCode : 0,
        ackEnvelope.reasonText,
      );
      const ackId = Number(ackEnvelope.ackId);
      const hasAckId = Number.isFinite(ackId);

      if (options?.appendAck) {
        appendLog(
          'RX',
          `ACK ${status} id=${Number.isFinite(ackId) ? String(ackId) : '-'} code=${Number.isFinite(reasonCode) ? reasonCode : 0} reason=${reasonText}`,
        );
      }

      if (status !== 'OK') {
        const normalizedReasonCode = Number.isFinite(reasonCode) ? reasonCode : -1;
        setSignalNote(ackRecoveryGuidance(normalizedReasonCode, reasonText));
        if (options?.fromHeartbeat) {
          wifiTimeoutStreakRef.current += 1;
          logWatchdogEvent('hb_reject', `${wifiTimeoutStreakRef.current}/${heartbeatTimeoutLimit} ${reasonText}`);

          if (Number.isFinite(reasonCode) && reasonCode === 0x05) {
            heartbeatMalformedStreakRef.current += 1;
            if (heartbeatMalformedStreakRef.current >= 3) {
              heartbeatDisabledRef.current = true;
              logWatchdogEvent('hb_disabled_malformed', `count=${heartbeatMalformedStreakRef.current}`);
              setSignalNote('WATCHDOG HEARTBEAT DISABLED • malformed');
            }
          }
        }
        return;
      }

      setWifiAckAt(ackNow);
      if (options?.fromHeartbeat) {
        heartbeatMalformedStreakRef.current = 0;
      }

      if (options?.fromHeartbeat) {
        const expectedAckId = lastHeartbeatCmdIdRef.current;
        if (expectedAckId === null || !hasAckId || ackId !== expectedAckId) {
          wifiTimeoutStreakRef.current += 1;
          logWatchdogEvent(
            'hb_ack_unmatched',
            `got=${hasAckId ? String(ackId) : '-'} expected=${expectedAckId ?? '-'} ${wifiTimeoutStreakRef.current}/${heartbeatTimeoutLimit}`,
          );
          setSignalNote(`WATCHDOG WARNING • ACK unmatched (${wifiTimeoutStreakRef.current}/${heartbeatTimeoutLimit})`);
          if (wifiTimeoutStreakRef.current >= heartbeatTimeoutLimit) {
            triggerWatchdogFallback();
          }
          return;
        }
      }

      const recoveredFrom = wifiTimeoutStreakRef.current;
      wifiTimeoutStreakRef.current = 0;
      watchdogFallbackLatchedRef.current = false;
      if (options?.fromHeartbeat && recoveredFrom > 0) {
        logWatchdogEvent('hb_recovered', `after_streak=${recoveredFrom}`);
      }
      setSignalNote('ONLINE • WIFI_PRIMARY • ACK');

      const watchdogAgeMs = Number(ackFrame.watchdog_age_ms ?? primaryReply.watchdog_age_ms);
      if (Number.isFinite(watchdogAgeMs) && watchdogAgeMs >= 0) {
        setPing(Math.floor(watchdogAgeMs));

        if (options?.fromHeartbeat) {
          if (watchdogAgeMs > watchdogTimeoutMs * 2) {
            heartbeatProbeFailureStreakRef.current += 1;
          } else {
            heartbeatProbeFailureStreakRef.current = 0;
          }

          if (heartbeatProbeFailureStreakRef.current >= 3 && activeHeartbeatActionIndexRef.current < effectiveHeartbeatActions.length - 1) {
            activeHeartbeatActionIndexRef.current += 1;
            heartbeatProbeFailureStreakRef.current = 0;
            const nextAction = effectiveHeartbeatActions[activeHeartbeatActionIndexRef.current] || 'status';
            logWatchdogEvent('hb_action_switch', nextAction);
            setSignalNote(`WATCHDOG RETUNE • action=${nextAction}`);
          }
        }
      } else if (wifiAckAt !== null) {
        setPing(Math.max(0, Date.now() - wifiAckAt));
      }
      return;
    }

    if (result.replyTimedOut) {
      if (options?.fromHeartbeat) {
        wifiTimeoutStreakRef.current += 1;
        logWatchdogEvent('hb_timeout', `${wifiTimeoutStreakRef.current}/${heartbeatTimeoutLimit}`);
      }

      if (strictAckConnected && wifiTimeoutStreakRef.current >= heartbeatTimeoutLimit) {
        triggerWatchdogFallback();
      } else {
        setRuntimeTransport('wifi');
        setRuntimePhase((current) => (current === 'ERROR' || current === 'DETACHED' ? 'WIFI_PRIMARY' : current));
        setRuntimeTelemetry((current) => ({
          ...current,
          wifiMode: current.wifiMode === 'off' ? 'sta' : current.wifiMode,
        }));
        setSignalNote(`WATCHDOG WARNING • waiting ACK (${wifiTimeoutStreakRef.current}/${heartbeatTimeoutLimit})`);
      }

      if (wifiAckAt !== null) {
        setPing(Math.max(0, Date.now() - wifiAckAt));
      }
      return;
    }

    if (result.forwardedTo) {
      setRuntimeTransport('wifi');
      setRuntimePhase((current) => (current === 'ERROR' || current === 'DETACHED' ? 'WIFI_PRIMARY' : current));
      setRuntimeTelemetry((current) => ({
        ...current,
        wifiMode: current.wifiMode === 'off' ? 'sta' : current.wifiMode,
      }));
      setSignalNote(`UDP forwarded -> ${result.forwardedTo}`);
    }
  };

  const issueFirmwareAction = async (action: FirmwareAction, value?: number) => {
    const motionAllowedStates: ConnectionUxState[] = ['LINK_REACHABLE', 'READY_AP_FALLBACK', 'READY_STA_PRIMARY', 'DEGRADED'];
    const motionActions: FirmwareAction[] = ['forward', 'backward', 'left', 'right', 'walk', 'trot', 'stomp', 'sit', 'stretch', 'butt_up', 'jump', 'hi', 'speed', 'height'];
    const capabilityStale = wifiTelemetryAt === null || (Date.now() - wifiTelemetryAt) > (telemetryFreshMs * 2);
    const canArmByFallback = connectionStateRef.current !== 'DISCONNECTED' && capabilityStale;
    const canMotionByFallback = connectionStateRef.current !== 'DISCONNECTED' && armReadyRef.current && capabilityStale;
    if (action === 'arm' && connectionStateRef.current === 'DISCONNECTED') {
      appendLog('RX', `ACK REJECTED link_not_ready action=${action} state=${connectionStateRef.current}`);
      setSignalNote('ARM blocked • Wi-Fi link disconnected');
      return;
    }

    if (action === 'arm' && !capabilityRef.current.canArm && !canArmByFallback) {
      appendLog('RX', `ACK REJECTED capability.can_arm=false action=${action}`);
      setSignalNote('ARM blocked • can_arm=false (yeu cau STA primary)');
      return;
    }

    if (action === 'arm' && !capabilityRef.current.canArm && canArmByFallback) {
      appendLog('RX', 'ARM FALLBACK • telemetry/capability stale, validating by firmware ACK');
      setSignalNote('ARM fallback • cho ACK firmware xac nhan');
    }

    if (motionActions.includes(action)) {
      if (!motionAllowedStates.includes(connectionStateRef.current)) {
        appendLog('RX', `ACK REJECTED link_not_ready action=${action} state=${connectionStateRef.current}`);
        setSignalNote('Runtime blocked • link not reachable yet');
        return;
      }

      if (!armReadyRef.current) {
        appendLog('RX', `ACK REJECTED not_armed action=${action}`);
        setSignalNote('ARM required before motion/action');
        return;
      }

      if (!capabilityRef.current.canMotion && !canMotionByFallback) {
        appendLog('RX', `ACK REJECTED capability.can_motion=false action=${action}`);
        setSignalNote('Motion blocked • can_motion=false');
        return;
      }

      if (!capabilityRef.current.canMotion && canMotionByFallback) {
        appendLog('RX', `MOTION FALLBACK • capability stale action=${action}`);
        setSignalNote('Motion fallback • validating by firmware ACK');
      }
    }

    const isSafetyAction = action === 'estop' || action === 'stop' || action === 'hold' || action === 'arm';
    if (runtimePhase === 'PROVISIONING' && !isSafetyAction) {
      const reason = 'prov_locked';
      appendLog('RX', `ACK REJECTED ${reason}`);
      setSignalNote(`REJECTED • ${reason}`);
      return;
    }

    const cmdId = nextCommandId();
    const udpResult = await dispatchFirmwareAction(action, cmdId, value);

    markControlUpdate(formatControlLabel(action, value));
    if ('error' in udpResult) {
      appendLog('RX', `ERR UDP: ${udpResult.error}`);
      setSignalNote(`Error: ${udpResult.error}`);
      return;
    }

    const replyFrames: Record<string, unknown>[] = [];
    if (udpResult.udpReply) {
      replyFrames.push(resolveReplyFrame(udpResult.udpReply));
    }
    if (Array.isArray(udpResult.udpReplies)) {
      for (let i = 1; i < udpResult.udpReplies.length; i += 1) {
        const entry = udpResult.udpReplies[i];
        if (entry?.udpReply) {
          replyFrames.push(resolveReplyFrame(entry.udpReply));
        }
      }
    }

    const ackCandidates = replyFrames
      .map((frame) => parseAckEnvelope(frame))
      .filter((ack) => ack.isAck);
    const matchedAck = ackCandidates.find((ack) => ack.ackId === cmdId) ?? null;

    if (!matchedAck && ackCandidates.length > 0) {
      const firstAck = ackCandidates[0];
      appendLog('RX', `ACK WARN unmatched ack_id=${firstAck.ackId ?? '-'} cmd_id=${cmdId}`);
      setSignalNote('ACK mismatch • command not confirmed');
    }

    const isAckOk = Boolean(
      matchedAck
      && matchedAck.ok
      && matchedAck.code === 0,
    );

    if (isAckOk && action === 'arm') {
      setArmReady(true);
    }
    if (isAckOk && (action === 'hold' || action === 'estop' || action === 'clear_estop')) {
      setArmReady(false);
    }

    applyUdpResult(udpResult, { appendAck: true });
  };

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    if (effectiveHeartbeatActions.length === 0) {
      return;
    }

    if (runtimePhase === 'ERROR') {
      return;
    }

    const hasWifiPrimary = runtimePhase === 'WIFI_PRIMARY' || runtimeTransport === 'wifi' || runtimeTelemetry.wifiMode === 'sta';
    if (!hasWifiPrimary) {
      return;
    }

    let alive = true;
    const timer = window.setInterval(() => {
      if (!alive) {
        return;
      }

      void sendWifiHeartbeat();
    }, heartbeatIntervalMs);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [effectiveHeartbeatActions.length, heartbeatIntervalMs, isDesktopRuntime, runtimePhase, runtimeTelemetry.wifiMode, runtimeTransport, watchdogHeartbeatAction]);

  useEffect(() => {
    const heartbeatLabel = effectiveHeartbeatActions.length > 0
      ? `${heartbeatIntervalMs}ms action=${effectiveHeartbeatActions.join('|')}`
      : 'disabled';
    appendLog('RX', `WDG config • timeout=${watchdogTimeoutMs}ms • heartbeat=${heartbeatLabel} • fallback_budget=${fallbackBudgetMs}ms • streak_limit=${heartbeatTimeoutLimit}`);
  }, [effectiveHeartbeatActions, fallbackBudgetMs, heartbeatIntervalMs, heartbeatTimeoutLimit, watchdogHeartbeatAction, watchdogTimeoutMs]);

  const issueSerialCommand = async (command: string | Record<string, unknown>, label?: string) => {
    const commandText = typeof command === 'string' ? command : JSON.stringify(command);

    const serialServiceAvailable = isDesktopRuntime && serialSessionConnectedRef.current && isOnline;
    if (!serialServiceAvailable) {
      const now = Date.now();
      if (now - lastSerialOfflineWarnAtRef.current > 1500) {
        appendLog('RX', 'ERR SEND: COM service unavailable');
        setSignalNote('COM service unavailable');
        lastSerialOfflineWarnAtRef.current = now;
      }
      return false;
    }

    const run = async () => {
      const result = await sendSerialCommand(command);
      if (result.ok) {
        markControlUpdate(label ?? (typeof command === 'string' ? command : 'json-cmd'));
        appendLog('TX', commandText);
        return true;
      }

      appendLog('RX', `ERR SEND: ${result.error}`);
      setSignalNote(`Error: ${result.error}`);
      return false;
    };

    const queuedResult = serialCommandQueueRef.current.then(run, run);
    serialCommandQueueRef.current = queuedResult.then(() => undefined, () => undefined);
    return queuedResult;
  };

  const requireComService = (actionLabel: string) => {
    if (isComServiceReady) {
      return true;
    }

    const message = `${actionLabel}: COM service offline, bam KET NOI COM truoc`;
    setWifiMessage(message);
    setSignalNote('COM service offline');
    return false;
  };

  const requireWizardStep = (required: typeof provisionWizardStep, actionLabel: string) => {
    if (provisionWizardStep === required) {
      return true;
    }

    setWifiMessage(`${actionLabel}: sai buoc wizard (hien tai ${provisionWizardStep.toUpperCase()})`);
    return false;
  };

  const issueSerialCommandOrThrow = async (command: string | Record<string, unknown>, label: string) => {
    const ok = await issueSerialCommand(command, label);
    if (!ok) {
      throw new Error('serial command failed');
    }
  };

  const debounceSliderCommand = (key: 'speed' | 'height' | 'amplitude', callback: () => Promise<void>) => {
    const current = sliderDebounceRef.current[key];
    if (current !== null) {
      window.clearTimeout(current);
    }

    sliderDebounceRef.current[key] = window.setTimeout(() => {
      sliderDebounceRef.current[key] = null;
      void callback();
    }, 100);
  };

  const jogCalibrationJoint = async (joint: CalibJointKey, delta: number) => {
    const command = `jog_${joint}=${delta.toFixed(1)}`;
    await issueSerialCommand(command, command);
    setCalibAngles((current) => ({
      ...current,
      [joint]: Number((current[joint] + delta).toFixed(1)),
    }));
  };

  const setCalibrationJointAbsolute = async (joint: CalibJointKey, value: number) => {
    const clamped = Math.max(0, Math.min(180, value));
    const command = `cal_${joint}=${clamped.toFixed(1)}`;
    setCalibAngles((current) => ({ ...current, [joint]: clamped }));
    await issueSerialCommand(command, command);
  };

  const runWifiProvisioning = async () => {
    const ssid = wifiSsid.trim();
    const password = wifiPassword.trim();
    const robot = wifiRobotId.trim();
    const port = wifiUdpPort.trim();

    if (!ssid) {
      setWifiMessage('SSID is required');
      return;
    }

    if (password.length < 8) {
      setWifiMessage('Password must be at least 8 characters');
      return;
    }

    if (!robot) {
      setWifiMessage('Robot ID is required');
      return;
    }

    if (!/^\d+$/.test(port)) {
      setWifiMessage('UDP Port must be numeric');
      return;
    }

    try {
      setWifiMessage('Saving provisioning...');
      await issueSerialCommandOrThrow(`prov wifi_ssid=${ssid}`, 'wizard:prov:ssid');
      await issueSerialCommandOrThrow(`prov wifi_password=${password}`, 'wizard:prov:password');
      await issueSerialCommandOrThrow(`prov robot_id=${robot}`, 'wizard:prov:robot_id');
      await issueSerialCommandOrThrow(`prov control_udp_port=${port}`, 'wizard:prov:udp_port');
      await issueSerialCommandOrThrow('prov save', 'wizard:prov:save');
      setWifiMessage('Config saved. Reading link status...');

      for (let i = 0; i < 4; i += 1) {
        await issueSerialCommandOrThrow('link_status', 'wizard:prov:link_status');
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 450);
        });
      }

      setWifiReady(true);
      setProvisionWizardStep('reboot');
      upsertInventoryItem({
        robotId: robot,
        firmwareVersion: fwVersion,
        controlUdpPort: port,
        lastKnownIp: runtimeTelemetry.wifiIp,
        healthState: 'wifi_ready',
        wifiReady: true,
      });
      setSignalNote('Provision done • reboot robot to apply and discover IP');
      setWifiMessage('Provision saved. Robot marked Wi-Fi-ready.');
    } catch {
      setWifiMessage('Provisioning failed. Check COM link and try again.');
    }
  };

  const runServiceWizardDetect = async () => {
    setWifiMessage('Wizard: Detecting robot over COM...');
    try {
      await issueSerialCommandOrThrow('status', 'wizard:detect:status');
      await issueSerialCommandOrThrow('link_status', 'wizard:detect:link_status');
      setProvisionWizardStep('flash');
      setWifiMessage('Wizard Detect done. Flash firmware if needed, then continue.');
    } catch {
      setWifiMessage('Wizard Detect failed. Check COM connection.');
    }
  };

  const markServiceWizardFlashDone = () => {
    setProvisionWizardStep('provision');
    setWifiMessage('Wizard Flash done. Continue provisioning credentials.');
  };

  const runServiceWizardReboot = async () => {
    setWifiMessage('Wizard: Rebooting robot...');
    try {
      await issueSerialCommandOrThrow('reboot', 'wizard:reboot');
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1200);
      });
      setProvisionWizardStep('discover');
      setWifiMessage('Wizard reboot sent. Discovering robot IP...');
    } catch {
      setWifiMessage('Wizard reboot failed. Check COM connection.');
    }
  };

  const runServiceWizardDiscover = async () => {
    let discoveredIp = runtimeTelemetry.wifiIp;
    try {
      for (let i = 0; i < 6; i += 1) {
        await issueSerialCommandOrThrow('link_status', 'wizard:discover:link_status');
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 600);
        });
        discoveredIp = runtimeTelemetry.wifiIp;
        if (discoveredIp !== '--' && discoveredIp !== '0.0.0.0') {
          break;
        }
      }
    } catch {
      setWifiMessage('Wizard discover failed. Check COM connection.');
      return;
    }

    if (discoveredIp !== '--' && discoveredIp !== '0.0.0.0') {
      setProvisionWizardStep('done');
      setWifiMessage(`Wizard done. Robot IP discovered: ${discoveredIp}`);
      setSignalNote('Service wizard complete • Wi-Fi runtime ready');
      return;
    }

    setWifiMessage('Wizard discover pending. Keep robot on router and retry discover.');
  };

  const movementMap: Record<typeof movementKeys[number], FirmwareAction> = {
    W: 'forward',
    A: 'left',
    S: 'backward',
    D: 'right',
  };

  const handleControlKeyDown = (mapped: GhostKey, isRepeat = false) => {
    if (isRepeat) {
      return;
    }

    const motionAllowedStates: ConnectionUxState[] = ['LINK_REACHABLE', 'READY_AP_FALLBACK', 'READY_STA_PRIMARY', 'DEGRADED'];
    if (mapped !== 'SPACE' && !motionAllowedStates.includes(connectionStateRef.current)) {
      setSignalNote('Runtime key blocked • link not reachable');
      return;
    }

    if (activeKeysRef.current[mapped]) {
      return;
    }

    activeKeysRef.current = {
      ...activeKeysRef.current,
      [mapped]: true,
    };

    appendLog('TX', `KEY_DOWN ${mapped}`);

    setActiveKeys((current) => ({ ...current, [mapped]: true }));

    if (mapped === 'W' || mapped === 'A' || mapped === 'S' || mapped === 'D') {
      void issueFirmwareAction(movementMap[mapped]);
    }

    if (isActionKey(mapped)) {
      void issueFirmwareAction(actionBindings[mapped]);
    }

    if (mapped === 'SPACE') {
      void issueFirmwareAction('stop');
    }
  };

  const handleControlKeyUp = (mapped: GhostKey) => {
    if (!activeKeysRef.current[mapped]) {
      return;
    }

    activeKeysRef.current = {
      ...activeKeysRef.current,
      [mapped]: false,
    };

    appendLog('TX', `KEY_UP ${mapped}`);
    setActiveKeys((current) => ({ ...current, [mapped]: false }));

    if (mapped === 'W' || mapped === 'A' || mapped === 'S' || mapped === 'D') {
      const stillMoving = activeKeysRef.current.W || activeKeysRef.current.A || activeKeysRef.current.S || activeKeysRef.current.D;
      if (!stillMoving) {
        const now = Date.now();
        if (now - lastStopSentAtRef.current >= 90) {
          lastStopSentAtRef.current = now;
          appendLog('TX', 'stop');
          void issueFirmwareAction('stop');
        }
      }
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mapped = normalizeKey(event.key) ?? normalizeCode(event.code);
      if (!mapped) {
        return;
      }
      handleControlKeyDown(mapped, event.repeat);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const mapped = normalizeKey(event.key) ?? normalizeCode(event.code);
      if (!mapped) {
        return;
      }
      handleControlKeyUp(mapped);
    };

    const onBlur = () => {
      activeKeysRef.current = { ...initialActiveKeys };
      setActiveKeys({ ...initialActiveKeys });

      appendLog('TX', 'stop');
      void issueFirmwareAction('stop');
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [actionBindings]);

  useEffect(() => {
    if (isDesktopRuntime) {
      return;
    }

    setPing(0);
    return undefined;
  }, [isDesktopRuntime, isOnline]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      setEndpoint('COM3');
      return;
    }

    let alive = true;

    const refreshPorts = async () => {
      try {
        const ports = await window.desktopRuntime!.listComPorts();
        if (!alive) {
          return;
        }

        setComPorts(ports);
        setEndpoint((current) => {
          if (current && ports.some((port) => port.path === current)) {
            return current;
          }
          return ports[0]?.path ?? '';
        });
      } catch {
        if (!alive) {
          return;
        }
        setComPorts([]);
      }
    };

    void refreshPorts();
    const timer = window.setInterval(() => {
      void refreshPorts();
    }, 2200);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [comPorts, isDesktopRuntime]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    if (comPorts.length === 0) {
      const hasWifiAlive = runtimeTransport === 'wifi'
        || runtimePhase === 'WIFI_PRIMARY'
        || runtimeTelemetry.wifiMode === 'sta'
        || runtimeTelemetry.wifiMode === 'ap'
        || connectionState !== 'DISCONNECTED';
      if (!hasWifiAlive) {
        setIsOnline(false);
        setRuntimePhase('DETACHED');
        setSignalNote('OFFLINE • No COM');
      }
    }
  }, [comPorts.length, connectionState, isDesktopRuntime, runtimePhase, runtimeTelemetry.wifiMode, runtimeTransport]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    let alive = true;

    const refreshStatus = async () => {
      try {
        const status = await window.desktopRuntime!.getComStatus();
        if (!alive) {
          return;
        }

        serialSessionConnectedRef.current = Boolean(status.connected);

        const timeoutMs = Number.isFinite(status.timeoutMs) ? Math.max(0, status.timeoutMs) : 0;
        const hasComPresent = comPorts.length === 0 ? false : comPorts.some((port) => port.path === status.path);
        const signalAgeMs = status.lastSignal ? Math.max(0, Date.now() - status.lastSignal.at) : null;
        const ackAgeMs = status.lastAck ? Math.max(0, Date.now() - status.lastAck.at) : null;
        const noRecentSignal = signalAgeMs === null || signalAgeMs > serialLinkTimeoutMs;
        const noRecentAck = ackAgeMs === null || ackAgeMs > serialLinkTimeoutMs;
        const timedOut = !disableLinkTimeout
          && status.connected
          && ((status.lastTelemetryAt !== null && timeoutMs > serialLinkTimeoutMs) || (noRecentSignal && noRecentAck));
        const timeoutDisplayMs = status.lastTelemetryAt !== null
          ? timeoutMs
          : Math.min(signalAgeMs ?? Number.POSITIVE_INFINITY, ackAgeMs ?? Number.POSITIVE_INFINITY);

        setIsOnline(status.connected && hasComPresent && !timedOut);
        setRobotId(status.robotId ?? '--');
        setFwVersion(status.fwVersion ?? '--');
        if (status.connected && hasComPresent) {
          setRuntimePhase(status.phase);
          setRuntimeTransport(status.activeTransport);
        }

        if (status.lastAck && status.lastAck.at > lastProcessedAckAtRef.current) {
          lastProcessedAckAtRef.current = status.lastAck.at;
          const ackReason = reasonCodeLabel(status.lastAck.reasonCode, status.lastAck.reasonText);
          appendLog(
            'RX',
            `ACK ${status.lastAck.status} id=${status.lastAck.ackId ?? '-'} code=0x${status.lastAck.reasonCode.toString(16).padStart(2, '0')} reason=${ackReason}`,
          );

          if (status.lastAck.status !== 'OK') {
            setSignalNote(`REJECTED • ${ackReason}`);
          }
        }

        if (status.telemetry) {
          setWifiTelemetryAt(Date.now());
          setRuntimeState(status.telemetry.state);
          setRuntimeGait(status.telemetry.gait);
          const telemetryRecord = status.telemetry as unknown as Record<string, unknown>;
          const capabilityFromTelemetry = parseCapabilityFromRecord(telemetryRecord.capability);
          if (capabilityFromTelemetry) {
            setCapability((current) => ({
              ...current,
              ...capabilityFromTelemetry,
            }));
          }
          setRuntimeTelemetry({
            battery: status.telemetry.battery,
            velocity: status.telemetry.velocity,
            temp: status.telemetry.temp,
            pitch: status.telemetry.pitch,
            roll: status.telemetry.roll,
            wifiMode: status.telemetry.wifi.mode,
            wifiIp: status.telemetry.wifi.ip,
            wifiRssi: status.telemetry.wifi.rssi,
            seq: status.telemetry.seq,
          });
          if (status.telemetry.wifi.mode === 'sta') {
            setLinkMode('sta_primary');
          } else if (status.telemetry.wifi.mode === 'ap') {
            setLinkMode('ap_fallback');
          }
          setPing(Math.max(0, Math.floor(status.watchdogAgeMs ?? timeoutMs)));
        }

        if (status.lastSignal && status.lastSignal.at > lastProcessedSignalAtRef.current) {
          lastProcessedSignalAtRef.current = status.lastSignal.at;
          appendLog('RX', status.lastSignal.raw);

          const parsed = parseLinkStatus(status.lastSignal.raw);
          if (parsed) {
            if (parsed.robotId) {
              setRobotId(parsed.robotId);
              setWifiRobotId(parsed.robotId);
            }

            if (parsed.udpPort) {
              setWifiUdpPort(parsed.udpPort);
            }

            setRuntimeTelemetry((current) => ({
              ...current,
              wifiIp: parsed.ip ?? current.wifiIp,
              wifiMode: parsed.mode ?? current.wifiMode,
              wifiRssi: typeof parsed.rssi === 'number' ? parsed.rssi : current.wifiRssi,
            }));

            if (parsed.ip) {
              setWifiMessage(`Robot IP detected: ${parsed.ip}`);
            } else if (parsed.mode === 'ap') {
              setWifiMessage('WiFi failed, robot is in AP fallback mode.');
            }

            setCapability((current) => ({
              ...current,
              ...(parsed.capability.canArm !== null ? { canArm: parsed.capability.canArm } : {}),
              ...(parsed.capability.canMotion !== null ? { canMotion: parsed.capability.canMotion } : {}),
              ...(parsed.capability.canService !== null ? { canService: parsed.capability.canService } : {}),
              ...(parsed.capability.calibWriteRequiresCom !== null
                ? { calibWriteRequiresCom: parsed.capability.calibWriteRequiresCom }
                : {}),
            }));
          }
        }

        const hasWifiAlive = runtimeTransport === 'wifi'
          || runtimePhase === 'WIFI_PRIMARY'
          || runtimeTelemetry.wifiMode === 'sta'
          || runtimeTelemetry.wifiMode === 'ap'
          || connectionState !== 'DISCONNECTED';
        if ((!status.connected || !hasComPresent) && !hasWifiAlive) {
          setSignalNote('OFFLINE');
          setRuntimeState('--');
        } else if (!status.connected || !hasComPresent) {
          setSignalNote('ONLINE • WIFI_PRIMARY • no COM');
        } else if (timedOut) {
          setSignalNote(`TIMEOUT • ${Number.isFinite(timeoutDisplayMs) ? timeoutDisplayMs : 0} ms • no RX`);
        } else if (status.lastSignal) {
          setSignalNote(
            `ONLINE • ${status.activeTransport.toUpperCase()} • ${status.phase} • RX ${status.rxCount} / TX ${status.txCount} • Q ${status.queueDepth}`,
          );
        } else if (status.lastError) {
          setSignalNote(`Error: ${status.lastError}`);
        } else {
          setSignalNote('Connecting');
        }
      } catch {
        if (!alive) {
          return;
        }
        serialSessionConnectedRef.current = false;
        setIsOnline(false);
        setRuntimePhase('ERROR');
        setSignalNote('Status unavailable');
      }
    };

    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 700);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [comPorts, connectionState, disableLinkTimeout, isDesktopRuntime, runtimePhase, runtimeTelemetry.wifiMode, runtimeTransport, serialLinkTimeoutMs]);

  const handleWifiConnectToggle = async () => {
    const targetHost = wifiTargetHost.trim();
    const targetPort = Number(wifiTargetPort);
    if (!targetHost) {
      setSignalNote('Wi-Fi connect blocked • nhap Runtime Target IP');
      return;
    }

    if (!Number.isFinite(targetPort) || targetPort < 1 || targetPort > 65535) {
      setSignalNote('Wi-Fi connect blocked • Runtime Target Port khong hop le');
      return;
    }

    if (connectionState !== 'DISCONNECTED') {
      setWifiAckAt(null);
      setWifiTelemetryAt(null);
      setConnectionState('DISCONNECTED');
      setSignalNote('Wi-Fi disconnected');
      return;
    }

    setIsConnecting(true);
    try {
      const tryRefreshCapabilityViaCom = async () => {
        if (!isComServiceReady) {
          return;
        }
        await issueSerialCommand('link_status', 'wifi-handshake:link_status');
      };

      const collectReplyFrames = (result: UdpGatewayResult) => {
        const frames: Record<string, unknown>[] = [];
        if (result.ok && result.udpReply) {
          frames.push(resolveReplyFrame(result.udpReply));
        }
        if (result.ok && Array.isArray(result.udpReplies)) {
          for (let i = 1; i < result.udpReplies.length; i += 1) {
            const item = result.udpReplies[i];
            if (item?.udpReply) {
              frames.push(resolveReplyFrame(item.udpReply));
            }
          }
        }
        return frames;
      };

      let connected = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const attemptStartedAt = Date.now();
        let telemetryObserved = false;

        appendLog('TX', `CONNECT hello attempt ${attempt}`);
        const helloCmdId = nextCommandId();
        const helloResult = await dispatchFirmwareAction('status', helloCmdId, undefined);
        applyUdpResult(helloResult, { appendAck: true });

        const helloFrames = collectReplyFrames(helloResult);
        for (const helloReply of helloFrames) {
          if (hasTelemetryEnvelope(helloReply)) {
            telemetryObserved = true;
            break;
          }
        }

        if (!telemetryObserved) {
          await tryRefreshCapabilityViaCom();
        }

        if (!helloResult.ok || !helloResult.udpReply) {
          continue;
        }

        const statusCmdId = nextCommandId();
        const statusResult = await dispatchFirmwareAction('status', statusCmdId, undefined);
        applyUdpResult(statusResult, { appendAck: true });

        const statusFrames = collectReplyFrames(statusResult);
        for (const statusReply of statusFrames) {
          if (hasTelemetryEnvelope(statusReply)) {
            telemetryObserved = true;
            break;
          }
        }

        if (!telemetryObserved) {
          await tryRefreshCapabilityViaCom();
        }

        const ackEnvelope = statusFrames
          .map((frame) => parseAckEnvelope(frame))
          .find((ack) => ack.isAck && ack.ackId === statusCmdId)
          ?? statusFrames
            .map((frame) => parseAckEnvelope(frame))
            .find((ack) => ack.isAck)
          ?? null;
        const hasValidAck = Boolean(
          statusResult.ok
          && ackEnvelope?.isAck
          && ackEnvelope.ackId === statusCmdId
          && ackEnvelope.ok
          && ackEnvelope.code === 0,
        );

        const telemetryWithinWindow = telemetryObserved
          || (wifiTelemetryAt !== null && wifiTelemetryAt >= attemptStartedAt && Date.now() - wifiTelemetryAt <= 2000);

        if (hasValidAck && telemetryWithinWindow) {
          connected = true;
          break;
        }

        if (statusResult.ok && !hasValidAck) {
          appendLog('RX', `CONNECT WARN invalid_ack attempt=${attempt} expected_cmd_id=${statusCmdId}`);
        }
      }

      if (!connected) {
        setSignalNote(`DISCONNECTED • handshake fail toi ${targetHost}:${targetPort} (need robot ACK+telemetry)`);
      } else {
        await tryRefreshCapabilityViaCom();
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleComConnectToggle = async () => {
    if (!isDesktopRuntime) {
      setIsOnline((v) => !v);
      return;
    }

    if (!window.desktopRuntime) {
      return;
    }

    if (isOnline) {
      setIsConnecting(true);
      try {
        serialSessionConnectedRef.current = false;
        heartbeatDisabledRef.current = false;
        heartbeatMalformedStreakRef.current = 0;
        await issueSerialCommand('telem off');
        await window.desktopRuntime.disconnectComPort();
        setIsOnline(false);
        appendLog('TX', 'disconnect');
      } finally {
        setIsConnecting(false);
      }
      return;
    }

    if (!endpoint && comPorts.length === 0) {
      setSignalNote('No COM detected');
      return;
    }

    setIsConnecting(true);
    try {
      const selectedEndpoint = comPorts.some((port) => port.path === endpoint)
        ? endpoint
        : (comPorts[0]?.path ?? endpoint);
      if (selectedEndpoint !== endpoint) {
        setEndpoint(selectedEndpoint);
        setSignalNote(`COM auto-select ${selectedEndpoint}`);
      }

      setWifiReady(false);
      serialSessionConnectedRef.current = true;
      heartbeatDisabledRef.current = false;
      heartbeatMalformedStreakRef.current = 0;
      await window.desktopRuntime.connectComPort({ path: selectedEndpoint, baudRate: 115200 });
      // Send compatibility probes because firmware variants may accept different hello formats.
      await issueSerialCommand('hello');
      await issueSerialCommand({
        type: 'hello',
        source: 'steam_planner',
        ts: Date.now(),
      });
      await issueSerialCommand('status');
      await issueSerialCommand('telem on');
      setIsOnline(true);
      setSignalNote('CONNECTING • waiting RX');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connect failed';
      if (message.includes('Port not found')) {
        try {
          const refreshedPorts = await window.desktopRuntime.listComPorts();
          setComPorts(refreshedPorts);
          const fallback = refreshedPorts[0]?.path;
          if (fallback) {
            setEndpoint(fallback);
            await window.desktopRuntime.connectComPort({ path: fallback, baudRate: 115200 });
            await issueSerialCommand('hello');
            await issueSerialCommand({
              type: 'hello',
              source: 'steam_planner',
              ts: Date.now(),
            });
            await issueSerialCommand('status');
            await issueSerialCommand('telem on');
            setIsOnline(true);
            setSignalNote(`CONNECTED via fallback ${fallback}`);
          } else {
            setSignalNote('No COM detected');
          }
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'Fallback connect failed';
          setSignalNote(`Error: ${fallbackMessage}`);
        }
      } else {
        setSignalNote(`Error: ${message}`);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    setActionBindings((current) => {
      const seen = new Set<ActionPreset>();
      const next: Record<ActionKey, ActionPreset> = { ...current };
      let changed = false;

      for (const keyName of actionKeys) {
        const selected = next[keyName];
        if (!seen.has(selected)) {
          seen.add(selected);
          continue;
        }

        const replacement = actionPresetOrder.find((preset) => !seen.has(preset));
        if (replacement) {
          next[keyName] = replacement;
          seen.add(replacement);
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, []);

  useEffect(() => {
    return () => {
      isTimelineRunningRef.current = false;
      timelineAbortRef.current?.abort();
      timelineAbortRef.current = null;

      (['speed', 'height', 'amplitude'] as const).forEach((key) => {
        const timer = sliderDebounceRef.current[key];
        if (timer !== null) {
          window.clearTimeout(timer);
          sliderDebounceRef.current[key] = null;
        }
      });
    };
  }, []);

  useEffect(() => {
    if (runtimeTelemetry.seq <= 0) {
      return;
    }

    const point: GraphPoint = {
      id: runtimeTelemetry.seq,
      ts: performance.now(),
      pitch: runtimeTelemetry.pitch,
      roll: runtimeTelemetry.roll,
    };

    setGraphPoints((current) => {
      const merged = [...current, point];
      const latestTs = merged[merged.length - 1].ts;
      const cutoffTs = latestTs - graphWindowMs;
      const windowed = merged.filter((item) => item.ts >= cutoffTs);
      return windowed.length > 260 ? windowed.slice(-260) : windowed;
    });
  }, [graphWindowMs, runtimeTelemetry.pitch, runtimeTelemetry.roll, runtimeTelemetry.seq]);

  const hasMovement = movementKeys.some((keyName) => activeKeys[keyName]);
  const hasAction = actionKeys.some((keyName) => activeKeys[keyName]);
  const activeActionKey = actionKeys.find((keyName) => activeKeys[keyName]) ?? null;

  useEffect(() => {
    hasMotionIntentRef.current = hasMovement || isRunning;
  }, [hasMovement, isRunning]);

  const actionLabelByPreset: Record<ActionPreset, string> = useMemo(
    () => ({
      sit: t.sit,
      stretch: 'Stretch',
      butt_up: 'Butt Up',
      jump: t.jump,
      hi: 'Hi',
    }),
    [t],
  );

  const actionOptions: Array<{ value: ActionPreset; label: string }> = useMemo(
    () => [
      { value: 'sit', label: t.sit },
      { value: 'stretch', label: 'Stretch' },
      { value: 'butt_up', label: 'Butt Up' },
      { value: 'jump', label: t.jump },
      { value: 'hi', label: 'Hi' },
    ],
    [t],
  );

  const activeActionLabel = activeActionKey ? actionLabelByPreset[actionBindings[activeActionKey]] : null;

  const centerState = useMemo(() => {
    if (hasAction && activeActionLabel) {
      return activeActionLabel.toUpperCase();
    }
    if (hasMovement) {
      return t.movingState;
    }
    const realVelocity = runtimeTelemetry.velocity;
    if (realVelocity > 0.03) {
      return t.standbyState;
    }

    if (runtimeState !== '--') {
      return runtimeState.toUpperCase();
    }

    return t.idleState;
  }, [activeActionLabel, hasAction, hasMovement, runtimeState, runtimeTelemetry.velocity, t]);

  const batteryLabel = runtimeTelemetry.battery >= 0 && runtimeTelemetry.battery <= 100
    ? `${Math.round(runtimeTelemetry.battery)}%`
    : 'N/A';
  const tempLabel = runtimeTelemetry.temp > 0 ? `${runtimeTelemetry.temp.toFixed(1)} C` : 'N/A';
  const pitchLabel = Number.isFinite(runtimeTelemetry.pitch) ? `${runtimeTelemetry.pitch >= 0 ? '+' : ''}${runtimeTelemetry.pitch.toFixed(1)} deg` : 'N/A';
  const rollLabel = Number.isFinite(runtimeTelemetry.roll) ? `${runtimeTelemetry.roll >= 0 ? '+' : ''}${runtimeTelemetry.roll.toFixed(1)} deg` : 'N/A';
  const rssiLabel = runtimeTelemetry.wifiRssi !== 0 ? `${runtimeTelemetry.wifiRssi} dBm` : 'N/A';
  const hasWifiIp = runtimeTelemetry.wifiIp !== '--' && runtimeTelemetry.wifiIp !== '0.0.0.0';
  const readyStates: ConnectionUxState[] = ['READY_AP_FALLBACK', 'READY_STA_PRIMARY'];
  const isWifiControllable = readyStates.includes(connectionState);
  const isWifiConnected = connectionState !== 'DISCONNECTED';
  const wifiStatusLabel = (() => {
    if (connectionState === 'READY_AP_FALLBACK') {
      return `AP FALLBACK • CONTROLLABLE${hasWifiIp ? ` • ${runtimeTelemetry.wifiIp}` : ''}`;
    }
    if (connectionState === 'READY_STA_PRIMARY') {
      return `STA PRIMARY • CONTROLLABLE${hasWifiIp ? ` • ${runtimeTelemetry.wifiIp}` : ''}`;
    }
    if (connectionState === 'LINK_REACHABLE') {
      return 'LINK REACHABLE • stabilizing telemetry';
    }
    if (connectionState === 'DEGRADED') {
      return 'LINK DEGRADED • hold/stop available';
    }
    return 'DISCONNECTED';
  })();
  const canArmInField = isArmControlEnabled({
    isWifiConnected,
    linkMode,
    capability,
  });
  const canArmFallback = isWifiConnected && (wifiTelemetryAt === null || (Date.now() - wifiTelemetryAt) > (telemetryFreshMs * 2));
  const armEnabled = canArmInField || canArmFallback;
  const canMotionInField = isMotionControlEnabled({
    isWifiConnected,
    capability,
    armReady,
  });
  const canMotionFallback = isWifiConnected && armReady && (wifiTelemetryAt === null || (Date.now() - wifiTelemetryAt) > (telemetryFreshMs * 2));
  const motionEnabled = canMotionInField || canMotionFallback;
  const isComServiceReady = isDesktopRuntime && isOnline;
  const segmentLabelMap: Record<SegmentTab, string> = {
    control: 'CONTROL',
    studio: t.studioMode,
    calib: 'CALIB',
    wifi: 'WIFI',
    log: 'LOG',
  };

  const runTimeline = async () => {
    if (blocks.length === 0 || isTimelineRunningRef.current) {
      return;
    }

    const controller = new AbortController();
    timelineAbortRef.current = controller;
    isTimelineRunningRef.current = true;
    setIsRunning(true);
    setActiveTimelineId(null);

    try {
      for (const block of blocks) {
        if (!isTimelineRunningRef.current) {
          break;
        }

        setActiveTimelineId(block.id);

        const label = block.label.toLowerCase();
        if (label.includes('tien')) {
          await issueFirmwareAction('forward');
        } else if (label.includes('lui')) {
          await issueFirmwareAction('backward');
        } else if (label.includes('re trai')) {
          await issueFirmwareAction('left');
        } else if (label.includes('re phai')) {
          await issueFirmwareAction('right');
        } else {
          await issueFirmwareAction('stop');
        }

        await sleepWithAbort(Math.max(140, block.duration * 1000), controller.signal);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('[timeline] execution failed', error);
      }
    } finally {
      if (timelineAbortRef.current === controller) {
        timelineAbortRef.current = null;
      }
      isTimelineRunningRef.current = false;
      setActiveTimelineId(null);
      setIsRunning(false);
    }
  };

  const emergencyStop = async () => {
    await issueFirmwareAction('estop');

    isTimelineRunningRef.current = false;
    setIsRunning(false);
    setActiveTimelineId(null);

    timelineAbortRef.current?.abort();
    timelineAbortRef.current = null;

    setActiveKeys((current) => ({
      ...current,
      W: false,
      A: false,
      S: false,
      D: false,
      '1': false,
      '2': false,
      '3': false,
      '4': false,
      '5': false,
      SPACE: true,
    }));
    window.setTimeout(() => {
      setActiveKeys((current) => ({ ...current, SPACE: false }));
    }, 120);
  };

  const holdRobot = async () => {
    await issueFirmwareAction('hold');
  };

  const armRobot = async () => {
    await issueFirmwareAction('arm');
  };

  const clearEmergency = async () => {
    await issueFirmwareAction('clear_estop');
  };

  const renderLogicWorkspace = () => (
    <div className="timeline-layer">
      <div className="timeline-scroll-area">
        <div className="timeline-core">
          {blocks.map((block) => (
            <div key={block.id} className={`timeline-block ${activeTimelineId === block.id ? 'timeline-block-live' : ''}`}>
              <span className="timeline-title">{block.label}</span>
              <div className="timeline-input-wrap">
                <span>{block.label}</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={block.duration}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isNaN(next)) {
                      return;
                    }
                    setBlocks((current) =>
                      current.map((item) => (item.id === block.id ? { ...item, duration: Math.max(0.1, next) } : item)),
                    );
                  }}
                />
                <em>{t.durationUnit}</em>
              </div>
            </div>
          ))}

          <div
            className="timeline-drop"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!dragText) {
                return;
              }
              const template = libraryBlocks.find((item) => item.label === dragText);
              if (!template) {
                return;
              }
              setBlocks((current) => [
                ...current,
                {
                  id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                  label: template.label,
                  duration: template.duration,
                },
              ]);
            }}
          >
            {t.timelineHint}
          </div>
        </div>
      </div>

      <aside className="timeline-side">
        <div className="timeline-library">
          {libraryBlocks.map((block) => (
            <button
              key={block.label}
              type="button"
              draggable
              onDragStart={() => setDragText(block.label)}
              className="library-pill"
            >
              {block.label}
            </button>
          ))}
        </div>

        <div className="timeline-launch">
          <button type="button" className={isRunning ? 'kill-switch' : ''} onClick={isRunning ? emergencyStop : runTimeline}>
            {isRunning ? t.stopEmergency : t.runTimeline}
          </button>
        </div>
      </aside>
    </div>
  );

  const renderStudioWorkspace = () => (
    <div className="studio-stack">
      <div className="studio-tuning">
        <div className="studio-param">
          <div className="studio-param-head">
            <span>Step Speed</span>
            <strong>{Math.round(studioTuning.stepSpeed)}%</strong>
          </div>
          <input
            type="range"
            min={10}
            max={100}
            value={studioTuning.stepSpeed}
            disabled={!motionEnabled}
            onChange={(event) => {
              const value = Number(event.target.value);
              setStudioTuning((current) => ({ ...current, stepSpeed: value }));
              debounceSliderCommand('speed', async () => {
                await issueFirmwareAction('speed', Math.round(value / 10));
              });
            }}
          />
        </div>

        <div className="studio-param">
          <div className="studio-param-head">
            <span>Body Height</span>
            <strong>{Math.round(studioTuning.bodyHeight)}%</strong>
          </div>
          <input
            type="range"
            min={10}
            max={100}
            value={studioTuning.bodyHeight}
            disabled={!motionEnabled}
            onChange={(event) => {
              const value = Number(event.target.value);
              setStudioTuning((current) => ({ ...current, bodyHeight: value }));
              debounceSliderCommand('height', async () => {
                await issueFirmwareAction('height', value);
              });
            }}
          />
        </div>

        <div className="studio-param">
          <div className="studio-param-head">
            <span>Joint Amplitude</span>
            <strong>{Math.round(studioTuning.jointAmplitude)}%</strong>
          </div>
          <input
            type="range"
            min={10}
            max={100}
            value={studioTuning.jointAmplitude}
            disabled={!motionEnabled}
            onChange={(event) => {
              const value = Number(event.target.value);
              setStudioTuning((current) => ({ ...current, jointAmplitude: value }));
              const stepHeightMm = Math.round(10 + (value / 100) * 35);
              debounceSliderCommand('amplitude', async () => {
                await issueSerialCommand(`step_h=${stepHeightMm}`);
              });
            }}
          />
        </div>

        <div className="studio-action-map">
          <>
            <div className="studio-action-map-head">Gait</div>
            <div className="studio-action-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <button type="button" disabled={!motionEnabled} onClick={() => void issueFirmwareAction('walk')}>WALK</button>
              <button type="button" disabled={!motionEnabled} onClick={() => void issueFirmwareAction('trot')}>TROT</button>
              <button type="button" disabled={!motionEnabled} onClick={() => void issueFirmwareAction('stomp')}>STOMP</button>
            </div>

            <div className="studio-action-map-head">Action Key Mapping</div>

            {actionKeys.map((keyName) => (
              <label key={keyName} className="studio-action-row">
                <span>{keyName}</span>
                <select
                  value={actionBindings[keyName]}
                  onChange={(event) => {
                    const nextAction = event.target.value as ActionPreset;
                    setActionBindings((current) => ({
                      ...current,
                      [keyName]: nextAction,
                    }));
                  }}
                >
                  {actionOptions.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={actionKeys.some(
                        (otherKey) => otherKey !== keyName && actionBindings[otherKey] === option.value,
                      )}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </>

          <div className="studio-action-map-head" style={{ marginTop: '0.7rem' }}>
            Firmware Console (COM Service)
          </div>
          <div className="studio-action-row" style={{ gridTemplateColumns: '1fr' }}>
            <input
              type="text"
              value={rawCommand}
              onChange={(event) => setRawCommand(event.target.value)}
              placeholder="vd: status | help | pid_kp=0.8 | prov wifi_ssid=URLAB-LAB"
              disabled={!isComServiceReady}
            />
            <button
              type="button"
              disabled={!isComServiceReady}
              onClick={() => {
                const command = rawCommand.trim();
                if (!command) {
                  return;
                }
                void issueSerialCommand(command, `serial:${command}`);
              }}
            >
              SEND SERIAL
            </button>
          </div>
        </div>
      </div>

      <div className="studio-graph">
        <div className="studio-graph-head">
          <span>IMU Analysis</span>
          <small>Pitch / Roll realtime</small>
        </div>

        {(() => {
          const latestTs = graphPoints.length > 0 ? graphPoints[graphPoints.length - 1].ts : performance.now();
          const cutoffTs = latestTs - graphWindowMs;

          const pitchPath = graphPoints
            .map((point) => {
              const x = ((point.ts - cutoffTs) / graphWindowMs) * 100;
              const y = 22 - point.pitch;
              return `${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(' ');

          const rollPath = graphPoints
            .map((point) => {
              const x = ((point.ts - cutoffTs) / graphWindowMs) * 100;
              const y = 22 - point.roll;
              return `${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(' ');

          return (
            <svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-label="Pitch and Roll telemetry">
              <polyline points={pitchPath} className="line-pitch" />
              <polyline points={rollPath} className="line-roll" />
            </svg>
          );
        })()}
      </div>
    </div>
  );

  const renderLogWorkspace = () => (
    <div className="timeline-layer">
      <div className="timeline-scroll-area">
        <div className="serial-log-panel">
          <div className="serial-log-head">
            <strong>Serial Log</strong>
            <span>{serialLogs.length} lines</span>
          </div>
          <div className="serial-log-body">
            {serialLogs.length === 0 ? (
              <div className="serial-log-empty">No RX/TX frame yet</div>
            ) : (
              serialLogs.map((entry) => (
                <div key={entry.id} className="serial-log-row">
                  <span>{new Date(entry.ts).toLocaleTimeString('en-GB', { hour12: false })}</span>
                  <strong className={entry.direction === 'RX' ? 'rx' : ''}>{entry.direction}</strong>
                  <code>{entry.text}</code>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <aside className="timeline-side" />
    </div>
  );

  const renderCalibWorkspace = () => {
    const joints: Array<{ key: CalibJointKey; label: string }> = [
      { key: '1h', label: 'Leg 1 Hip (1h)' },
      { key: '1s', label: 'Leg 1 Knee (1s)' },
      { key: '2h', label: 'Leg 2 Hip (2h)' },
      { key: '2s', label: 'Leg 2 Knee (2s)' },
      { key: '3h', label: 'Leg 3 Hip (3h)' },
      { key: '3s', label: 'Leg 3 Knee (3s)' },
      { key: '4h', label: 'Leg 4 Hip (4h)' },
      { key: '4s', label: 'Leg 4 Knee (4s)' },
    ];

    return (
      <div className="timeline-layer">
        <div className="timeline-scroll-area">
          <div className="calib-panel">
            <h3>Servo Calibration</h3>
            <ol>
              <li>Bam HOLD de robot dung thang.</li>
              <li>Dung +/- de jog tung khop den vi tri dung.</li>
              <li>Bam SAVE de luu vinh vien vao NVS.</li>
            </ol>

            <div className="calib-step-row">
              <span>Step (deg)</span>
              {[0.5, 1, 2, 5].map((step) => (
                <button
                  key={step}
                  type="button"
                  className={calibStep === step ? 'active' : ''}
                  onClick={() => setCalibStep(step)}
                >
                  {step.toFixed(1)}
                </button>
              ))}
            </div>

            <div className="calib-joints">
              {joints.map((joint) => (
                <div className="calib-joint-row" key={joint.key}>
                  <span>{joint.label}</span>
                  <button type="button" onClick={() => void jogCalibrationJoint(joint.key, -calibStep)}>-</button>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="180"
                    value={calibAngles[joint.key]}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) {
                        return;
                      }
                      void setCalibrationJointAbsolute(joint.key, next);
                    }}
                  />
                  <button type="button" onClick={() => void jogCalibrationJoint(joint.key, calibStep)}>+</button>
                </div>
              ))}
            </div>

            <div className="calib-actions">
              <button type="button" onClick={() => void issueSerialCommand('hold')}>HOLD</button>
              <button type="button" onClick={() => void issueSerialCommand('save')}>SAVE</button>
              <button type="button" onClick={() => void issueSerialCommand('reset_cal')}>RESET TO DEFAULT</button>
              <button type="button" onClick={() => void issueSerialCommand('dump_config')}>DUMP</button>
            </div>
          </div>
        </div>
        <aside className="timeline-side" />
      </div>
    );
  };

  const renderWifiWorkspace = () => (
    <div className="timeline-layer">
      <div className="timeline-scroll-area">
        <div className="wifi-panel">
          <h3>WiFi Provisioning</h3>
          <div className="wifi-status-grid">
            <div><span>Mode</span><strong>{runtimeTelemetry.wifiMode.toUpperCase()}</strong></div>
            <div><span>IP</span><strong>{runtimeTelemetry.wifiIp}</strong></div>
            <div><span>RSSI</span><strong>{rssiLabel}</strong></div>
            <div><span>Robot ID</span><strong>{robotId}</strong></div>
          </div>

          <label>
            Runtime Target IP
            <input type="text" value={wifiTargetHost} onChange={(event) => setWifiTargetHost(event.target.value)} placeholder="vd: 192.168.137.150" />
          </label>
          <label>
            Runtime Target Port
            <input type="text" value={wifiTargetPort} onChange={(event) => setWifiTargetPort(event.target.value)} placeholder="9000" />
          </label>
          <div className="wifi-actions">
            <button
              type="button"
              onClick={() => {
                if (runtimeTelemetry.wifiIp !== '--' && runtimeTelemetry.wifiIp !== '0.0.0.0') {
                  setWifiTargetHost(runtimeTelemetry.wifiIp);
                }
                if (/^\d+$/.test(wifiUdpPort)) {
                  setWifiTargetPort(wifiUdpPort);
                }
                setWifiMessage('Runtime target updated from detected IP/port.');
              }}
            >
              USE DETECTED IP
            </button>
          </div>

          <div className="wifi-help" style={{ marginBottom: '0.8rem' }}>
            <p><strong>Service Wizard</strong>: {provisionWizardStep.toUpperCase()}</p>
            <div className="wifi-actions">
              <button
                type="button"
                onClick={() => {
                  if (!requireComService('DETECT')) {
                    return;
                  }
                  if (!requireWizardStep('detect', 'DETECT')) {
                    return;
                  }
                  void runServiceWizardDetect();
                }}
              >
                1) DETECT
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!requireWizardStep('flash', 'FLASH DONE')) {
                    return;
                  }
                  markServiceWizardFlashDone();
                }}
              >
                2) FLASH DONE
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!requireComService('REBOOT')) {
                    return;
                  }
                  if (!requireWizardStep('reboot', 'REBOOT')) {
                    return;
                  }
                  void runServiceWizardReboot();
                }}
              >
                4) REBOOT
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!requireComService('AUTO DISCOVER IP')) {
                    return;
                  }
                  if (!requireWizardStep('discover', 'AUTO DISCOVER IP')) {
                    return;
                  }
                  void runServiceWizardDiscover();
                }}
              >
                5) AUTO DISCOVER IP
              </button>
            </div>
          </div>

          <label>
            WiFi SSID
            <input type="text" value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)} />
          </label>
          <label>
            WiFi Password
            <input type="password" value={wifiPassword} onChange={(event) => setWifiPassword(event.target.value)} />
          </label>
          <label>
            Robot ID
            <input type="text" value={wifiRobotId} onChange={(event) => setWifiRobotId(event.target.value)} />
          </label>
          <label>
            UDP Port
            <input type="text" value={wifiUdpPort} onChange={(event) => setWifiUdpPort(event.target.value)} />
          </label>

          <div className="wifi-actions">
            <button
              type="button"
              onClick={() => {
                if (!requireComService('PROVISION SAVE')) {
                  return;
                }
                if (provisionWizardStep !== 'provision' && provisionWizardStep !== 'detect') {
                  setWifiMessage(`PROVISION SAVE: sai buoc wizard (hien tai ${provisionWizardStep.toUpperCase()})`);
                  return;
                }
                void runWifiProvisioning();
              }}
            >
              3) PROVISION SAVE
            </button>
            <button
              type="button"
              onClick={() => {
                if (!requireComService('CHECK STATUS')) {
                  return;
                }
                void issueSerialCommand('link_status');
              }}
            >
              CHECK STATUS
            </button>
          </div>

          <div className="wifi-help">
            <p>1. Nhap SSID + Password.</p>
            <p>2. Bam SAVE & CONNECT de gui lenh prov.</p>
            <p>3. Rut cap USB va doi robot vao WiFi.</p>
            <p>4. Neu that bai, robot fallback AP URLAB-ROBOT-&lt;ID&gt;.</p>
          </div>

          {wifiMessage && <div className="wifi-message">{wifiMessage}</div>}

          <div className="wifi-help" style={{ marginTop: '0.8rem' }}>
            <p><strong>Robot Inventory (same app)</strong></p>
            {inventory.length === 0 ? (
              <p>No robot profile yet. Complete provisioning to add one.</p>
            ) : (
              inventory.slice(0, 5).map((item) => (
                <p key={`${item.robotId}-${item.lastServiceAt}`}>
                  {item.robotId} | FW {item.firmwareVersion} | UDP {item.controlUdpPort} | {item.wifiReady ? 'Wi-Fi ready' : 'service_required'}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
      <aside className="timeline-side" />
    </div>
  );

  return (
    <section className="mono-shell">
      <div className="zone-alpha">
        <div className="status-viewport">
          <div className="status-row"><span>State</span><strong>{centerState}</strong></div>
          <div className="status-row"><span>Gait</span><strong>{runtimeGait.toUpperCase()}</strong></div>
          <div className="status-row"><span>Pitch</span><strong>{pitchLabel}</strong></div>
          <div className="status-row"><span>Roll</span><strong>{rollLabel}</strong></div>
          <div className="status-row"><span>Speed</span><strong>{runtimeTelemetry.velocity.toFixed(2)}</strong></div>
          <div className="status-row"><span>Height</span><strong>{Math.round(50 + (studioTuning.bodyHeight / 100) * 70)} mm</strong></div>
          <div className="status-row"><span>Temp</span><strong>{tempLabel}</strong></div>
          <div className="status-row"><span>WiFi</span><strong className={isWifiConnected ? 'wifi-connect-ok' : ''}>{wifiStatusLabel}</strong></div>
          <div className="status-row"><span>Can ARM</span><strong>{capability.canArm ? 'YES' : 'NO'}</strong></div>
          <div className="status-row"><span>Can Motion</span><strong>{capability.canMotion ? 'YES' : 'NO'}</strong></div>
          <div className="status-row"><span>RSSI</span><strong>{rssiLabel}</strong></div>
          <div className="status-row"><span>BAT</span><strong>{batteryLabel}</strong></div>
        </div>

        <div className={`bat-chip ${runtimeTelemetry.battery >= 0 && runtimeTelemetry.battery < 20 ? 'bat-chip-low' : ''}`}>{t.batteryShort}: {batteryLabel}</div>

        <div className="ghost-keys-wrap" style={!motionEnabled ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
          <div className={`ghost-key key-w ${activeKeys.W ? 'ghost-key-active' : ''}`} role="button" tabIndex={0} onMouseDown={() => handleControlKeyDown('W')} onMouseUp={() => handleControlKeyUp('W')} onMouseLeave={() => handleControlKeyUp('W')} onTouchStart={() => handleControlKeyDown('W')} onTouchEnd={() => handleControlKeyUp('W')}>W</div>
          <div className={`ghost-key key-a ${activeKeys.A ? 'ghost-key-active' : ''}`} role="button" tabIndex={0} onMouseDown={() => handleControlKeyDown('A')} onMouseUp={() => handleControlKeyUp('A')} onMouseLeave={() => handleControlKeyUp('A')} onTouchStart={() => handleControlKeyDown('A')} onTouchEnd={() => handleControlKeyUp('A')}>A</div>
          <div className={`ghost-key key-s ${activeKeys.S ? 'ghost-key-active' : ''}`} role="button" tabIndex={0} onMouseDown={() => handleControlKeyDown('S')} onMouseUp={() => handleControlKeyUp('S')} onMouseLeave={() => handleControlKeyUp('S')} onTouchStart={() => handleControlKeyDown('S')} onTouchEnd={() => handleControlKeyUp('S')}>S</div>
          <div className={`ghost-key key-d ${activeKeys.D ? 'ghost-key-active' : ''}`} role="button" tabIndex={0} onMouseDown={() => handleControlKeyDown('D')} onMouseUp={() => handleControlKeyUp('D')} onMouseLeave={() => handleControlKeyUp('D')} onTouchStart={() => handleControlKeyDown('D')} onTouchEnd={() => handleControlKeyUp('D')}>D</div>
          <div className={`ghost-key key-1 ${activeKeys['1'] ? 'ghost-key-active' : ''}`} role="button" tabIndex={0} onMouseDown={() => handleControlKeyDown('1')} onMouseUp={() => handleControlKeyUp('1')} onMouseLeave={() => handleControlKeyUp('1')} onTouchStart={() => handleControlKeyDown('1')} onTouchEnd={() => handleControlKeyUp('1')}>1</div>
          <div className={`ghost-key key-2 ${activeKeys['2'] ? 'ghost-key-active' : ''}`} role="button" tabIndex={0} onMouseDown={() => handleControlKeyDown('2')} onMouseUp={() => handleControlKeyUp('2')} onMouseLeave={() => handleControlKeyUp('2')} onTouchStart={() => handleControlKeyDown('2')} onTouchEnd={() => handleControlKeyUp('2')}>2</div>
          <div className={`ghost-key key-3 ${activeKeys['3'] ? 'ghost-key-active' : ''}`} role="button" tabIndex={0} onMouseDown={() => handleControlKeyDown('3')} onMouseUp={() => handleControlKeyUp('3')} onMouseLeave={() => handleControlKeyUp('3')} onTouchStart={() => handleControlKeyDown('3')} onTouchEnd={() => handleControlKeyUp('3')}>3</div>
          <div className={`ghost-key key-4 ${activeKeys['4'] ? 'ghost-key-active' : ''}`} role="button" tabIndex={0} onMouseDown={() => handleControlKeyDown('4')} onMouseUp={() => handleControlKeyUp('4')} onMouseLeave={() => handleControlKeyUp('4')} onTouchStart={() => handleControlKeyDown('4')} onTouchEnd={() => handleControlKeyUp('4')}>4</div>
          <div className={`ghost-key key-5 ${activeKeys['5'] ? 'ghost-key-active' : ''}`} role="button" tabIndex={0} onMouseDown={() => handleControlKeyDown('5')} onMouseUp={() => handleControlKeyUp('5')} onMouseLeave={() => handleControlKeyUp('5')} onTouchStart={() => handleControlKeyDown('5')} onTouchEnd={() => handleControlKeyUp('5')}>5</div>
          <div className={`ghost-key key-space ${activeKeys.SPACE ? 'ghost-key-active' : ''}`} role="button" tabIndex={0} onMouseDown={() => handleControlKeyDown('SPACE')} onMouseUp={() => handleControlKeyUp('SPACE')} onMouseLeave={() => handleControlKeyUp('SPACE')} onTouchStart={() => handleControlKeyDown('SPACE')} onTouchEnd={() => handleControlKeyUp('SPACE')}>SPACE</div>
        </div>
      </div>

      <aside className="zone-beta">
        <div className="beta-header-shell">
          <div className="beta-header">
            <select value={endpoint} onChange={(event) => setEndpoint(event.target.value)}>
              {!isDesktopRuntime && <option value="COM3">COM3</option>}
              {isDesktopRuntime && comPorts.length === 0 && <option value="">No COM</option>}
              {isDesktopRuntime && comPorts.map((port) => (
                <option key={port.path} value={port.path}>{port.label}</option>
              ))}
            </select>
            <button className={`connect-pill ${isOnline ? 'connect-pill-online' : ''}`} onClick={handleComConnectToggle}>
              {isConnecting ? 'DANG KET NOI' : (isOnline ? 'NGAT COM' : 'KET NOI COM')}
            </button>
            <button className={`connect-pill ${isWifiConnected ? 'connect-pill-online' : ''}`} onClick={handleWifiConnectToggle}>
              {isConnecting ? 'DANG KET NOI' : (isWifiConnected ? 'NGAT WIFI' : 'KET NOI WIFI')}
            </button>
            <span className="ping-note">{signalNote} • FW {fwVersion} • {robotId}</span>
          </div>

          <div className="system-control-bar">
            <button type="button" className="sys-btn sys-btn-arm" onClick={() => void armRobot()} disabled={!armEnabled}>ARM</button>
            <button type="button" className="sys-btn sys-btn-hold" onClick={() => void holdRobot()}>HOLD</button>
            <button type="button" className="sys-btn sys-btn-estop" onClick={() => void emergencyStop()}>E-STOP</button>
            <button type="button" className="sys-btn sys-btn-clear" onClick={() => void clearEmergency()}>CLEAR</button>
          </div>

          <div className="segment-tabs" role="tablist" aria-label="Mode switch">
            {availableSegments.map((segment) => (
              <button key={segment} className={activeSegment === segment ? 'segment-active' : ''} onClick={() => setActiveSegment(segment)}>
                {segmentLabelMap[segment]}
              </button>
            ))}
          </div>

          <div className="control-update-line">CTRL {lastControlUpdate}</div>
          <div className="control-update-line">WATCHDOG {Number.isFinite(ping) ? `${ping} / ${watchdogTimeoutMs} ms` : `-- / ${watchdogTimeoutMs} ms`}</div>
          <div className="control-update-line">COM {isComServiceReady ? 'SERVICE READY' : 'SERVICE OFFLINE'} • WIFI {isWifiConnected ? 'RUNTIME ONLINE' : 'RUNTIME OFFLINE'}</div>
          <div className="control-update-line">LINK {connectionState} • {linkMode}</div>
          <div className="control-update-line">CAP can_arm={capability.canArm ? '1' : '0'} can_motion={capability.canMotion ? '1' : '0'} can_service={capability.canService ? '1' : '0'}</div>
        </div>

        <div className="beta-workspace">
          {activeSegment === 'control' && renderLogicWorkspace()}
          {activeSegment === 'studio' && renderStudioWorkspace()}
          {activeSegment === 'calib' && renderCalibWorkspace()}
          {activeSegment === 'wifi' && renderWifiWorkspace()}
          {activeSegment === 'log' && renderLogWorkspace()}
        </div>
      </aside>
    </section>
  );
}
