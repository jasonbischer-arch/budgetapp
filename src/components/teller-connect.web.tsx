import { useEffect, useRef } from 'react';

import {
  TELLER_SCRIPT,
  TellerConnectProps,
  TellerEnrollment,
  tellerSetupOptions,
} from './teller-connect.shared';

declare global {
  interface Window {
    TellerConnect?: {
      setup: (opts: Record<string, unknown>) => { open: () => void };
    };
  }
}

function loadScript(): Promise<void> {
  if (window.TellerConnect) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TELLER_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Could not load Teller Connect')));
    if (!existing) {
      script.src = TELLER_SCRIPT;
      document.head.appendChild(script);
    }
  });
}

/** Opens Teller Connect as an overlay as soon as it mounts. */
export default function TellerConnect({ enrollmentId, onSuccess, onExit }: TellerConnectProps) {
  const handlers = useRef({ onSuccess, onExit });
  handlers.current = { onSuccess, onExit };

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !window.TellerConnect) return;
        window.TellerConnect.setup({
          ...tellerSetupOptions(enrollmentId),
          onSuccess: (e: TellerEnrollment) => handlers.current.onSuccess(e),
          onExit: () => handlers.current.onExit?.(),
        }).open();
      })
      .catch(() => handlers.current.onExit?.());
    return () => {
      cancelled = true;
    };
  }, [enrollmentId]);

  return null;
}
