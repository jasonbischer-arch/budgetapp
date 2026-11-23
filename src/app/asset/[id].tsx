import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';

import { Button, Card, ErrorText, Input, Screen, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  Account,
  AssetKind,
  Bill,
  deleteManualAsset,
  fetchAccounts,
  fetchBills,
  fetchManualAssets,
  saveManualAsset,
} from '@/lib/data';
import { money } from '@/lib/format';
import { today } from '@/lib/schedule';

const KINDS: { value: AssetKind; label: string; rate: number; hint: string }[] = [
  { value: 'home', label: 'Home', rate: 3, hint: 'Your best estimate of what it would sell for.' },
  { value: 'vehicle', label: 'Vehicle', rate: -15, hint: 'Check a pricing guide for your make, model and mileage.' },
  { value: 'investment', label: 'Investment', rate: 0, hint: 'An account that isn’t connected (e.g. a pension or HSA).' },
  { value: 'cash', label: 'Cash', rate: 0, hint: 'Cash or an account that isn’t connected.' },
  { value: 'other', label: 'Other', rate: 0, hint: 'Jewelry, collectibles, a business, money someone owes you…' },
];

/** Today's estimate: the entered value grown/shrunk by the yearly rate (same as the database). */
function estimateToday(value: number, valueDate: string, pct: number) {
  const years = (Date.parse(today()) - Date.parse(valueDate)) / (365.25 * 86_400_000);
  return Math.round(value * Math.pow(1 + pct / 100, Math.max(0, years)) * 100) / 100;
}

const parseNum = (s: string) => {
  const cleaned = s.replace(/[^0-9.-]/g, '');
  return cleaned === '' || cleaned === '-' ? null : Number(cleaned);
};

export default function AssetEditor() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { household } = useAuth();

  const [kind, setKind] = useState<AssetKind>('home');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [rate, setRate] = useState('3');
  const [loan, setLoan] = useState<{ account?: string; bill?: string } | null>(null);
  const [loanAccounts, setLoanAccounts] = useState<Account[]>([]);
  const [debtBills, setDebtBills] = useState<Bill[]>([]);
  const [original, setOriginal] = useState<{ value: number; date: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [accounts, bills, assets] = await Promise.all([fetchAccounts(), fetchBills(), fetchManualAssets()]);
      setLoanAccounts(accounts.filter((a) => a.type === 'loan'));
      setDebtBills(bills.filter((b) => b.is_debt && !b.account_id));
      if (!isNew) {
        const a = assets.find((x) => x.id === id);
        if (!a) return setError('Not found');
        setKind(a.kind);
        setName(a.name);
        // Start from today's estimate, so saving without changes keeps it.
        setValue(String(estimateToday(a.value, a.value_date, a.annual_change_pct)));
        setRate(String(a.annual_change_pct));
        setOriginal({ value: a.value, date: a.value_date });
        setLoan(a.loan_account_id ? { account: a.loan_account_id } : a.loan_bill_id ? { bill: a.loan_bill_id } : null);
      }
    })().catch((e) => setError(String(e)));
  }, [id, isNew]);

  const kindInfo = KINDS.find((k) => k.value === kind)!;
  const amount = parseNum(value);
  const pct = parseNum(rate) ?? 0;
  const valid = !!name.trim() && amount != null && amount >= 0 && pct >= -50 && pct <= 50;
  const canHaveLoan = kind === 'home' || kind === 'vehicle';

  function pickKind(k: AssetKind) {
    setKind(k);
    if (isNew) setRate(String(KINDS.find((x) => x.value === k)!.rate));
  }

  async function save() {
    if (!household || !valid) return;
    setSaving(true);
    try {
      await saveManualAsset(household.id, {
        ...(isNew ? {} : { id }),
        name: name.trim(),
        kind,
        value: amount!,
        // Entering a value resets the estimate's starting point to today.
        value_date: today(),
        annual_change_pct: pct,
        loan_account_id: canHaveLoan ? (loan?.account ?? null) : null,
        loan_bill_id: canHaveLoan ? (loan?.bill ?? null) : null,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  function remove() {
    const go = async () => {
      await deleteManualAsset(id).catch((e) => setError(String(e)));
      router.back();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${name}?`)) go();
    } else {
      Alert.alert('Delete asset', `Delete ${name}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: go },
      ]);
    }
  }

  const Chip = ({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) => (
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

  return (
    <Screen>
      <Card>
        <T variant="small">What is it?</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
          {KINDS.map((k) => (
            <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => pickKind(k.value)} />
          ))}
        </View>
        <T variant="small">Name</T>
        <Input
          value={name}
          onChangeText={setName}
          maxLength={80}
          placeholder={kind === 'home' ? 'e.g. Our house' : kind === 'vehicle' ? 'e.g. 2021 Honda CR-V' : 'Name'}
        />
        <T variant="small">Current value</T>
        <Input value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder="$0" />
        <T variant="small">{kindInfo.hint}</T>
        {original && original.date !== today() && (
          <T variant="small">
            Today&apos;s estimate, from {money(original.value)} entered on {original.date}. Type a
            new value if you have a better number.
          </T>
        )}
      </Card>

      <Card>
        <T variant="small">Change per year (%)</T>
        <Input value={rate} onChangeText={setRate} keyboardType="numbers-and-punctuation" placeholder="0" />
        <T variant="small">
          {pct > 0
            ? `Grows ${pct}% a year until you update it.`
            : pct < 0
              ? `Loses ${Math.abs(pct)}% of its value a year until you update it.`
              : 'Stays at this value until you update it.'}
          {amount ? ` In a year: about ${money(amount * (1 + pct / 100))}.` : ''}
        </T>
      </Card>

      {canHaveLoan && (
        <Card>
          <T variant="small">Loan on it (to show your equity)</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
            <Chip label="No loan" selected={!loan} onPress={() => setLoan(null)} />
            {loanAccounts.map((a) => (
              <Chip
                key={a.id}
                label={`${a.name}${a.last_four ? ` ••${a.last_four}` : ''} (${money(Math.abs(a.balance_ledger ?? 0))})`}
                selected={loan?.account === a.id}
                onPress={() => setLoan({ account: a.id })}
              />
            ))}
            {debtBills.map((b) => (
              <Chip
                key={b.id}
                label={`${b.name}${b.balance != null ? ` (${money(b.balance)})` : ''}`}
                selected={loan?.bill === b.id}
                onPress={() => setLoan({ bill: b.id })}
              />
            ))}
          </View>
          {loanAccounts.length === 0 && debtBills.length === 0 && (
            <T variant="small">
              No loans yet. Connect the lender, or add the loan as a debt in Plan → Bills.
            </T>
          )}
        </Card>
      )}

      <ErrorText message={error} />
      <Button title="Save" onPress={save} loading={saving} disabled={!valid} />
      {!isNew && <Button title="Delete" kind="danger" onPress={remove} />}
      <View style={{ height: Spacing.xl }} />
    </Screen>
  );
}
