import { Code2, Gauge, Joystick } from 'lucide-react';
import type { AppCopy } from '../i18n';
import type { Tab } from '../types';

export function NavRail({
  activeTab,
  t,
  onTabChange,
}: {
  activeTab: Tab;
  t: AppCopy;
  onTabChange: (tab: Tab) => void;
}) {
  return (
    <aside className="nav-column">
      <button onClick={() => onTabChange('drive')} className={activeTab === 'drive' ? 'nav-on' : ''} aria-label="Drive">
        <Joystick size={18} />
        <span>{t.drive}</span>
      </button>
      <button onClick={() => onTabChange('logic')} className={activeTab === 'logic' ? 'nav-on' : ''} aria-label="Logic">
        <Code2 size={18} />
        <span>{t.logic}</span>
      </button>
      <button onClick={() => onTabChange('studio')} className={activeTab === 'studio' ? 'nav-on' : ''} aria-label="Studio">
        <Gauge size={18} />
        <span>{t.studio}</span>
      </button>
    </aside>
  );
}
