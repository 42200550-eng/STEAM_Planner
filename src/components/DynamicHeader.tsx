import { Power, ShieldAlert, Upload } from 'lucide-react';
import type { AppCopy } from '../i18n';
import type { ControlAction, Language } from '../types';

type HeaderPort = {
  id: string;
  label: string;
};

type DynamicHeaderProps = {
  t: AppCopy;
  language: Language;
  ports: HeaderPort[];
  selectedPortId: string;
  isConnected: boolean;
  isArmed: boolean;
  isFlashing: boolean;
  flashProgress: number;
  onLanguageChange: (language: Language) => void;
  onPortSelect: (portId: string) => void;
  onConnect: () => void;
  onFlash: () => void;
  onControlAction: (action: ControlAction) => void;
  onDetectPort: () => void;
};

export function DynamicHeader({
  t,
  language,
  ports,
  selectedPortId,
  isConnected,
  isArmed,
  isFlashing,
  flashProgress,
  onLanguageChange,
  onPortSelect,
  onConnect,
  onFlash,
  onControlAction,
  onDetectPort,
}: DynamicHeaderProps) {
  const hasPorts = ports.length > 0;

  return (
    <header className={`dynamic-header ${isFlashing ? 'dynamic-header-flashing' : ''}`}>
      <div className="dynamic-header-left">
        <img src="urlab_logo_secondary_white.svg" alt="URLAB" className="header-logo" />
      </div>

      <div className="dynamic-header-right">
        {!hasPorts && (
          <>
            <span className="header-offline">Offline</span>
            <button className="soft-pill" onClick={onDetectPort}>
              {t.detectUsb}
            </button>
          </>
        )}

        {hasPorts && (
          <>
            <label className="port-select-wrap">
              <span>{t.portLabel}</span>
              <select value={selectedPortId} onChange={(event) => onPortSelect(event.target.value)}>
                {ports.map((port) => (
                  <option key={port.id} value={port.id}>
                    {port.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="soft-pill" onClick={onConnect}>
              {isConnected ? t.connected : t.connect}
            </button>
            <button className="soft-pill soft-pill-strong" onClick={onFlash}>
              <Upload size={13} /> {t.flashCore}
            </button>

            <div className="action-strip" role="group" aria-label="Robot controls">
              <button className={`soft-pill soft-pill-action ${isArmed ? 'soft-pill-live' : ''}`} onClick={() => onControlAction('arm')}>
                <Power size={12} /> {t.arm}
              </button>
              <button className="soft-pill soft-pill-action" onClick={() => onControlAction('hold')}>
                {t.disarm}
              </button>
              <button className="soft-pill soft-pill-danger" onClick={() => onControlAction('estop')}>
                <ShieldAlert size={12} /> {t.estop}
              </button>
            </div>

            <span className={`arm-state ${isArmed ? 'arm-state-live' : ''}`}>{isArmed ? t.armed : t.disarmed}</span>
          </>
        )}

        <div className="lang-toggle">
          <button onClick={() => onLanguageChange('vi')} className={language === 'vi' ? 'active' : ''}>
            VI
          </button>
          <button onClick={() => onLanguageChange('en')} className={language === 'en' ? 'active' : ''}>
            EN
          </button>
        </div>
      </div>

      <div className={`flash-progress ${isFlashing ? 'flash-progress-on' : ''}`}>
        <span style={{ width: `${flashProgress}%` }} />
      </div>
    </header>
  );
}
