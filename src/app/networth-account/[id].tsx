// How a connected bank account shows in net worth: rename it, move it to
// another group, or leave it out. Its balance still comes from the bank, and
// budgets and transactions aren't affected.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';

import { Button, Card, Chip, ErrorText, Input, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { Account, fetchAccounts, updateAccountNetWorth } from '@/lib/data';
import { money } from '@/lib/format';

const ASSET_KINDS = [
  { value: 'cash', label: '💵 Cash & savings' },
  { value: 'investment', label: '📈 Investments & retirement' },
  { value: 'other', label: '📦 Other assets' },
];
const DEBT_KINDS = [
  { value: 'credit_card', label: '💳 Credit card' },
  { value: 'mortgage', label: '🏠 Mortgage' },
  { value: 'auto_loan', label: '🚗 Auto loan' },
  { value: 'student_loan', label: '🎓 Student loan' },
  { value: 'loan', label: '🏦 Other loan' },
];

/** The group the account lands in when you don't pick one. */
function autoKind(a: Account) {
  if (a.type === 'investment') return 'investment';
  if (a.type === 'depository') return 'cash';
  if (a.type === 'credit') return 'credit_card';
  if (a.subtype === 'mortgage' || a.subtype === 'home equity') return 'mortgage';
  if (a.subtype === 'auto') return 'auto_loan';
  if (a.subtype === 'student') return 'student_loan';
  return 'loan';
}

export default function NetWorthAccount() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [nickname, setNickname] = useState('');
  const [kind, setKind] = useState<string>('');
  const [counted, setCounted] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts()
      .then((all) => {
        const a = all.find((x) => x.id === id);
        if (!a) return setError('Account not found');
        setAccount(a);
        setNickname(a.nickname ?? '');
        setKind(a.net_worth_kind ?? autoKind(a));
        setCounted(!a.net_worth_excluded);
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  if (!account) {
    return (
      <Screen>
        <ErrorText message={error} />
        {!error && <T variant="muted">Loading…</T>}
      </Screen>
    );
  }

  const isDebt = account.type === 'credit' || account.type === 'loan';
  const kinds = isDebt ? DEBT_KINDS : ASSET_KINDS;
  const bankName = `${account.name}${account.last_four ? ` ••${account.last_four}` : ''}`;
  const balance = isDebt
    ? Math.abs(account.balance_ledger ?? 0)
    : (account.balance_ledger ?? account.balance_available ?? 0);

  async function save() {
    if (!account) return;
    setSaving(true);
    setError(null);
    try {
      await updateAccountNetWorth(account.id, {
        nickname: nickname.trim() || null,
        net_worth_kind: kind === autoKind(account) ? null : kind,
        net_worth_excluded: !counted,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Net worth item' }} />
      <Card>
        <T variant="heading">{account.nickname || bankName}</T>
        <T variant="muted">
          {account.institution_name ?? 'Connected account'} · {bankName}
        </T>
        <T variant="money" style={{ fontSize: 24, fontWeight: '800' }}>
          {isDebt ? '−' : ''}
          {money(balance)}
        </T>
        <T variant="small">The balance updates from your bank with every sync.</T>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '600' }}>Count in net worth</T>
            <T variant="small">
              Turn off to leave it out of net worth. Its transactions still count in your budgets.
            </T>
          </View>
          <Switch value={counted} onValueChange={setCounted} accessibilityLabel="Count in net worth" />
        </Row>
      </Card>

      {counted && (
        <>
          <Card>
            <T variant="small">Name in net worth</T>
            <Input value={nickname} onChangeText={setNickname} placeholder={bankName} maxLength={60} />
          </Card>
          <Card>
            <T variant="small">Group</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
              {kinds.map((k) => (
                <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(k.value)} />
              ))}
            </View>
          </Card>
        </>
      )}

      <ErrorText message={error} />
      <Button title="Save" onPress={save} loading={saving} />
      <T variant="small">
        To stop syncing this bank entirely, remove it on the Accounts tab.
      </T>
    </Screen>
  );
}
