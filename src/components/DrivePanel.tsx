import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Hand,
  RotateCw,
  Waves,
} from 'lucide-react';
import type { AppCopy } from '../i18n';
import { Twin } from './Twin';

type DrivePanelProps = {
  tilt: number;
  t: AppCopy;
  speed: number;
  battery: number;
  temp: number;
  latencyMs: number;
  activePortLabel: string;
  isConnected: boolean;
  onTiltChange: (tilt: number) => void;
};

const actionIconMap = {
  jump: ArrowUp,
  sit: ArrowDown,
  stand: Hand,
  wave: Waves,
  spin: RotateCw,
  walk: ArrowRight,
};

export function DrivePanel({
  tilt,
  t,
  speed,
  battery,
  temp,
  latencyMs,
  activePortLabel,
  isConnected,
  onTiltChange,
}: DrivePanelProps) {
  const actions = [
    { key: 'jump', label: t.jump },
    { key: 'sit', label: t.sit },
    { key: 'stand', label: t.stand },
    { key: 'wave', label: t.wave },
    { key: 'spin', label: t.spin },
    { key: 'walk', label: t.walk },
  ] as const;

  return (
    <>
      <div className="drive-topbar">
        <div className="drive-top-item">
          <p>{t.velocity}</p>
          <strong>{speed.toFixed(2)} m/s</strong>
        </div>
        <div className="drive-top-item">
          <p>{t.battery}</p>
          <strong>{battery.toFixed(1)} %</strong>
        </div>
        <div className="drive-top-item">
          <p>{t.temp}</p>
          <strong>{temp.toFixed(1)} C</strong>
        </div>
        <div className="drive-top-item drive-top-link">
          <p>{t.latency}</p>
          <strong>{latencyMs} ms</strong>
          <span>{isConnected ? activePortLabel : 'Offline'}</span>
        </div>
      </div>

      <div className="drive-grid">
        <div className="nav-zone">
          <p className="zone-title">{t.navigation}</p>
          <div className="nav-radar">
            <span className="ring ring-1" />
            <span className="ring ring-2" />
            <span className="dot" />
          </div>

          <div className="xy-card">
            <div>
              <small>X</small>
              <strong>{tilt > 0 ? '+' : ''}{tilt.toFixed(0)}%</strong>
            </div>
            <div>
              <small>Y</small>
              <strong>+0%</strong>
            </div>
          </div>

          <div className="axis-slider">
            <label>{t.speed}</label>
            <input type="range" min={0} max={100} value={55} readOnly />
            <span>55%</span>
          </div>
          <div className="axis-slider">
            <label>{t.height}</label>
            <input type="range" min={0} max={100} value={50} readOnly />
            <span>50%</span>
          </div>
        </div>

        <div className="action-zone">
          <div className="zone-head">
            <p className="zone-title">{t.actions}</p>
            <div className="action-row">
              {actions.map((action) => {
                const Icon = actionIconMap[action.key];
                return (
                  <button type="button" key={action.key} className="action-pill">
                    <Icon size={14} />
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="dpad-zone">
            <p className="zone-title">{t.dpad}</p>
            <div className="dpad-grid">
              <button><ArrowUp size={14} /></button>
              <button><ArrowLeft size={14} /></button>
              <button className="dpad-center" />
              <button><ArrowRight size={14} /></button>
              <button><ArrowDown size={14} /></button>
            </div>
          </div>
        </div>

        <div className="drive-twin-wrap">
          <Twin tilt={tilt} />
          <div className="tilt-control">
            <span>{t.imuLabel}</span>
            <input
              type="range"
              min={-18}
              max={18}
              value={tilt}
              onChange={(event) => onTiltChange(Number(event.target.value))}
            />
          </div>
        </div>
      </div>
    </>
  );
}
