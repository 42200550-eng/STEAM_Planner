import { useEffect, useState } from 'react';
import { AwakeningScreen } from './components/AwakeningScreen';
import { MonolithicDashboard } from './components/MonolithicDashboard';
import { copy } from './i18n';
import { useMockRobotStream } from './hooks/useMockRobotStream';
import type { AppPhase, Language } from './types';

export default function App() {
  const [language] = useState<Language>('vi');
  const [phase, setPhase] = useState<AppPhase>('void');
  useMockRobotStream(phase === 'connected');
  const t = copy[language];

  useEffect(() => {
    console.log('[app] mounted');
    const detectTimer = window.setTimeout(() => setPhase('connected'), 2600);
    return () => window.clearTimeout(detectTimer);
  }, []);

  if (phase !== 'connected') {
    return <AwakeningScreen />;
  }

  return <MonolithicDashboard t={t} />;
}
