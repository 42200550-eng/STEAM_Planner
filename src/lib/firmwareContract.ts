export type RuntimeCapability = {
  canArm: boolean;
  canMotion: boolean;
  canService: boolean;
  calibWriteRequiresCom: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function reasonCodeLabel(reasonCode: number, fallback: string) {
  const text = fallback.trim();
  if (text) {
    return text;
  }

  switch (reasonCode) {
    case 0:
      return 'ok';
    case 100:
      return 'bad_payload';
    case 102:
      return 'ttl_expired';
    case 103:
      return 'duplicate';
    case 105:
      return 'queue_or_parse';
    case 107:
      return 'not_armed';
    case 108:
      return 'reject_not_sta';
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

export function parseFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
      return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
      return false;
    }
  }
  return null;
}

export function parseCapabilityFromRecord(value: unknown): Partial<RuntimeCapability> | null {
  if (!isRecord(value)) {
    return null;
  }

  const canArm = parseFlag(value.can_arm ?? value.canArm);
  const canMotion = parseFlag(value.can_motion ?? value.canMotion);
  const canService = parseFlag(value.can_service ?? value.canService);
  const calibWriteRequiresCom = parseFlag(value.calib_write_requires_com ?? value.calibWriteRequiresCom);

  if (canArm === null && canMotion === null && canService === null && calibWriteRequiresCom === null) {
    return null;
  }

  return {
    ...(canArm !== null ? { canArm } : {}),
    ...(canMotion !== null ? { canMotion } : {}),
    ...(canService !== null ? { canService } : {}),
    ...(calibWriteRequiresCom !== null ? { calibWriteRequiresCom } : {}),
  };
}

export function isArmControlEnabled(input: {
  isWifiConnected: boolean;
  linkMode: 'sta_primary' | 'ap_fallback' | 'unknown';
  capability: RuntimeCapability;
}) {
  return input.isWifiConnected
    && input.linkMode === 'sta_primary'
    && input.capability.canArm;
}

export function isMotionControlEnabled(input: {
  isWifiConnected: boolean;
  capability: RuntimeCapability;
  armReady: boolean;
}) {
  return input.isWifiConnected
    && input.capability.canMotion
    && input.armReady;
}
