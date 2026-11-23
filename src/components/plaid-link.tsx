import { useEffect, useRef } from 'react';

import { PlaidLinkProps } from './plaid-link.shared';

type PlaidSdk = typeof import('react-native-plaid-link-sdk');

// Plaid's SDK is native code, so it isn't in Expo Go. Load it lazily and give
// a clear message instead of crashing when it's missing.
function loadSdk(): PlaidSdk | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-plaid-link-sdk') as PlaidSdk;
  } catch {
    return null;
  }
}

/** Opens Plaid Link full screen as soon as it mounts (iPhone). */
export default function PlaidLink({ linkToken, onSuccess, onExit }: PlaidLinkProps) {
  const handlers = useRef({ onSuccess, onExit });
  handlers.current = { onSuccess, onExit };

  useEffect(() => {
    const sdk = loadSdk();
    if (!sdk) {
      handlers.current.onExit(
        'Connecting a bank on iPhone needs the installed app (a development build), not Expo Go. ' +
          'You can connect banks from the website, and they will show up here.',
      );
      return;
    }
    sdk
      .createPlaidLinkSession({
        token: linkToken,
        onSuccess: (success) =>
          handlers.current.onSuccess({
            publicToken: success.publicToken,
            institution: success.metadata.institution ?? null,
          }),
        onExit: (exit) => handlers.current.onExit(exit.error?.displayMessage ?? undefined),
        onEvent: () => {},
      })
      .then((session) => session.open(true))
      .catch(() => handlers.current.onExit("Couldn't open Plaid. Please try again."));
  }, [linkToken]);

  return null;
}
