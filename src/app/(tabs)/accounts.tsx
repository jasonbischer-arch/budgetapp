import { useState } from 'react';
import { Alert, Platform, Pressable, Share, Switch, View } from 'react-native';

import TellerConnect from '@/components/teller-connect';
import { TELLER_APP_ID, TellerEnrollment } from '@/components/teller-connect.shared';
import { Button, Card, Divider, ErrorText, Row, Screen, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  fetchAccounts,
  fetchEnrollments,
  setAccountHidden,
  useQuery,
} from '@/lib/data';
import { money, timeAgo } from '@/lib/format';
import { callFunction } from '@/lib/supabase';

export default function Accounts() {
  const c = useTheme();
  const { household, signOut } = useAuth();
  const [connecting, setConnecting] = useState<{ enrollmentId?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useQuery(
    async () => {
      const [enrollments, accounts] = await Promise.all([fetchEnrollments(), fetchAccounts()]);
      return { enrollments, accounts };
    },
    { enrollments: [], accounts: [] },
  );

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      reload();
    }
  }

  function onEnrolled(enrollment: TellerEnrollment) {
    setConnecting(null);
    run('enroll', () =>
      callFunction('teller-enroll', {
        accessToken: enrollment.accessToken,
        enrollment: enrollment.enrollment,
      }),
    );
  }

  function confirmRemove(id: string, name: string) {
    const go = () => run('remove', () => callFunction('teller-disconnect', { enrollmentId: id }));
    const msg = `Remove ${name}? This revokes the app's access to the bank and deletes its transaction history from the app.`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) go();
    } else {
      Alert.alert('Remove bank', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: go },
      ]);
    }
  }

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <T variant="title">Accounts</T>

      <Row style={{ gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button
            title="Connect a bank"
            onPress={() =>
              TELLER_APP_ID
                ? setConnecting({})
                : setActionError('Teller app ID is missing. Add EXPO_PUBLIC_TELLER_APP_ID to .env and restart.')
            }
            loading={busy === 'enroll'}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Sync now"
            kind="secondary"
            onPress={() => run('sync', () => callFunction('teller-sync'))}
            loading={busy === 'sync'}
            disabled={data.enrollments.length === 0}
          />
        </View>
      </Row>
      <ErrorText message={error ?? actionError} />

      {data.enrollments.map((en) => {
        const accounts = data.accounts.filter((a) => a.enrollment_id === en.id);
        const name = en.institution_name ?? 'Bank';
        return (
          <Card key={en.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flexShrink: 1 }}>
                <T variant="heading">{name}</T>
                <T variant="small">
                  {en.status === 'active' ? `Synced ${timeAgo(en.last_synced_at)}` : null}
                </T>
              </View>
              <Pressable onPress={() => confirmRemove(en.id, name)} hitSlop={8}>
                <T variant="small" color={c.negative}>Remove</T>
              </Pressable>
            </Row>

            {en.status !== 'active' && (
              <View style={{ gap: 8 }}>
                <T color={c.warning}>
                  {en.status === 'disconnected'
                    ? 'This bank needs you to sign in again.'
                    : `Last sync failed: ${en.last_error ?? 'unknown error'}`}
                </T>
                <Button
                  title="Reconnect"
                  kind="secondary"
                  onPress={() => setConnecting({ enrollmentId: en.id })}
                />
              </View>
            )}

            {accounts.map((a) => (
              <View key={a.id} style={{ gap: 8 }}>
                <Divider />
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flexShrink: 1 }}>
                    <T numberOfLines={1} style={a.hidden ? { opacity: 0.5 } : undefined}>
                      {a.name}
                      {a.last_four ? ` ••${a.last_four}` : ''}
                    </T>
                    <T variant="small">{a.subtype?.replace(/_/g, ' ') ?? a.type}</T>
                  </View>
                  <Row style={{ gap: 12 }}>
                    <T variant="money">
                      {money(a.type === 'credit' ? a.balance_ledger : (a.balance_available ?? a.balance_ledger))}
                    </T>
                    <Switch
                      accessibilityLabel={`Include ${a.name}`}
                      value={!a.hidden}
                      onValueChange={(v) => run('hide', () => setAccountHidden(a.id, !v))}
                    />
                  </Row>
                </Row>
              </View>
            ))}
          </Card>
        );
      })}

      <Card>
        <T variant="heading">Household</T>
        <T variant="muted">
          Share this invite code so your partner can join {household?.name ?? 'your household'}:
        </T>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="title" style={{ letterSpacing: 3 }} selectable>
            {household?.invite_code}
          </T>
          {Platform.OS !== 'web' && (
            <Button
              title="Share"
              kind="secondary"
              onPress={() =>
                Share.share({ message: `Join our budget app with code ${household?.invite_code}` })
              }
            />
          )}
        </Row>
      </Card>

      <Button title="Sign out" kind="secondary" onPress={signOut} />

      {connecting && (
        <TellerConnect
          enrollmentId={connecting.enrollmentId}
          onSuccess={onEnrolled}
          onExit={() => setConnecting(null)}
        />
      )}
    </Screen>
  );
}
