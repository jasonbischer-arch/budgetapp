import { useState } from 'react';
import { Alert, Platform, Pressable, Share, Switch, View } from 'react-native';

import PlaidLink from '@/components/plaid-link';
import { PlaidLinkSuccess } from '@/components/plaid-link.shared';
import { Button, Card, Divider, ErrorText, Row, Screen, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { fetchAccounts, fetchBankItems, rotateInviteCode, setAccountHidden, useQuery } from '@/lib/data';
import { money, timeAgo } from '@/lib/format';
import { callFunction } from '@/lib/supabase';

/** A Plaid Link session: a new bank, or reconnecting an existing one. */
interface LinkSession {
  linkToken: string;
  itemId?: string;
}

export default function Accounts() {
  const c = useTheme();
  const { household, signOut, refreshHousehold } = useAuth();
  const [link, setLink] = useState<LinkSession | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useQuery(
    async () => {
      const [items, accounts] = await Promise.all([fetchBankItems(), fetchAccounts()]);
      return { items, accounts };
    },
    { items: [], accounts: [] },
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

  /** Gets a Link token from the server, then opens Plaid Link. */
  function startLink(itemId?: string) {
    run(itemId ? `reconnect-${itemId}` : 'connect', async () => {
      const { linkToken } = await callFunction<{ linkToken: string }>(
        'plaid-link-token',
        itemId ? { itemId } : {},
      );
      setLink({ linkToken, itemId });
    });
  }

  function onLinked(result: PlaidLinkSuccess) {
    const session = link;
    setLink(null);
    if (session?.itemId) {
      // Reconnected an existing bank: its token is unchanged, just re-sync.
      run('sync', () => callFunction('plaid-sync', { itemId: session.itemId }));
    } else {
      run('connect', () =>
        callFunction('plaid-exchange', {
          publicToken: result.publicToken,
          institution: result.institution,
        }),
      );
    }
  }

  function onLinkExit(message?: string) {
    setLink(null);
    if (message) setActionError(message);
  }

  function confirmRemove(itemId: string, name: string) {
    const go = () => run('remove', () => callFunction('plaid-disconnect', { itemId }));
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
          <Button title="Connect a bank" onPress={() => startLink()} loading={busy === 'connect'} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Sync now"
            kind="secondary"
            onPress={() => run('sync', () => callFunction('plaid-sync'))}
            loading={busy === 'sync'}
            disabled={data.items.length === 0}
          />
        </View>
      </Row>
      <ErrorText message={error ?? actionError} />

      {data.items.map((item) => {
        const accounts = data.accounts.filter((a) => a.item_id === item.id);
        const name = item.institution_name ?? 'Bank';
        return (
          <Card key={item.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flexShrink: 1 }}>
                <T variant="heading">{name}</T>
                <T variant="small">
                  {item.status === 'active' ? `Synced ${timeAgo(item.last_synced_at)}` : null}
                </T>
              </View>
              <Pressable onPress={() => confirmRemove(item.id, name)} hitSlop={8}>
                <T variant="small" color={c.negative}>
                  Remove
                </T>
              </Pressable>
            </Row>

            {item.status !== 'active' && (
              <View style={{ gap: 8 }}>
                <T color={c.warning}>{item.last_error ?? 'This bank needs attention.'}</T>
                {item.status === 'disconnected' && (
                  <Button
                    title="Reconnect"
                    kind="secondary"
                    onPress={() => startLink(item.id)}
                    loading={busy === `reconnect-${item.id}`}
                  />
                )}
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
                      {money(
                        a.type === 'depository'
                          ? (a.balance_available ?? a.balance_ledger)
                          : a.balance_ledger,
                      )}
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
          Share this invite code so your partner can join {household?.name ?? 'your household'}. A
          household holds two people; once you&apos;ve both joined, nobody else can.
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

      <Button
        title="Make a new invite code"
        kind="secondary"
        loading={busy === 'rotate'}
        onPress={() =>
          run('rotate', async () => {
            await rotateInviteCode();
            await refreshHousehold();
          })
        }
      />
      <Button title="Sign out" kind="secondary" onPress={signOut} />

      {link && <PlaidLink linkToken={link.linkToken} onSuccess={onLinked} onExit={onLinkExit} />}
    </Screen>
  );
}
