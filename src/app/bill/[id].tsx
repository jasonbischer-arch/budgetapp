import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, Switch, View } from 'react-native';

import { Button, Card, ErrorText, Input, Row, Screen, Segmented, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  Account,
  BillFrequency,
  deleteBill,
  fetchAccounts,
  fetchBills,
  fetchLiabilities,
  Liability,
  saveBill,
} from '@/lib/data';
import { money, ordinal } from '@/lib/format';

const FREQUENCIES: { value: BillFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parseNum = (s: string) => {
  const cleaned = s.replace(/[^0-9.]/g, '');
  return cleaned === '' ? null : Number(cleaned);
};

export default function BillEditor() {
  const c = useTheme();
  const { id, accountId } = useLocalSearchParams<{ id: string; accountId?: string }>();
  const isNew = id === 'new';
  const { household } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<BillFrequency>('monthly');
  const [dueDay, setDueDay] = useState('');
  const [dueMonth, setDueMonth] = useState<number | null>(null);
  const [isDebt, setIsDebt] = useState(false);
  const [balance, setBalance] = useState('');
  const [apr, setApr] = useState('');
  const [linked, setLinked] = useState<string | null>(accountId ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [accts, liabs, bills] = await Promise.all([fetchAccounts(), fetchLiabilities(), fetchBills()]);
      setAccounts(accts.filter((a) => a.type === 'credit' || a.type === 'loan'));
      setLiabilities(liabs);
      if (!isNew) {
        const b = bills.find((x) => x.id === id);
        if (!b) return setError('Bill not found');
        setName(b.name);
        setAmount(b.amount != null ? String(b.amount) : '');
        setFrequency(b.frequency);
        setDueDay(String(b.due_day));
        setDueMonth(b.due_month);
        setIsDebt(b.is_debt);
        setBalance(b.balance != null ? String(b.balance) : '');
        setApr(b.apr != null ? String(b.apr) : '');
        setLinked(b.account_id);
      } else if (accountId) {
        // Tracking a connected card/loan: prefill from the bank.
        const a = accts.find((x) => x.id === accountId);
        const l = liabs.find((x) => x.account_id === accountId);
        setName(a ? `${a.name}${a.last_four ? ` ••${a.last_four}` : ''}` : '');
        setIsDebt(true);
        if (l?.next_due_date) setDueDay(String(Number(l.next_due_date.slice(8))));
      }
    })().catch((e) => setError(String(e)));
  }, [id, isNew, accountId]);

  const linkedAccount = accounts.find((a) => a.id === linked);
  const liability = liabilities.find((l) => l.account_id === linked);
  const day = Number(dueDay);
  const draft = {
    name: name.trim(),
    amount: parseNum(amount),
    frequency,
    due_day: day,
    due_month: frequency === 'monthly' ? null : dueMonth,
    is_debt: isDebt,
    balance: isDebt && !linked ? parseNum(balance) : null,
    apr: isDebt ? parseNum(apr) : null,
    account_id: linked,
    category_id: null,
  };
  const amountOk = draft.amount != null ? draft.amount >= 0 : !!liability?.minimum_payment;
  const valid =
    !!draft.name &&
    amountOk &&
    Number.isInteger(day) &&
    day >= 1 &&
    day <= 31 &&
    (frequency === 'monthly' || !!dueMonth) &&
    (draft.apr == null || (draft.apr >= 0 && draft.apr <= 100));

  async function save() {
    if (!household || !valid) return;
    setSaving(true);
    try {
      await saveBill(household.id, { ...(isNew ? {} : { id }), ...draft });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  function remove() {
    const go = async () => {
      await deleteBill(id).catch((e) => setError(String(e)));
      router.back();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${name}?`)) go();
    } else {
      Alert.alert('Delete bill', `Delete ${name}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: go },
      ]);
    }
  }

  return (
    <Screen>
      <Card>
        <T variant="small">Name</T>
        <Input value={name} onChangeText={setName} placeholder="e.g. Rent, Car loan, Netflix" maxLength={80} />
        <T variant="small">Amount</T>
        <Input
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder={
            liability?.minimum_payment != null
              ? `Minimum payment (${money(liability.minimum_payment)})`
              : '$0.00'
          }
        />
        {linked && liability?.minimum_payment != null && (
          <T variant="small">Leave blank to always use the bank&apos;s current minimum payment.</T>
        )}
      </Card>

      <Card>
        <T variant="small">How often</T>
        <Segmented options={FREQUENCIES} value={frequency} onChange={setFrequency} />
        {frequency !== 'monthly' && (
          <>
            <T variant="small">{frequency === 'yearly' ? 'Month it’s due' : 'First month it’s due'}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
              {MONTHS.map((m, i) => (
                <Chip key={m} label={m} selected={dueMonth === i + 1} onPress={() => setDueMonth(i + 1)} />
              ))}
            </View>
          </>
        )}
        <T variant="small">Due day of the month</T>
        <Input value={dueDay} onChangeText={setDueDay} placeholder="1–31" keyboardType="number-pad" />
        {Number.isInteger(day) && day >= 1 && day <= 31 && (
          <T variant="small">Due on the {ordinal(day)}{day > 28 ? ' (or the last day in shorter months)' : ''}.</T>
        )}
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T>This is a debt</T>
            <T variant="small">Credit cards, car, student and personal loans, mortgage.</T>
          </View>
          <Switch value={isDebt} onValueChange={setIsDebt} />
        </Row>
        {isDebt && (
          <>
            {accounts.length > 0 && (
              <>
                <T variant="small">Connected account (keeps the balance updated)</T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
                  <Chip label="None" selected={!linked} onPress={() => setLinked(null)} />
                  {accounts.map((a) => (
                    <Chip
                      key={a.id}
                      label={`${a.name}${a.last_four ? ` ••${a.last_four}` : ''}`}
                      selected={linked === a.id}
                      onPress={() => setLinked(a.id)}
                    />
                  ))}
                </View>
              </>
            )}
            {linkedAccount ? (
              <T variant="small">
                Balance {money(Math.abs(linkedAccount.balance_ledger ?? 0))}, synced from your bank
                {liability?.apr != null ? ` · ${liability.apr}% APR from your bank` : ''}.
              </T>
            ) : (
              <>
                <T variant="small">Current balance</T>
                <Input value={balance} onChangeText={setBalance} placeholder="$0.00" keyboardType="decimal-pad" />
              </>
            )}
            <T variant="small">Interest rate (APR %)</T>
            <Input
              value={apr}
              onChangeText={setApr}
              keyboardType="decimal-pad"
              placeholder={liability?.apr != null ? `${liability.apr} (from your bank)` : 'e.g. 22.9'}
            />
          </>
        )}
      </Card>

      <ErrorText message={error} />
      <Button title="Save" onPress={save} loading={saving} disabled={!valid} />
      {!isNew && <Button title="Delete bill" kind="danger" onPress={remove} />}
      <View style={{ height: Spacing.xl }} />
    </Screen>
  );

  function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityState={{ selected }}
        style={{
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: Radius.pill,
          borderWidth: 1,
          borderColor: selected ? c.primary : c.border,
          backgroundColor: selected ? c.primary : 'transparent',
        }}>
        <T variant="small" color={selected ? c.primaryText : c.text}>
          {label}
        </T>
      </Pressable>
    );
  }
}
