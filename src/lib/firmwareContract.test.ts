import { describe, expect, it } from 'vitest';
import {
  isArmControlEnabled,
  isMotionControlEnabled,
  parseCapabilityFromRecord,
  reasonCodeLabel,
  type RuntimeCapability,
} from './firmwareContract';

describe('reasonCodeLabel', () => {
  it('maps firmware ACK code 108 to reject_not_sta', () => {
    expect(reasonCodeLabel(108, '')).toBe('reject_not_sta');
  });

  it('keeps explicit firmware text when provided', () => {
    expect(reasonCodeLabel(108, 'sta required')).toBe('sta required');
  });

  it('maps known non-zero codes and falls back to unknown', () => {
    expect(reasonCodeLabel(107, '')).toBe('not_armed');
    expect(reasonCodeLabel(105, '')).toBe('queue_or_parse');
    expect(reasonCodeLabel(999, '')).toBe('unknown');
  });
});

describe('parseCapabilityFromRecord', () => {
  it('parses mixed boolean, numeric, and string capability flags', () => {
    const parsed = parseCapabilityFromRecord({
      can_arm: true,
      can_motion: 0,
      can_service: '1',
      calib_write_requires_com: 'false',
    });

    expect(parsed).toEqual({
      canArm: true,
      canMotion: false,
      canService: true,
      calibWriteRequiresCom: false,
    });
  });

  it('returns null when capability fields are absent', () => {
    expect(parseCapabilityFromRecord({ foo: 1 })).toBeNull();
    expect(parseCapabilityFromRecord(null)).toBeNull();
  });
});

describe('control gating', () => {
  const capabilityBase: RuntimeCapability = {
    canArm: true,
    canMotion: true,
    canService: true,
    calibWriteRequiresCom: true,
  };

  it('enables ARM only when wifi + sta_primary + canArm', () => {
    expect(isArmControlEnabled({
      isWifiConnected: true,
      linkMode: 'sta_primary',
      capability: capabilityBase,
    })).toBe(true);

    expect(isArmControlEnabled({
      isWifiConnected: true,
      linkMode: 'ap_fallback',
      capability: capabilityBase,
    })).toBe(false);

    expect(isArmControlEnabled({
      isWifiConnected: false,
      linkMode: 'sta_primary',
      capability: capabilityBase,
    })).toBe(false);
  });

  it('enables motion only when wifi + canMotion + armed', () => {
    expect(isMotionControlEnabled({
      isWifiConnected: true,
      capability: capabilityBase,
      armReady: true,
    })).toBe(true);

    expect(isMotionControlEnabled({
      isWifiConnected: true,
      capability: { ...capabilityBase, canMotion: false },
      armReady: true,
    })).toBe(false);

    expect(isMotionControlEnabled({
      isWifiConnected: true,
      capability: capabilityBase,
      armReady: false,
    })).toBe(false);
  });
});
