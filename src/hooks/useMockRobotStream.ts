import { useEffect, useState } from 'react';
import { mockRobotBus } from '../lib/mockRobotBus';
import type { Telemetry } from '../types';

const initialTelemetry: Telemetry = {
  battery: -1,
  velocity: 0,
  temp: 0,
  pitch: 0,
  roll: 0,
  state: 'idle',
  gait: '--',
  wifi: {
    mode: 'off',
    ip: '--',
    rssi: 0,
  },
  seq: 0,
  ts: 0,
};

export function useMockRobotStream(connected: boolean) {
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry);
  const [tilt, setTilt] = useState(0);

  useEffect(() => {
    const offImu = mockRobotBus.on('imu_update', ({ tilt: imuTilt }) => {
      setTilt(imuTilt);
    });

    const offTelemetry = mockRobotBus.on('telemetry_update', (nextTelemetry) => {
      setTelemetry(nextTelemetry);
    });

    return () => {
      offImu();
      offTelemetry();
    };
  }, []);

  useEffect(() => {
    if (!connected) {
      setTelemetry(initialTelemetry);
      setTilt(0);
      return;
    }

    return undefined;
  }, [connected]);

  const setManualTilt = (nextTilt: number) => {
    mockRobotBus.emit('imu_update', { tilt: nextTilt });
  };

  return {
    telemetry,
    tilt,
    setManualTilt,
  };
}
