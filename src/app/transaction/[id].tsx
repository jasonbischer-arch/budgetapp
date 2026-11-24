import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { Button, Card, ErrorText, Input, Row, Screen, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Category, fetchCategories, Transaction, updateTransaction } from '@/lib/data';
import { money, shortDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { categoryEmoji } from '@/lib/visuals';

// Spending first, then income, then savings/transfers.
const KIND_ORDER = { expense: 0, income: 1, savings: 2, transfer: 3 } as const;

export default function TransactionDetail() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [excluded, setExcluded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data, error }, cats] = await Promise.all([
        supabase.from('transactions').select('*').eq('id', id).single(),
        fetchCategories(),
      ]);
      if (error) return setError(error.message);
      const t = data as Transaction;
      setTxn(t);
      setCategories(cats);
      setCategoryId(t.category_id);
      setNotes(t.notes ?? '');
      setExcluded(t.excluded);
    })().catch((e) => setError(String(e)));
  }, [id]);

  // Back from creating a category: show it, and the transaction's new category.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      (async () => {
        const [cats, { data }] = await Promise.all([
          fetchCategories(),
          supabase.from('transactions').select('category_id').eq('id', id).single(),
        ]);
        setCategories(cats);
        if (data) setCategoryId((data as { category_id: string | null }).category_id);
      })().catch(() => {});
    }, [id]),
  );

  const sorted = [...categories].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name),
  );

  async function save() {
    setSaving(true);
    try {
      await updateTransaction(id, { category_id: categoryId, notes: notes || null, excluded });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (!txn) {
    return (
      <Screen>
        <ErrorText message={error} />
        {!error && <T variant="muted">Loading…</T>}
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <T variant="title" color={txn.amount > 0 ? c.positive : undefined}>
          {money(txn.amount)}
        </T>
        <T variant="heading">{txn.merchant || txn.description}</T>
        <T variant="muted">
          {txn.description} · {shortDate(txn.date)}
          {txn.status === 'pending' ? ' · Pending' : ''}
        </T>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="heading">Category</T>
          <Pressable accessibilityRole="button" onPress={() => router.push('/categories')}>
            <T variant="small" color={c.primary}>
              Manage
            </T>
          </Pressable>
        </Row>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
          {sorted.map((cat) => {
            const selected = cat.id === categoryId;
            return (
              <Pressable
                key={cat.id}
                onPress={() => setCategoryId(selected ? null : cat.id)}
                accessibilityState={{ selected }}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: Radius.lg,
                  borderWidth: 1,
                  borderColor: selected ? cat.color : c.border,
                  backgroundColor: selected ? cat.color : 'transparent',
                }}>
                <T variant="small" color={selected ? '#fff' : c.text}>
                  {categoryEmoji(cat)} {cat.name}
                </T>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/categories/[id]', params: { id: 'new', assignTo: id } })}
            style={{
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: Radius.lg,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: c.primary,
            }}>
            <T variant="small" color={c.primary}>
              ＋ New category
            </T>
          </Pressable>
        </View>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T>Exclude from budget</T>
            <T variant="small">For transfers between your accounts and credit card payments.</T>
          </View>
          <Switch value={excluded} onValueChange={setExcluded} />
        </Row>
        <Input placeholder="Notes" value={notes} onChangeText={setNotes} multiline />
      </Card>

      <ErrorText message={error} />
      <Button title="Save" onPress={save} loading={saving} />
    </Screen>
  );
}
