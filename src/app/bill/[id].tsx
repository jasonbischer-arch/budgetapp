import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';

import { Button, Card, ErrorText, Input, Row, Screen, Segmented, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  Account,
  Bill,
  BillFrequency,
  deleteBill,
  fetchAccounts,
  fetchBills,
  fetchLiabilities,
  Liability,
  saveBill,
} from '@/lib/data';
import { currentBalance, payoff } from '@/lib/debt';
import { money, ordinal, shortDate } from '@/lib/format';
import { today } from '@/lib/schedule';
import { billEmoji } from '@/lib/visuals';

const FREQUENCIES: { value: BillFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

type Kind = 'bill' | 'debt';
const KINDS: { value: Kind; label: string }[] = [
  { value: 'bill', label: '🧾 Bill or subscription' },
  { value: 'debt', label: '🏦 Loan or debt' },
];

type DebtKind = NonNullable<Bill['debt_kind']>;
const DEBT_KINDS: { value: DebtKind; label: string }[] = [
  { value: 'auto_loan', label: '🚗 Car loan' },
  { value: 'mortgage', label: '🏠 Mortgage' },
  { value: 'student_loan', label: '🎓 Student loan' },
  { value: 'personal_loan', label: '🏦 Personal loan' },
  { value: 'other', label: '🧾 Other' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parseNum = (s: string) => {
  const cleaned = s.replace(/[^0-9.]/g, '');
  return cleaned === '' ? null : Number(cleaned);
};

export default function BillEditor() {
  const c = useTheme();
  const { id, accountId, debt, type } = useLocalSearchParams<{
    id: string;
    accountId?: string;
    debt?: string;
    type?: 'fixed' | 'variable';
  }>();
  const isNew = id === 'new';
  const { household } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [existing, setExisting] = useState<Bill | null>(null);
  const [kind, setKind] = useState<Kind>(debt || accountId ? 'debt' : 'bill');
  const [debtKind, setDebtKind] = useState<DebtKind | null>(null);
  const [expenseType, setExpenseType] = useState<'fixed' | 'variable'>(type === 'variable' ? 'variable' : 'fixed');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<BillFrequency>('monthly');
  const [dueDay, setDueDay] = useState('');
  const [dueMonth, setDueMonth] = useState<number | null>(null);
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
        if (!b) return setError('Not found');
        setExisting(b);
        setKind(b.is_debt ? 'debt' : 'bill');
        setDebtKind(b.debt_kind);
        setExpenseType(b.expense_type ?? 'fixed');
        setName(b.name);
        setAmount(b.amount != null ? String(b.amount) : '');
        setFrequency(b.frequency);
        setDueDay(String(b.due_day));
        setDueMonth(b.due_month);
        // Show today's paid-down balance, so saving without changes keeps it.
        const now = currentBalance({
          balance: b.balance,
          apr: b.apr,
          payment: b.amount,
          balanceDate: b.balance_date,
          dueDay: b.due_day,
          today: today(),
        });
        setBalance(now != null ? String(now) : '');
        setApr(b.apr != null ? String(b.apr) : '');
        setLinked(b.account_id);
      } else if (accountId) {
        const a = accts.find((x) => x.id === accountId);
        const l = liabs.find((x) => x.account_id === accountId);
        setName(a ? `${a.name}${a.last_four ? ` ••${a.last_four}` : ''}` : '');
        setDebtKind(a?.subtype === 'auto' ? 'auto_loan' : a?.subtype === 'mortgage' ? 'mortgage' : a?.subtype === 'student' ? 'student_loan' : null);
        if (l?.next_due_date) setDueDay(String(Number(l.next_due_date.slice(8))));
      }
    })().catch((e) => setError(String(e)));
  }, [id, isNew, accountId]);

  const isDebt = kind === 'debt';
  const linkedAccount = accounts.find((a) => a.id === linked);
  const liability = liabilities.find((l) => l.account_id === linked);
  const day = Number(dueDay);
  const payment = parseNum(amount);
  const bal = parseNum(balance);
  const rate = parseNum(apr);
  const manualDebt = isDebt && !linked;

  // A debt you enter yourself needs balance, rate and payment to pay down.
  const problems: string[] = [];
  if (!name.trim()) problems.push('a name');
  if (payment == null && !(linked && liability?.minimum_payment)) problems.push(isDebt ? 'the monthly payment' : 'the amount');
  if (!(Number.isInteger(day) && day >= 1 && day <= 31)) problems.push('the due day (1–31)');
  if (frequency !== 'monthly' && !dueMonth) problems.push('the month it’s due');
  if (manualDebt && bal == null) problems.push('the balance owed');
  if (manualDebt && rate == null) problems.push('the interest rate (enter 0 if none)');
  if (rate != null && (rate < 0 || rate > 100)) problems.push('an interest rate between 0 and 100');
  const valid = problems.length === 0;

  const preview =
    manualDebt && bal != null && rate != null && payment != null ? payoff(bal, rate, payment, today()) : null;

  async function save() {
    if (!household || !valid) return;
    setSaving(true);
    try {
      const balanceChanged = existing
        ? bal !== currentBalance({
            balance: existing.balance,
            apr: existing.apr,
            payment: existing.amount,
            balanceDate: existing.balance_date,
            dueDay: existing.due_day,
            today: today(),
          })
        : true;
      await saveBill(household.id, {
        ...(isNew ? {} : { id }),
        name: name.trim(),
        amount: payment,
        frequency,
        due_day: day,
        due_month: frequency === 'monthly' ? null : dueMonth,
        is_debt: isDebt,
        debt_kind: isDebt ? debtKind : null,
        balance: manualDebt ? bal : null,
        // The balance pays down from the day you enter it.
        balance_date: manualDebt ? (balanceChanged || !existing?.balance_date ? today() : existing.balance_date) : null,
        apr: isDebt ? rate : null,
        account_id: isDebt ? linked : null,
        category_id: existing?.category_id ?? null,
        expense_type: expenseType,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  function remove() {
    const go = async () => {
      await deleteBill({ id, detection_key: existing?.detection_key ?? null }).catch((e) => setError(String(e)));
      router.back();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${name}?`)) go();
    } else {
      Alert.alert('Delete', `Delete ${name}?`, [
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
      {existing?.detection_key && (
        <Card style={{ padding: Spacing.md, backgroundColor: c.primarySoft, borderColor: c.primarySoft }}>
          <T style={{ fontWeight: '600' }}>
            {billEmoji({ name, is_debt: isDebt, debt_kind: debtKind })} Found in your bank activity
          </T>
          <T variant="small">
            {existing.occurrences ? `Paid ${existing.occurrences} times` : 'From your connected account'}
            {existing.last_paid ? `, last on ${shortDate(existing.last_paid)}` : ''}.{' '}
            {existing.auto ? 'Kept up to date automatically; saving changes makes it yours.' : 'Edited by you.'}
          </T>
        </Card>
      )}

      <Card>
        <Segmented options={KINDS} value={kind} onChange={setKind} />
        <T variant="small">Name</T>
        <Input
          value={name}
          onChangeText={setName}
          maxLength={80}
          placeholder={isDebt ? 'e.g. VW Tiguan (Ally)' : 'e.g. Rent, Electric, Netflix'}
        />
        <T variant="small">{isDebt ? 'Monthly payment' : 'Amount'}</T>
        <Input
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder={
            liability?.minimum_payment != null ? `Minimum payment (${money(liability.minimum_payment)})` : '$0.00'
          }
        />
      </Card>

      <Card>
        <T variant="small">Count it as</T>
        <Segmented
          options={[
            { value: 'fixed', label: '📌 Fixed expense' },
            { value: 'variable', label: '🛒 Variable expense' },
          ]}
          value={expenseType}
          onChange={setExpenseType}
        />
        <T variant="small">
          Fixed: the same every month (rent, loans, insurance). Variable: changes month to month.
        </T>
      </Card>

      <Card>
        <T variant="small">How often</T>
        <Segmented options={FREQUENCIES} value={frequency} onChange={setFrequency} />
        {frequency !== 'monthly' && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
            {MONTHS.map((m, i) => (
              <Chip key={m} label={m} selected={dueMonth === i + 1} onPress={() => setDueMonth(i + 1)} />
            ))}
          </View>
        )}
        <T variant="small">Due day of the month</T>
        <Input value={dueDay} onChangeText={setDueDay} placeholder="1–31" keyboardType="number-pad" />
        {Number.isInteger(day) && day >= 1 && day <= 31 && (
          <T variant="small">Due on the {ordinal(day)}{day > 28 ? ' (or the last day in shorter months)' : ''}.</T>
        )}
      </Card>

      {isDebt && (
        <Card>
          <T variant="small">What kind of debt?</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
            {DEBT_KINDS.map((k) => (
              <Chip key={k.value} label={k.label} selected={debtKind === k.value} onPress={() => setDebtKind(k.value)} />
            ))}
          </View>

          {accounts.length > 0 && (
            <>
              <T variant="small">Connected account (keeps the balance exact)</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
                <Chip label="Not connected" selected={!linked} onPress={() => setLinked(null)} />
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
              Balance {money(Math.abs(linkedAccount.balance_ledger ?? 0))}, updated from your lender with
              every sync.
            </T>
          ) : (
            <>
              <T variant="small">Balance owed today</T>
              <Input value={balance} onChangeText={setBalance} placeholder="e.g. 14625" keyboardType="decimal-pad" />
            </>
          )}
          <T variant="small">Interest rate (APR %){manualDebt ? ' — required' : ''}</T>
          <Input
            value={apr}
            onChangeText={setApr}
            keyboardType="decimal-pad"
            placeholder={liability?.apr != null ? `${liability.apr} (from your lender)` : 'e.g. 6.9'}
          />

          {preview && (
            <View style={{ backgroundColor: c.primarySoft, borderRadius: Radius.md, padding: Spacing.md, gap: 4 }}>
              {preview.months == null ? (
                <T color={c.negative} style={{ fontWeight: '600' }}>
                  The payment doesn&apos;t cover the monthly interest ({money(preview.nextInterest)}), so this
                  debt would never be paid off.
                </T>
              ) : (
                <>
                  <T style={{ fontWeight: '700' }}>
                    Paid off in {preview.months} months (
                    {new Date(preview.payoffDate + '-01T12:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      year: 'numeric',
                    })}
                    )
                  </T>
                  <T variant="small">
                    Next payment: {money(preview.nextInterest)} interest + {money(preview.nextPrincipal)} toward the
                    balance. About {money(preview.interest)} in interest left in total.
                  </T>
                  <T variant="small">The balance goes down automatically each month, and so does your net worth debt.</T>
                </>
              )}
            </View>
          )}
        </Card>
      )}

      {!valid && problems.length > 0 && (name || amount || dueDay) && (
        <T variant="small" color={c.warning}>
          Still needed: {problems.join(', ')}.
        </T>
      )}
      <ErrorText message={error} />
      <Button title="Save" onPress={save} loading={saving} disabled={!valid} />
      {!isNew && <Button title="Delete" kind="danger" onPress={remove} />}
      <View style={{ height: Spacing.xl }} />
    </Screen>
  );
}
