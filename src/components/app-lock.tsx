import * as LocalAuthentication from 'expo-local-authentication';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { Button, T } from './ui';

// Re-lock after the app has been in the background this long.
const RELOCK_AFTER_MS = 60_000;

/**
 * Requires Face ID / Touch ID (or the phone passcode) to open the app on
 * iPhone. Does nothing on the web or on phones with no screen lock set up.
 */
export function AppLock({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const c = useTheme();
  const active = enabled && Platform.OS !== 'web';
  const [locked, setLocked] = useState(active);
  const [available, setAvailable] = useState<boolean | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Budget',
      fallbackLabel: 'Use passcode',
    });
    if (result.success) setLocked(false);
  }, []);

  useEffect(() => {
    if (!active) return;
    (async () => {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      const ok = level !== LocalAuthentication.SecurityLevel.NONE;
      setAvailable(ok);
      if (ok) unlock();
      else setLocked(false);
    })();
  }, [active, unlock]);

  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current != null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away > RELOCK_AFTER_MS && available) {
          setLocked(true);
          unlock();
        }
      }
    });
    return () => sub.remove();
  }, [active, available, unlock]);

  if (!active || !locked) return <>{children}</>;
  return (
    <View style={[styles.lock, { backgroundColor: c.background }]}>
      <T variant="title">Budget is locked</T>
      <T variant="muted">Unlock with Face ID or your passcode.</T>
      {available !== null && <Button title="Unlock" onPress={unlock} />}
    </View>
  );
}

const styles = StyleSheet.create({
  lock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
});
