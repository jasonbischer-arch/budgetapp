import { useState } from 'react';
import { Pressable } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { monthLabel } from '@/lib/format';

import { Row, T } from './ui';

export function useMonth() {
  const now = new Date();
  const [month, setMonth] = useState({ year: now.getFullYear(), index: now.getMonth() });
  const shift = (delta: number) =>
    setMonth(({ year, index }) => {
      const d = new Date(year, index + delta, 1);
      return { year: d.getFullYear(), index: d.getMonth() };
    });
  const isCurrent = month.year === now.getFullYear() && month.index === now.getMonth();
  return { ...month, shift, isCurrent };
}

export function MonthPicker({ month }: { month: ReturnType<typeof useMonth> }) {
  const c = useTheme();
  const arrow = (label: string, delta: number, disabled = false) => (
    <Pressable
      accessibilityLabel={delta < 0 ? 'Previous month' : 'Next month'}
      disabled={disabled}
      onPress={() => month.shift(delta)}
      hitSlop={12}
      style={{ opacity: disabled ? 0.3 : 1, paddingHorizontal: 8 }}>
      <T variant="heading" color={c.primary}>{label}</T>
    </Pressable>
  );
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      {arrow('‹', -1)}
      <T variant="heading">{monthLabel(month.year, month.index)}</T>
      {arrow('›', 1, month.isCurrent)}
    </Row>
  );
}
