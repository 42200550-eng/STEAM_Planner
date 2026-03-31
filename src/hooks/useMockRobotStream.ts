import { useEffect, useState } from 'react';
import { mockRobotBus } from '../lib/mockRobotBus';
import type { Telemetry } from '../types';

const initialTelemetry: Telemetry = {
  battery: 87,
  speed: 0.52,
  temp: 39.4,
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
      return;
    }

    let currentTilt = 0;
    let currentBattery = initialTelemetry.battery;
    const telemetryTimer = window.setInterval(() => {
      const nextBattery = currentBattery - 0.3 < 9 ? 82 : Number((currentBattery - 0.3).toFixed(1));
      currentBattery = nextBattery;
      const nextTelemetry: Telemetry = {
        battery: nextBattery,
        speed: Number((Math.random() * 1.6 + 0.2).toFixed(2)),
        temp: Number((38.2 + Math.random() * 6.1).toFixed(1)),
      };
      mockRobotBus.emit('telemetry_update', nextTelemetry);
    }, 1100);

    const imuTimer = window.setInterval(() => {
      currentTilt = Number((Math.sin(Date.now() / 800) * 8).toFixed(1));
      mockRobotBus.emit('imu_update', { tilt: currentTilt });
    }, 450);

    return () => {
      window.clearInterval(telemetryTimer);
      window.clearInterval(imuTimer);
    };
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
