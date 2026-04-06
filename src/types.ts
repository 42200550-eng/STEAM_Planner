export type Language = 'vi' | 'en';
export type AppPhase = 'void' | 'detected' | 'handshake' | 'connected';
export type Tab = 'drive' | 'logic' | 'studio';
export type RunState = 'idle' | 'loading' | 'running' | 'done' | 'error';

export type LogicNodeKind = 'action' | 'condition';

export type LogicBlock = {
  id: string;
  label: string;
  kind: LogicNodeKind;
};

export type LogicNode = {
  id: string;
  label: string;
  kind: LogicNodeKind;
  next: string | null;
  onTrue?: string | null;
  onFalse?: string | null;
};

export type LogicRunPayload = {
  nodes: LogicNode[];
  sourceCode: string;
  entryNodeId: string | null;
};

export type Telemetry = {
  battery: number;
  velocity: number;
  temp: number;
  pitch: number;
  roll: number;
  state: 'idle' | 'running' | 'hold' | 'estop';
  gait: 'walk' | 'trot' | 'stomp' | '--';
  wifi: {
    mode: string;
    ip: string;
    rssi: number;
  };
  seq: number;
  ts: number;
};

export type ControlAction = 'arm' | 'hold' | 'stop' | 'estop';

export type RobotEventMap = {
  imu_update: { tilt: number };
  telemetry_update: Telemetry;
  run_state: { state: RunState; activeNodeId: string | null };
  collision_event: { nodeId: string; message: string };
  pid_update: { p: number; i: number; d: number };
  control_action: { action: ControlAction; ts: number; source: 'header' | 'failsafe' };
};
