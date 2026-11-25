// Your own plan for one bill: pay it from a paycheck you choose, or split it
// across paychecks. Anything you don't assign is planned automatically.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Card, Divider, ErrorText, Input, Row, Screen, Segmented, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  Bill,
  fetchBills,
  fetchIncomeSources,
  fetchPlanRules,
  IncomeSource,
  savePlanRulesForBill,
  setPlanMode,
} from '@/lib/data';
import { money, ordinal } from '@/lib/format';

type How = 'auto' | 'mine';

const parseNum = (s: string) => {
  const cleaned = s.replace(/[^0-9.]/g, '');
  return cleaned === '' ? null : Number(cleaned);
};

const FREQ: Record<string, string> = {
  weekly: 'every week',
  biweekly: 'every 2 weeks',
  semimonthly: 'twice a month',
  monthly: 'monthly',
};

export default function PlanBillEditor() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { household, refreshHousehold } = useAuth();
  const [bill, setBill] = useState<Bill | null>(null);
  const [incomes, setIncomes] = useState<IncomeSource[]>([]);
  const [how, setHow] = useState<How>('mine');
  // Per paycheck: chosen, and the amount ('' = the rest of the bill).
  const [picked, setPicked] = useState<Record<string, { on: boolean; amount: string }>>({});
  // Which check of the month each paycheck pays from (kept when you save).
  const [slots, setSlots] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [bills, srcs, rules] = await Promise.all([fetchBills(), fetchIncomeSources(), fetchPlanRules()]);
      const b = bills.find((x) => x.id === id);
      if (!b) return setError('Bill not found');
      setBill(b);
      setIncomes(srcs);
      const mine = rules.filter((r) => r.bill_id === id);
      setHow(mine.length ? 'mine' : 'auto');
      setSlots(Object.fromEntries(mine.map((r) => [r.income_source_id, r.check_slot])));
      const state: Record<string, { on: boolean; amount: string }> = {};
      for (const s of srcs) {
        const r = mine.find((x) => x.income_source_id === s.id);
        state[s.id] = { on: !!r, amount: r?.amount != null ? String(r.amount) : '' };
      }
      setPicked(state);
    })().catch((e) => setError(String(e)));
  }, [id]);

  const total = bill?.amount ?? 0;
  const chosen = incomes.filter((s) => picked[s.id]?.on);
  const fixedAmounts = chosen.map((s) => parseNum(picked[s.id].amount));
  const rest = chosen.filter((_, i) => fixedAmounts[i] == null);
  const assigned = fixedAmounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);

  const problems: string[] = [];
  if (how === 'mine') {
    if (!chosen.length) problems.push('Choose at least one paycheck.');
    if (rest.length > 1) problems.push('Leave the amount blank on only one paycheck (it pays the rest).');
    if (assigned > total + 0.005) problems.push(`That's ${money(assigned)}, more than the ${money(total)} bill.`);
  }
  const unassigned = how === 'mine' && !rest.length ? Math.max(0, total - assigned) : 0;

  function toggle(sourceId: string) {
    setPicked((p) => ({ ...p, [sourceId]: { ...p[sourceId], on: !p[sourceId]?.on } }));
  }

  async function save() {
    if (!household || !bill || problems.length) return;
    setSaving(true);
    setError(null);
    try {
      const rules =
        how === 'auto'
          ? []
          : chosen.map((s, i) => ({ income_source_id: s.id, amount: fixedAmounts[i], check_slot: slots[s.id] ?? null }));
      await savePlanRulesForBill(household.id, bill.id, rules);
      if (rules.length && household.plan_mode !== 'mine') {
        await setPlanMode(household.id, 'mine');
        await refreshHousehold();
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (!bill) {
    return (
      <Screen>
        <ErrorText message={error} />
        {!error && <T variant="muted">Loading…</T>}
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Pay this bill from…' }} />
      <Card>
        <T variant="heading">{bill.name}</T>
        <T variant="muted">
          {money(total)} · due the {ordinal(bill.due_day)}
        </T>
      </Card>

      <Segmented
        options={[
          { value: 'auto', label: '⚖️ Automatic' },
          { value: 'mine', label: '✋ I choose' },
        ]}
        value={how}
        onChange={setHow}
      />

      {how === 'auto' ? (
        <Card>
          <T variant="muted">
            The plan picks the check(s) for this bill, keeping every paycheck as even as possible. In My
            plan, a bill left automatic waits in “Not on a check yet” until you add it to a check.
          </T>
        </Card>
      ) : (
        <Card>
          <T variant="small">
            Pick the paycheck(s). It&apos;s paid from the last check from that paycheck before the bill is due.
            To split it, enter an amount for each and leave one blank to pay the rest.
          </T>
          {incomes.map((s, i) => {
            const state = picked[s.id] ?? { on: false, amount: '' };
            return (
              <View key={s.id} style={{ gap: Spacing.xs }}>
                {i > 0 && <Divider />}
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: state.on }}
                  onPress={() => toggle(s.id)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                  <Row style={{ justifyContent: 'space-between', gap: Spacing.sm }}>
                    <Row style={{ gap: Spacing.sm, flexShrink: 1 }}>
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: Radius.sm,
                          borderWidth: 2,
                          borderColor: state.on ? c.primary : c.border,
                          backgroundColor: state.on ? c.primary : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                        {state.on && <T color={c.primaryText} style={{ fontSize: 13, fontWeight: '800' }}>✓</T>}
                      </View>
                      <View style={{ flexShrink: 1 }}>
                        <T numberOfLines={1}>{s.name}</T>
                        <T variant="small">
                          {money(s.amount)} {FREQ[s.frequency] ?? ''}
                        </T>
                      </View>
                    </Row>
                  </Row>
                </Pressable>
                {state.on && (
                  <Input
                    value={state.amount}
                    onChangeText={(v) => setPicked((p) => ({ ...p, [s.id]: { ...state, amount: v } }))}
                    keyboardType="decimal-pad"
                    placeholder={chosen.length > 1 ? 'Amount (blank = the rest)' : `All of it (${money(total)})`}
                    accessibilityLabel={`Amount from ${s.name}`}
                  />
                )}
              </View>
            );
          })}
          {unassigned > 0.004 && !problems.length && (
            <T variant="small">The other {money(unassigned)} is planned automatically.</T>
          )}
        </Card>
      )}

      {problems.map((p) => (
        <T key={p} variant="small" color={c.negative}>
          {p}
        </T>
      ))}
      <ErrorText message={error} />
      <Button title="Save" onPress={save} loading={saving} disabled={problems.length > 0} />
    </Screen>
  );
}
