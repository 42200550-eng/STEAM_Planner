import { useMemo, useState } from 'react';
import type { AppCopy } from '../i18n';
import type { GatewayStats } from '../lib/robotGateway';

export function SystemStatusPanel({
  t,
  stats,
}: {
  t: AppCopy;
  stats: GatewayStats;
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const linkQuality = useMemo(() => {
    if (!stats.online) {
      return 0;
    }
    const lossPenalty = Math.min(100, stats.packetLossPct * 4);
    const latencyPenalty = Math.min(100, stats.avgLatencyMs / 2.5);
    const base = 100 - lossPenalty - latencyPenalty;
    return Math.max(5, Math.min(100, Number(base.toFixed(0))));
  }, [stats.avgLatencyMs, stats.online, stats.packetLossPct]);

  const commandFlow = useMemo(() => {
    const pressure = Math.max(0, 100 - stats.queueDepth * 5);
    return Math.max(5, Math.min(100, pressure));
  }, [stats.queueDepth]);

  const safetyWindow = useMemo(() => {
    const failures = stats.failed + stats.dropped;
    const score = Math.max(0, 100 - failures * 10 - stats.packetLossPct * 2);
    return Number(score.toFixed(0));
  }, [stats.dropped, stats.failed, stats.packetLossPct]);

  return (
    <>
      <div className="logic-header mission-head">
        <h2>{t.systemDeckTitle}</h2>
        <p>{t.missionMode}: {stats.online ? 'SYNCED' : 'RECOVERY'}</p>
      </div>

      <div className="mission-grid">
        <div className="mission-card mission-card-primary">
          <p>{t.linkQuality}</p>
          <strong>{linkQuality}%</strong>
          <div className="mission-bar">
            <span style={{ width: `${linkQuality}%` }} />
          </div>
        </div>

        <div className="mission-card">
          <p>{t.commandFlow}</p>
          <strong>{commandFlow}%</strong>
          <div className="mission-bar mission-bar-cool">
            <span style={{ width: `${commandFlow}%` }} />
          </div>
        </div>

        <div className="mission-card">
          <p>{t.safetyWindow}</p>
          <strong>{safetyWindow}%</strong>
          <div className="mission-bar mission-bar-warn">
            <span style={{ width: `${safetyWindow}%` }} />
          </div>
        </div>

        <div className="mission-kpis">
          <div>
            <p>{t.gatewayOnline}</p>
            <strong className={stats.online ? 'system-ok' : 'system-bad'}>{stats.online ? 'ONLINE' : 'OFFLINE'}</strong>
          </div>
          <div>
            <p>{t.avgLatency}</p>
            <strong>{stats.avgLatencyMs.toFixed(1)} ms</strong>
          </div>
          <div>
            <p>{t.queueDepth}</p>
            <strong>{stats.queueDepth}</strong>
          </div>
        </div>
      </div>

      <div className="diagnostics-toggle-wrap">
        <button type="button" className="diagnostics-toggle" onClick={() => setShowDiagnostics((current) => !current)}>
          {showDiagnostics ? t.diagnosticsClose : t.diagnosticsOpen}
        </button>
        <p>{t.diagnosticsHint}</p>
      </div>

      {showDiagnostics && (
        <div className="system-line diagnostics-panel">
          <span>health ping: {stats.healthLatencyMs === null ? 'n/a' : `${stats.healthLatencyMs.toFixed(1)} ms`}</span>
          <span>sent: {stats.sent}</span>
          <span>{t.retries}: {stats.retries}</span>
          <span>{t.failed}: {stats.failed}</span>
          <span>{t.packetLoss}: {stats.packetLossPct.toFixed(2)}%</span>
          {stats.lastError && <span className="system-error">last error: {stats.lastError}</span>}
        </div>
      )}

      {!showDiagnostics && (
        <div className="system-line diagnostics-idle">
          <span>Mission instrumentation active. Deep logs are hidden.</span>
        </div>
      )}
      
      <div className="mission-grid mission-grid-mini">
        <div className="mission-card compact">
          <p>TX</p>
          <strong>{stats.sent}</strong>
        </div>
        <div className="mission-card compact">
          <p>Retry</p>
          <strong>{stats.retries}</strong>
        </div>
        <div className="mission-card compact">
          <p>Loss</p>
          <strong>{stats.packetLossPct.toFixed(2)}%</strong>
        </div>
      </div>
    </>
  );
}
