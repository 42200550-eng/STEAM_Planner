import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppCopy } from '../i18n';

type CommandTemplate = {
  label: string;
  duration: number;
};

type MissionBlock = {
  id: string;
  label: string;
  duration: number;
};

type StudioParam = 'stepSpeed' | 'bodyHeight' | 'jointAmplitude';

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
const actionKeys = ['1', '2', '3', '4'] as const;
const keyboardKeys = [...movementKeys, ...actionKeys, 'SPACE'] as const;

type GhostKey = (typeof keyboardKeys)[number];
type ActionKey = (typeof actionKeys)[number];
type SegmentTab = 'logic' | 'studio';
type ActionPreset = 'sit' | 'stand' | 'wave' | 'spin' | 'jump';
const actionPresetOrder: ActionPreset[] = ['sit', 'stand', 'wave', 'spin', 'jump'];

function isActionKey(key: GhostKey): key is ActionKey {
  return key === '1' || key === '2' || key === '3' || key === '4';
}

async function sendRobotCommand(command: string, payload: Record<string, unknown> = {}) {
  try {
    await fetch('/api/udp-gateway', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName: 'robot_command',
        payload: {
          command,
          ...payload,
        },
        ts: Date.now(),
      }),
    });
  } catch {
    // Keep cockpit responsive even when gateway is offline.
  }
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
  if (upper === '1' || upper === '2' || upper === '3' || upper === '4') {
    return upper;
  }
  if (input === ' ') {
    return 'SPACE';
  }
  return null;
}

export function MonolithicDashboard({
  velocity,
  battery,
  t,
}: {
  velocity: number;
  battery: number;
  t: AppCopy;
}) {
  const [endpoint, setEndpoint] = useState('COM3');
  const [isOnline, setIsOnline] = useState(false);
  const [ping, setPing] = useState(0);
  const [activeSegment, setActiveSegment] = useState<SegmentTab>('logic');
  const [activeKeys, setActiveKeys] = useState<Record<GhostKey, boolean>>({
    W: false,
    A: false,
    S: false,
    D: false,
    '1': false,
    '2': false,
    '3': false,
    '4': false,
    SPACE: false,
  });
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
    '2': 'stand',
    '3': 'wave',
    '4': 'spin',
  });
  const [studioTuning, setStudioTuning] = useState<StudioTuningState>({
    stepSpeed: 58,
    bodyHeight: 52,
    jointAmplitude: 46,
  });
  const [graphPoints, setGraphPoints] = useState<GraphPoint[]>([]);
  const isTimelineRunningRef = useRef(false);
  const timelineAbortRef = useRef<AbortController | null>(null);
  const graphTickRef = useRef(0);
  const graphBufferRef = useRef<GraphPoint[]>([]);
  const graphRafRef = useRef<number | null>(null);
  const graphWindowMs = 8000;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mapped = normalizeKey(event.key);
      if (!mapped) {
        return;
      }

      // Prevent visual flicker caused by keyboard auto-repeat while key is held.
      if (event.repeat) {
        return;
      }

      setActiveKeys((current) => {
        if (current[mapped]) {
          return current;
        }
        return { ...current, [mapped]: true };
      });

      if (isActionKey(mapped)) {
        void sendRobotCommand('COMMAND_ACTION', {
          key: mapped,
          action: actionBindings[mapped],
        });
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const mapped = normalizeKey(event.key);
      if (!mapped) {
        return;
      }
      setActiveKeys((current) => ({ ...current, [mapped]: false }));
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [actionBindings]);

  useEffect(() => {
    if (!isOnline) {
      setPing(0);
      return;
    }
    const timer = window.setInterval(() => {
      setPing(Math.floor(4 + Math.random() * 15));
    }, 900);
    return () => window.clearInterval(timer);
  }, [isOnline]);

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
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      graphTickRef.current += 1;
      const t = graphTickRef.current / 7;
      const speedGain = studioTuning.stepSpeed / 100;
      const ampGain = studioTuning.jointAmplitude / 100;
      const stanceGain = (100 - studioTuning.bodyHeight) / 100;
      const keyboardMoving = movementKeys.some((keyName) => activeKeys[keyName]);
      const activeGain = keyboardMoving || isRunning ? 1.15 : 0.62;

      const pitch = Math.sin(t * (0.9 + speedGain * 1.15)) * (7 + ampGain * 10) * activeGain;
      const roll = Math.cos(t * (0.75 + speedGain * 0.9) + 0.6) * (5 + stanceGain * 9) * activeGain;
      const ts = performance.now();

      graphBufferRef.current.push({
        id: Date.now() + graphTickRef.current,
        ts,
        pitch,
        roll,
      });
    }, 28);

    return () => window.clearInterval(timer);
  }, [activeKeys, isRunning, studioTuning]);

  useEffect(() => {
    const renderFrame = () => {
      const batch = graphBufferRef.current;

      if (batch.length > 0) {
        const latestTs = batch[batch.length - 1].ts;
        const cutoffTs = latestTs - graphWindowMs;

        setGraphPoints((current) => {
          const merged = [...current, ...batch];
          graphBufferRef.current = [];

          const windowed = merged.filter((point) => point.ts >= cutoffTs);
          return windowed.length > 260 ? windowed.slice(-260) : windowed;
        });
      }

      graphRafRef.current = window.requestAnimationFrame(renderFrame);
    };

    graphRafRef.current = window.requestAnimationFrame(renderFrame);

    return () => {
      if (graphRafRef.current !== null) {
        window.cancelAnimationFrame(graphRafRef.current);
        graphRafRef.current = null;
      }
      graphBufferRef.current = [];
    };
  }, []);

  const hasMovement = movementKeys.some((keyName) => activeKeys[keyName]);
  const hasAction = actionKeys.some((keyName) => activeKeys[keyName]);
  const activeActionKey = actionKeys.find((keyName) => activeKeys[keyName]) ?? null;

  const actionLabelByPreset: Record<ActionPreset, string> = useMemo(
    () => ({
      sit: t.sit,
      stand: t.stand,
      wave: t.wave,
      spin: t.spin,
      jump: t.jump,
    }),
    [t],
  );

  const actionOptions: Array<{ value: ActionPreset; label: string }> = useMemo(
    () => [
      { value: 'sit', label: t.sit },
      { value: 'stand', label: t.stand },
      { value: 'wave', label: t.wave },
      { value: 'spin', label: t.spin },
      { value: 'jump', label: t.jump },
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
    return velocity > 0.03 ? t.standbyState : t.idleState;
  }, [activeActionLabel, hasAction, hasMovement, t, velocity]);

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

        await sendRobotCommand('COMMAND_EXECUTE', {
          blockId: block.id,
          label: block.label,
          duration: block.duration,
        });

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
    await sendRobotCommand('COMMAND_STOP');

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
      SPACE: true,
    }));
    window.setTimeout(() => {
      setActiveKeys((current) => ({ ...current, SPACE: false }));
    }, 120);
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
            onChange={(event) => {
              const value = Number(event.target.value);
              setStudioTuning((current) => ({ ...current, stepSpeed: value }));
              void sendRobotCommand('COMMAND_TUNE', { parameter: 'stepSpeed' satisfies StudioParam, value });
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
            onChange={(event) => {
              const value = Number(event.target.value);
              setStudioTuning((current) => ({ ...current, bodyHeight: value }));
              void sendRobotCommand('COMMAND_TUNE', { parameter: 'bodyHeight' satisfies StudioParam, value });
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
            onChange={(event) => {
              const value = Number(event.target.value);
              setStudioTuning((current) => ({ ...current, jointAmplitude: value }));
              void sendRobotCommand('COMMAND_TUNE', { parameter: 'jointAmplitude' satisfies StudioParam, value });
            }}
          />
        </div>

        <div className="studio-action-map">
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

  return (
    <section className="mono-shell">
      <div className="zone-alpha">
        <div className={`velocity-center ${hasMovement || hasAction ? 'velocity-center-live' : ''}`}>
          <p>{centerState}</p>
        </div>

        <div className={`bat-chip ${battery < 20 ? 'bat-chip-low' : ''}`}>{t.batteryShort}: {battery.toFixed(0)}%</div>

        <div className="ghost-keys-wrap">
          <div className={`ghost-key key-w ${activeKeys.W ? 'ghost-key-active' : ''}`}>W</div>
          <div className={`ghost-key key-a ${activeKeys.A ? 'ghost-key-active' : ''}`}>A</div>
          <div className={`ghost-key key-s ${activeKeys.S ? 'ghost-key-active' : ''}`}>S</div>
          <div className={`ghost-key key-d ${activeKeys.D ? 'ghost-key-active' : ''}`}>D</div>
          <div className={`ghost-key key-1 ${activeKeys['1'] ? 'ghost-key-active' : ''}`}>1</div>
          <div className={`ghost-key key-2 ${activeKeys['2'] ? 'ghost-key-active' : ''}`}>2</div>
          <div className={`ghost-key key-3 ${activeKeys['3'] ? 'ghost-key-active' : ''}`}>3</div>
          <div className={`ghost-key key-4 ${activeKeys['4'] ? 'ghost-key-active' : ''}`}>4</div>
          <div className={`ghost-key key-space ${activeKeys.SPACE ? 'ghost-key-active' : ''}`}>SPACE</div>
        </div>
      </div>

      <aside className="zone-beta">
        <div className="beta-header-shell">
          <div className="beta-header">
            <select value={endpoint} onChange={(event) => setEndpoint(event.target.value)}>
              <option value="COM3">COM3</option>
              <option value="COM5">COM5</option>
              <option value="WIFI_192.168.1.15">WiFi 192.168.1.15</option>
            </select>
            <button className={`connect-pill ${isOnline ? 'connect-pill-online' : ''}`} onClick={() => setIsOnline((v) => !v)}>
              {isOnline ? 'ONLINE' : 'KET NOI'}
            </button>
            <span className="ping-note">{isOnline ? `${ping} ms` : 'Offline'}</span>
          </div>

          <div className="segment-tabs" role="tablist" aria-label="Mode switch">
            <button className={activeSegment === 'logic' ? 'segment-active' : ''} onClick={() => setActiveSegment('logic')}>
              {t.logicMode}
            </button>
            <button className={activeSegment === 'studio' ? 'segment-active' : ''} onClick={() => setActiveSegment('studio')}>
              {t.studioMode}
            </button>
          </div>
        </div>

        <div className="beta-workspace">
          {activeSegment === 'logic' && renderLogicWorkspace()}
          {activeSegment === 'studio' && renderStudioWorkspace()}
        </div>
      </aside>
    </section>
  );
}
