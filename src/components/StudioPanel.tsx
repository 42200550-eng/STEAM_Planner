import { Lock, ShieldCheck } from 'lucide-react';
import type { AppCopy } from '../i18n';

type StudioPanelProps = {
  t: AppCopy;
  isTeacherUnlocked: boolean;
  teacherCode: string;
  p: number;
  i: number;
  d: number;
  chartPath: string;
  onTeacherCodeChange: (value: string) => void;
  onUnlock: () => void;
  onPChange: (value: number) => void;
  onIChange: (value: number) => void;
  onDChange: (value: number) => void;
};

export function StudioPanel({
  t,
  isTeacherUnlocked,
  teacherCode,
  p,
  i,
  d,
  chartPath,
  onTeacherCodeChange,
  onUnlock,
  onPChange,
  onIChange,
  onDChange,
}: StudioPanelProps) {
  return (
    <>
      <div className="logic-header">
        <h2>{t.studioTitle}</h2>
        <p>{isTeacherUnlocked ? t.unlocked : t.studioLock}</p>
      </div>

      <div className="studio-layout">
        <div className="pid-panel">
          <div className="pid-row">
            <label>P</label>
            <input
              type="range"
              min={0.2}
              max={3.5}
              step={0.1}
              value={p}
              disabled={!isTeacherUnlocked}
              onChange={(event) => onPChange(Number(event.target.value))}
            />
            <strong>{p.toFixed(1)}</strong>
          </div>
          <div className="pid-row">
            <label>I</label>
            <input
              type="range"
              min={0.1}
              max={2.2}
              step={0.1}
              value={i}
              disabled={!isTeacherUnlocked}
              onChange={(event) => onIChange(Number(event.target.value))}
            />
            <strong>{i.toFixed(1)}</strong>
          </div>
          <div className="pid-row">
            <label>D</label>
            <input
              type="range"
              min={0.1}
              max={2.5}
              step={0.1}
              value={d}
              disabled={!isTeacherUnlocked}
              onChange={(event) => onDChange(Number(event.target.value))}
            />
            <strong>{d.toFixed(1)}</strong>
          </div>

          {!isTeacherUnlocked && (
            <div className="teacher-lock">
              <p>
                <Lock size={14} /> {t.teacherCodeLabel}
              </p>
              <input
                value={teacherCode}
                onChange={(event) => onTeacherCodeChange(event.target.value)}
                placeholder={t.unlockPlaceholder}
              />
              <button onClick={onUnlock} className="unlock-btn">
                <ShieldCheck size={14} /> {t.unlock}
              </button>
            </div>
          )}
        </div>

        <div className="chart-panel">
          <svg viewBox="0 0 420 180" role="img" aria-label="PID chart">
            <defs>
              <linearGradient id="lineGlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#4cc9f0" />
                <stop offset="100%" stopColor="#fca311" />
              </linearGradient>
            </defs>
            <polyline fill="none" stroke="url(#lineGlow)" strokeWidth="3" points={chartPath} />
          </svg>
        </div>
      </div>
    </>
  );
}
