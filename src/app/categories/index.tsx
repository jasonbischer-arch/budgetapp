// All categories: tap one to edit it, or create your own.
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Badge, Button, Card, Divider, ErrorText, IconBubble, Row, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { Category, fetchCategories, isCustomCategory, useQuery } from '@/lib/data';
import { categoryEmoji } from '@/lib/visuals';

const GROUPS: { title: string; match: (c: Category) => boolean }[] = [
  { title: 'Fixed spending', match: (c) => c.kind === 'expense' && c.expense_type === 'fixed' },
  { title: 'Variable spending', match: (c) => c.kind === 'expense' && c.expense_type === 'variable' },
  { title: 'Income', match: (c) => c.kind === 'income' },
  { title: 'Savings & transfers (not spending)', match: (c) => c.kind === 'savings' || c.kind === 'transfer' },
];

export default function Categories() {
  const { data, loading, error, reload } = useQuery(fetchCategories, [] as Category[]);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Button title="＋ New category" onPress={() => router.push({ pathname: '/categories/[id]', params: { id: 'new' } })} />
      <ErrorText message={error} />
      {GROUPS.map((g) => {
        const cats = data.filter(g.match);
        if (!cats.length) return null;
        return (
          <Card key={g.title}>
            <T variant="heading">{g.title}</T>
            {cats.map((cat, i) => (
              <View key={cat.id}>
                {i > 0 && <Divider />}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${cat.name}`}
                  onPress={() => router.push({ pathname: '/categories/[id]', params: { id: cat.id } })}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: Spacing.xs })}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row style={{ gap: Spacing.sm, flexShrink: 1 }}>
                      <IconBubble emoji={categoryEmoji(cat)} color={cat.color} size={32} />
                      <T numberOfLines={1} style={{ flexShrink: 1 }}>
                        {cat.name}
                      </T>
                      {isCustomCategory(cat) && <Badge text="yours" tone="primary" />}
                    </Row>
                    <T variant="small">›</T>
                  </Row>
                </Pressable>
              </View>
            ))}
          </Card>
        );
      })}
      <T variant="small">
        Built-in categories fill in automatically from your bank. Transactions go into categories you create when
        you pick them on a transaction.
      </T>
    </Screen>
  );
}
