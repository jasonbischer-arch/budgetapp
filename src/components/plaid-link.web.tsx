import { useEffect, useRef } from 'react';

import { PlaidLinkProps } from './plaid-link.shared';

const PLAID_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string, metadata: { institution?: { institution_id: string; name: string } | null }) => void;
        onExit: (error: { display_message?: string | null } | null) => void;
      }) => PlaidHandler;
    };
  }
}

function loadScript(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLAID_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () =>
      reject(new Error("Couldn't load Plaid. Check that an ad blocker isn't blocking cdn.plaid.com.")),
    );
    if (!existing) {
      script.src = PLAID_SCRIPT;
      document.head.appendChild(script);
    }
  });
}

/** Opens Plaid Link as an overlay as soon as it mounts. */
export default function PlaidLink({ linkToken, onSuccess, onExit }: PlaidLinkProps) {
  const handlers = useRef({ onSuccess, onExit });
  handlers.current = { onSuccess, onExit };

  useEffect(() => {
    let handler: PlaidHandler | undefined;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !window.Plaid) return;
        handler = window.Plaid.create({
          token: linkToken,
          onSuccess: (publicToken, metadata) =>
            handlers.current.onSuccess({
              publicToken,
              institution: metadata.institution
                ? { id: metadata.institution.institution_id, name: metadata.institution.name }
                : null,
            }),
          onExit: (error) => handlers.current.onExit(error?.display_message ?? undefined),
        });
        handler.open();
      })
      .catch((e: Error) => handlers.current.onExit(e.message));
    return () => {
      cancelled = true;
      handler?.destroy();
    };
  }, [linkToken]);

  return null;
}
