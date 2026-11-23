import { useState } from 'react';
import { View } from 'react-native';

import { Card, Divider, ErrorText, Input, ProgressBar, Row, Screen, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import {
  Category,
  fetchCategories,
  fetchTransactions,
  monthRange,
  summarize,
  updateCategoryBudget,
  useQuery,
} from '@/lib/data';
import { money, moneyWhole } from '@/lib/format';

export default function Budgets() {
  const c = useTheme();
  const now = new Date();
  const range = monthRange(now.getFullYear(), now.getMonth());
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, loading, error, reload } = useQuery(
    async () => {
      const [categories, txns] = await Promise.all([fetchCategories(), fetchTransactions(range)]);
      return { categories, txns };
    },
    { categories: [], txns: [] },
  );

  const { spentByCategory } = summarize(data.txns, data.categories);
  const expenseCats = data.categories.filter((x) => !x.is_income);
  const totalBudget = expenseCats.reduce((s, x) => s + (x.monthly_budget ?? 0), 0);
  const totalSpent = expenseCats
    .filter((x) => x.monthly_budget)
    .reduce((s, x) => s + (spentByCategory.get(x.id) ?? 0), 0);

  async function save(cat: Category, value: number | null) {
    try {
      await updateCategoryBudget(cat.id, value);
      setSaveError(null);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <T variant="title">Budgets</T>
      <T variant="muted">Monthly limits per category. Leave blank for no budget.</T>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="heading">This month</T>
          <T variant="money">
            {moneyWhole(totalSpent)} <T variant="small">of {moneyWhole(totalBudget)}</T>
          </T>
        </Row>
        {totalBudget > 0 && (
          <ProgressBar
            value={totalSpent / totalBudget}
            color={totalSpent > totalBudget ? c.negative : c.primary}
          />
        )}
      </Card>

      <ErrorText message={error ?? saveError} />

      <Card>
        {expenseCats.map((cat, i) => {
          const spent = spentByCategory.get(cat.id) ?? 0;
          const budget = cat.monthly_budget ?? 0;
          return (
            <View key={cat.id} style={{ gap: 8 }}>
              {i > 0 && <Divider />}
              <Row style={{ justifyContent: 'space-between', marginTop: i > 0 ? 8 : 0 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Row style={{ gap: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cat.color }} />
                    <T>{cat.name}</T>
                  </Row>
                  <T variant="small">{money(spent)} spent</T>
                </View>
                <BudgetInput cat={cat} onSave={save} />
              </Row>
              {budget > 0 && (
                <ProgressBar value={spent / budget} color={spent > budget ? c.negative : cat.color} />
              )}
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

function BudgetInput({
  cat,
  onSave,
}: {
  cat: Category;
  onSave: (cat: Category, value: number | null) => void;
}) {
  const initial = cat.monthly_budget != null ? String(cat.monthly_budget) : '';
  const [text, setText] = useState(initial);
  const commit = () => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    const value = cleaned === '' ? null : Number(cleaned);
    if (value != null && Number.isNaN(value)) return setText(initial);
    if (value !== cat.monthly_budget) onSave(cat, value);
  };
  return (
    <Input
      value={text}
      onChangeText={setText}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder="$0"
      keyboardType="decimal-pad"
      returnKeyType="done"
      accessibilityLabel={`${cat.name} monthly budget`}
      style={{ width: 110, textAlign: 'right' }}
    />
  );
}
