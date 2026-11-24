// Create or edit a category: name, emoji, color, and how it counts.
//   /categories/new                    new category
//   /categories/new?assignTo=<txn id>  new category, and file that transaction under it
//   /categories/<id>                   edit
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Card, ErrorText, IconBubble, Input, Row, Screen, Segmented, T } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { confirmAction } from '@/lib/confirm';
import {
  Category,
  countCategoryTransactions,
  createCategory,
  deleteCategory,
  fetchCategories,
  isCustomCategory,
  updateCategory,
  updateTransaction,
} from '@/lib/data';
import { categoryEmoji, nameEmoji } from '@/lib/visuals';

const EMOJIS = [
  '🧸', '👶', '🎒', '🍼', '🐾', '🏋️', '⛽', '🚗', '🏠', '💡', '📱', '🌐',
  '🛒', '🍔', '☕', '🍷', '🛍️', '👕', '💇', '🩺', '💊', '🦷', '🎓', '📚',
  '🎬', '🎮', '🎵', '⚽', '⛳', '✈️', '🏖️', '🎁', '⛪', '💼', '🧾', '🏦',
  '💳', '💰', '📈', '🔧', '🌱', '🧹', '🐶', '🎂', '❤️', '📦',
];

// Distinct, readable on light and dark backgrounds.
const COLORS = [
  '#F59E0B', '#EF4444', '#EC4899', '#A855F7', '#6366F1', '#0EA5E9',
  '#06B6D4', '#14B8A6', '#22C55E', '#84CC16', '#F97316', '#64748B',
];

type Kind = 'expense' | 'income';
type ExpenseType = 'fixed' | 'variable';

export default function CategoryEditor() {
  const c = useTheme();
  const { id, assignTo } = useLocalSearchParams<{ id: string; assignTo?: string }>();
  const isNew = id === 'new';
  const { household } = useAuth();
  const [existing, setExisting] = useState<Category | null>(null);
  const [all, setAll] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [kind, setKind] = useState<Kind>('expense');
  const [expenseType, setExpenseType] = useState<ExpenseType>('variable');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories()
      .then((cats) => {
        setAll(cats);
        if (isNew) return;
        const cat = cats.find((x) => x.id === id);
        if (!cat) return setError('Category not found');
        setExisting(cat);
        setName(cat.name);
        setIcon(cat.icon);
        setColor(cat.color);
        setKind(cat.kind === 'income' ? 'income' : 'expense');
        setExpenseType(cat.expense_type);
      })
      .catch((e) => setError(String(e)));
  }, [id, isNew]);

  // Savings and transfer categories keep their kind (they aren't spending).
  const fixedKind = existing && (existing.kind === 'savings' || existing.kind === 'transfer');
  const trimmed = name.trim();
  const duplicate = all.some((x) => x.id !== existing?.id && x.name.toLowerCase() === trimmed.toLowerCase());
  const valid = trimmed.length >= 1 && trimmed.length <= 40 && !duplicate;
  const shownIcon = icon ?? (existing ? categoryEmoji(existing) : (nameEmoji(trimmed) ?? '📦'));

  async function save() {
    if (!household || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const input = {
        name: trimmed,
        color,
        icon: icon ?? (isNew ? (nameEmoji(trimmed) ?? '📦') : existing?.icon ?? null),
        kind: fixedKind ? (existing!.kind as Kind) : kind,
        expense_type: expenseType,
      };
      if (isNew) {
        const newId = await createCategory(household.id, input);
        if (assignTo) await updateTransaction(assignTo, { category_id: newId });
      } else {
        await updateCategory(id, input);
      }
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/duplicate|unique/i.test(msg) ? 'You already have a category with that name.' : msg);
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing) return;
    const n = await countCategoryTransactions(existing.id).catch(() => 0);
    confirmAction(
      `Delete ${existing.name}?`,
      n
        ? `Its ${n} transaction${n === 1 ? '' : 's'} will become uncategorized. You can file them under another category.`
        : 'No transactions use it.',
      'Delete',
      async () => {
        try {
          await deleteCategory(existing.id);
          router.back();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New category' : 'Edit category' }} />
      <Card>
        <Row style={{ gap: Spacing.md }}>
          <IconBubble emoji={shownIcon} color={color} size={52} />
          <View style={{ flex: 1 }}>
            <T variant="small">Name</T>
            <Input value={name} onChangeText={setName} placeholder="e.g. Child Care, Pets, Gym" maxLength={40} autoFocus={isNew} />
          </View>
        </Row>
        {duplicate && <T variant="small" color={c.negative}>You already have a category with that name.</T>}
      </Card>

      {!fixedKind && (
        <Card>
          <T variant="small">Type</T>
          <Segmented
            options={[
              { value: 'expense', label: '💸 Spending' },
              { value: 'income', label: '💰 Income' },
            ]}
            value={kind}
            onChange={setKind}
          />
          {kind === 'expense' && (
            <>
              <Segmented
                options={[
                  { value: 'fixed', label: '📌 Fixed' },
                  { value: 'variable', label: '🛒 Variable' },
                ]}
                value={expenseType}
                onChange={setExpenseType}
              />
              <T variant="small">
                Fixed: about the same every month (daycare, rent). Variable: changes month to month (groceries).
              </T>
            </>
          )}
        </Card>
      )}

      <Card>
        <T variant="small">Emoji</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
          {EMOJIS.map((e) => {
            const selected = shownIcon === e;
            return (
              <Pressable
                key={e}
                onPress={() => setIcon(e)}
                accessibilityRole="button"
                accessibilityLabel={`Emoji ${e}`}
                accessibilityState={{ selected }}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: Radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? color : c.border,
                }}>
                <T style={{ fontSize: 20 }}>{e}</T>
              </Pressable>
            );
          })}
        </View>
        <T variant="small">Color</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
          {COLORS.map((col) => (
            <Pressable
              key={col}
              onPress={() => setColor(col)}
              accessibilityRole="button"
              accessibilityLabel={`Color ${col}`}
              accessibilityState={{ selected: color === col }}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: col,
                borderWidth: color === col ? 3 : 0,
                borderColor: c.text,
              }}
            />
          ))}
        </View>
      </Card>

      <ErrorText message={error} />
      <Button title={isNew ? (assignTo ? 'Create & use for this transaction' : 'Create category') : 'Save'} onPress={save} loading={saving} disabled={!valid} />
      {existing && isCustomCategory(existing) && <Button title="Delete category" kind="danger" onPress={remove} />}
      {existing && !isCustomCategory(existing) && (
        <T variant="small">
          This is a built-in category: your bank&apos;s transactions are filed here automatically, so it can be renamed
          but not deleted.
        </T>
      )}
    </Screen>
  );
}
