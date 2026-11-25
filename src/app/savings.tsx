// Ways to cut: ideas that raise how much is left each month, from your own
// spending, bills and debts. Check the ones you'll do to see your new cash flow.
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Card, ErrorText, GradientCard, Row, Screen, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { updateCategoryBudget } from '@/lib/data';
import { moneyWhole } from '@/lib/format';
import { debtDetails, expenseBills, monthlyCashFlow, useHouseholdData } from '@/lib/household-data';
import {
  categoryAverages,
  cutSuggestions,
  SavingsIdea,
  savingsIdeas,
  trailingMonths,
  withoutBills,
} from '@/lib/insights';

const KIND_ICON: Record<SavingsIdea['kind'], string> = {
  budget: '✂️',
  subscription: '📺',
  insurance: '🛡️',
  debt: '🏦',
  fees: '💸',
};

export default function Savings() {
  const c = useTheme();
  const { household } = useAuth();
  const { data, loading, error, reload } = useHouseholdData();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const cf = monthlyCashFlow(data, household);
  const ideas = useMemo(() => {
    const now = new Date();
    const months = trailingMonths(now, data.firstDate);
    return savingsIdeas({
      cuts: cutSuggestions(data.flows, data.categories, now, data.firstDate),
      bills: expenseBills(data.bills, data.accounts, data.liabilities),
      categories: data.categories,
      debts: data.bills
        .filter((b) => b.is_debt)
        .map((b) => {
          const d = debtDetails(b, data.accounts, data.liabilities);
          return { billId: b.id, name: b.name, balance: d.balance, apr: d.apr };
        }),
      categoryAverages: categoryAverages(withoutBills(data.flows), months),
    });
  }, [data]);

  const budgetOf = (id?: string) => data.categories.find((k) => k.id === id)?.monthly_budget;
  const pickedTotal = ideas.filter((i) => picked.has(i.id)).reduce((s, i) => s + i.monthly, 0);
  const allTotal = ideas.reduce((s, i) => s + i.monthly, 0);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setBudget(idea: SavingsIdea) {
    if (!idea.categoryId || idea.target == null) return;
    setBusy(idea.id);
    setErr(null);
    try {
      await updateCategoryBudget(idea.categoryId, idea.target);
      setPicked((prev) => new Set(prev).add(idea.id));
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const after = cf.net + pickedTotal;

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Ways to cut' }} />

      <GradientCard colors={c.gradPlan}>
        <T color={c.heroMuted} style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.8 }}>
          LEFT EACH MONTH
        </T>
        <T color={c.heroText} style={{ fontSize: 34, fontWeight: '800' }}>
          {moneyWhole(after)}
        </T>
        <T color={c.heroMuted}>
          {pickedTotal > 0
            ? `${moneyWhole(cf.net)} now + ${moneyWhole(pickedTotal)} from what you picked = ${moneyWhole(pickedTotal * 12)} more a year`
            : `Now: ${moneyWhole(cf.income)} expected income − ${moneyWhole(cf.expenses)} expenses. Check the ideas below to see what they add.`}
        </T>
      </GradientCard>

      {ideas.length > 0 && (
        <T variant="small">
          {ideas.length} ideas worth up to {moneyWhole(allTotal)} a month. Amounts marked ≈ are estimates.
        </T>
      )}
      <ErrorText message={error ?? err} />

      {!loading && ideas.length === 0 && (
        <Card>
          <T variant="muted">
            No ideas yet. They appear once there are about 3 months of bank history and some bills.
          </T>
        </Card>
      )}

      {ideas.map((idea) => {
        const on = picked.has(idea.id);
        const budgetSet = idea.kind === 'budget' && budgetOf(idea.categoryId) === idea.target;
        return (
          <Card key={idea.id} style={on ? { borderColor: c.primary } : undefined}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${idea.title}, saves about ${moneyWhole(idea.monthly)} a month`}
              onPress={() => toggle(idea.id)}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <Row style={{ justifyContent: 'space-between', gap: Spacing.sm, alignItems: 'flex-start' }}>
                <Row style={{ gap: Spacing.sm, flexShrink: 1, alignItems: 'flex-start' }}>
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      marginTop: 2,
                      borderRadius: Radius.sm,
                      borderWidth: 2,
                      borderColor: on ? c.primary : c.border,
                      backgroundColor: on ? c.primary : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    {on && (
                      <T color={c.primaryText} style={{ fontSize: 13, fontWeight: '800' }}>
                        ✓
                      </T>
                    )}
                  </View>
                  <View style={{ flexShrink: 1, gap: 2 }}>
                    <T style={{ fontWeight: '700' }}>
                      {KIND_ICON[idea.kind]} {idea.title}
                    </T>
                    <T variant="small">{idea.detail}</T>
                  </View>
                </Row>
                <T variant="money" color={c.positive} style={{ fontWeight: '700' }}>
                  {idea.estimate ? '≈' : ''}+{moneyWhole(idea.monthly)}
                  <T variant="small">/mo</T>
                </T>
              </Row>
            </Pressable>
            <Row style={{ gap: Spacing.xs, flexWrap: 'wrap' }}>
              {idea.kind === 'budget' && (
                <Button
                  title={budgetSet ? 'Budget set ✓' : `Set budget to ${moneyWhole(idea.target ?? 0)}`}
                  kind="secondary"
                  disabled={budgetSet}
                  loading={busy === idea.id}
                  onPress={() => setBudget(idea)}
                />
              )}
              {idea.billId && (
                <Button
                  title="Open bill"
                  kind="secondary"
                  onPress={() => router.push({ pathname: '/bill/[id]', params: { id: idea.billId! } })}
                />
              )}
              {idea.kind === 'fees' && idea.categoryId && (
                <Button
                  title="See the fees"
                  kind="secondary"
                  onPress={() =>
                    router.push({ pathname: '/category/[id]', params: { id: idea.categoryId!, months: '12' } })
                  }
                />
              )}
            </Row>
          </Card>
        );
      })}
    </Screen>
  );
}
