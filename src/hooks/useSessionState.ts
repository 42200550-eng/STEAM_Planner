import { useEffect, useState } from 'react';

export function useSessionState<T>(key: string, initialValue: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) {
        return initialValue;
      }
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Ignore quota/security errors and keep app responsive.
    }
  }, [key, state]);

  return [state, setState] as const;
}
