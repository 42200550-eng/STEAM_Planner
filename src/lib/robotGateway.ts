import { mockRobotBus } from './mockRobotBus';
import type { RobotEventMap } from '../types';

export type GatewayStats = {
  online: boolean;
  queueDepth: number;
  sent: number;
  failed: number;
  retries: number;
  dropped: number;
  avgLatencyMs: number;
  packetLossPct: number;
  healthLatencyMs: number | null;
  lastError: string | null;
};

export interface RobotGatewayAdapter {
  sendEvent<K extends keyof RobotEventMap>(eventName: K, payload: RobotEventMap[K]): Promise<void>;
}

type QueueItem<K extends keyof RobotEventMap = keyof RobotEventMap> = {
  eventName: K;
  payload: RobotEventMap[K];
  attempts: number;
};

const FALLBACK_GATEWAY_ORIGIN = 'http://127.0.0.1:8787';

function resolveGatewayUrl(path: string) {
  const maybeImportMeta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
  const configuredBase = maybeImportMeta.env?.VITE_GATEWAY_BASE_URL?.trim();

  if (configuredBase) {
    return `${configuredBase.replace(/\/$/, '')}${path}`;
  }

  if (window.location.protocol === 'file:') {
    return `${FALLBACK_GATEWAY_ORIGIN}${path}`;
  }

  return path;
}

const listeners = new Set<(stats: GatewayStats) => void>();

function withLoss(stats: GatewayStats) {
  const total = stats.sent + stats.failed + stats.dropped;
  const packetLossPct = total === 0 ? 0 : Number((((stats.failed + stats.dropped) / total) * 100).toFixed(2));
  return {
    ...stats,
    packetLossPct,
  };
}

function publish(stats: GatewayStats) {
  const normalized = withLoss(stats);
  listeners.forEach((listener) => listener(normalized));
}

export function subscribeGatewayStats(listener: (stats: GatewayStats) => void) {
  listeners.add(listener);
  listener(withLoss(currentStats));
  return () => listeners.delete(listener);
}

let currentStats: GatewayStats = {
  online: false,
  queueDepth: 0,
  sent: 0,
  failed: 0,
  retries: 0,
  dropped: 0,
  avgLatencyMs: 0,
  packetLossPct: 0,
  healthLatencyMs: null,
  lastError: null,
};

class HttpUdpGatewayAdapter implements RobotGatewayAdapter {
  private queue: QueueItem[] = [];
  private draining = false;
  private readonly maxQueueSize = 220;

  constructor(
    private endpoint = resolveGatewayUrl('/api/udp-gateway'),
    private healthEndpoint = resolveGatewayUrl('/api/health'),
  ) {
    window.setInterval(() => {
      void this.healthCheck();
    }, 3500);
  }

  async sendEvent<K extends keyof RobotEventMap>(eventName: K, payload: RobotEventMap[K]) {
    this.enqueue({ eventName, payload, attempts: 0 });
    this.drain();
  }

  private enqueue(item: QueueItem) {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
      currentStats = {
        ...currentStats,
        dropped: currentStats.dropped + 1,
      };
    }

    this.queue.push(item);
    currentStats = {
      ...currentStats,
      queueDepth: this.queue.length,
    };
    publish(currentStats);
  }

  private async drain() {
    if (this.draining) {
      return;
    }
    this.draining = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) {
        break;
      }

      currentStats = {
        ...currentStats,
        queueDepth: this.queue.length,
      };
      publish(currentStats);

      const startedAt = performance.now();

      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventName: item.eventName, payload: item.payload, ts: Date.now() }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const latency = performance.now() - startedAt;
        const nextCount = currentStats.sent + 1;
        const nextAvg = currentStats.sent === 0
          ? latency
          : (currentStats.avgLatencyMs * currentStats.sent + latency) / nextCount;

        currentStats = {
          ...currentStats,
          online: true,
          sent: nextCount,
          avgLatencyMs: Number(nextAvg.toFixed(1)),
          lastError: null,
        };
        publish(currentStats);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';

        if (item.attempts < 3) {
          const backoffMs = 220 * 2 ** item.attempts;
          currentStats = {
            ...currentStats,
            retries: currentStats.retries + 1,
            online: false,
            lastError: message,
          };
          publish(currentStats);

          await new Promise((resolve) => window.setTimeout(resolve, backoffMs));
          this.queue.unshift({ ...item, attempts: item.attempts + 1 });
          currentStats = {
            ...currentStats,
            queueDepth: this.queue.length,
          };
          publish(currentStats);
        } else {
          currentStats = {
            ...currentStats,
            failed: currentStats.failed + 1,
            online: false,
            lastError: message,
          };
          publish(currentStats);
        }
      }
    }

    this.draining = false;
  }

  private async healthCheck() {
    const startedAt = performance.now();
    try {
      const response = await fetch(this.healthEndpoint, { method: 'GET' });
      if (!response.ok) {
        throw new Error(`health ${response.status}`);
      }
      const latency = performance.now() - startedAt;
      currentStats = {
        ...currentStats,
        online: true,
        healthLatencyMs: Number(latency.toFixed(1)),
      };
      publish(currentStats);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'health error';
      currentStats = {
        ...currentStats,
        online: false,
        healthLatencyMs: null,
        lastError: message,
      };
      publish(currentStats);
    }
  }
}

export const robotGatewayAdapter = new HttpUdpGatewayAdapter();

export function bridgeBusToGateway(adapter: RobotGatewayAdapter) {
  const unsubs = [
    mockRobotBus.on('imu_update', (payload) => {
      void adapter.sendEvent('imu_update', payload);
    }),
    mockRobotBus.on('pid_update', (payload) => {
      void adapter.sendEvent('pid_update', payload);
    }),
    mockRobotBus.on('run_state', (payload) => {
      void adapter.sendEvent('run_state', payload);
    }),
    mockRobotBus.on('control_action', (payload) => {
      void adapter.sendEvent('control_action', payload);
    }),
  ];

  return () => {
    unsubs.forEach((off) => off());
  };
}
