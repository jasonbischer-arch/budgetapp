// Monthly cash flow (money in − spending) for past months, as bars above or
// below zero, with a dashed line at what your current plan leaves each month.
// Tap a bar to see that month's numbers.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Row, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { money, moneyWhole, monthShort } from '@/lib/format';

export interface CashFlowMonth {
  month: string; // YYYY-MM-01
  income: number;
  spent: number;
  net: number;
}

const HEIGHT = 140;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${moneyWhole(Math.abs(n))}`;
const monthName = (m: string) =>
  new Date(m + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

export function CashFlowChart({ months, planNet }: { months: CashFlowMonth[]; planNet: number }) {
  const c = useTheme();
  const [selected, setSelected] = useState(months.length - 1);
  if (!months.length) return null;

  // One scale for bars and the plan line; zero sits where the two halves meet.
  const top = Math.max(0, planNet, ...months.map((m) => m.net));
  const bottom = Math.max(0, -planNet, ...months.map((m) => -m.net));
  // A little headroom so the tallest bar or the plan line doesn't touch the edge.
  const range = (top + bottom || 1) * 1.08;
  const zeroY = (top / range) * HEIGHT;
  const y = (v: number) => zeroY - (v / range) * HEIGHT;
  const sel = months[Math.min(selected, months.length - 1)];
  const avg = months.reduce((s, m) => s + m.net, 0) / months.length;

  return (
    <View style={{ gap: Spacing.sm }}>
      {/* Readout for the tapped month */}
      <View accessibilityLiveRegion="polite">
        <T variant="small">{monthName(sel.month)}</T>
        <T style={{ fontWeight: '700' }}>
          {signed(sel.net)}{' '}
          <T variant="small">
            ({money(sel.income)} in − {money(sel.spent)} spent)
          </T>
        </T>
      </View>

      <View style={{ height: HEIGHT }}>
        {/* zero line */}
        <View style={[styles.line, { top: zeroY, backgroundColor: c.border }]} />
        <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', gap: 2 }]}>
          {months.map((m, i) => {
            const h = Math.max(2, (Math.abs(m.net) / range) * HEIGHT);
            const up = m.net >= 0;
            const isSel = i === selected;
            return (
              <Pressable
                key={m.month}
                onPress={() => setSelected(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel }}
                accessibilityLabel={`${monthName(m.month)}: ${signed(m.net)}, ${money(m.income)} in, ${money(m.spent)} spent`}
                style={{ flex: 1 }}>
                <View
                  style={{
                    position: 'absolute',
                    left: '15%',
                    right: '15%',
                    ...(up ? { top: zeroY - h } : { top: zeroY }),
                    height: h,
                    backgroundColor: up ? c.positive : c.negative,
                    opacity: isSel ? 1 : 0.55,
                    borderTopLeftRadius: up ? 4 : 0,
                    borderTopRightRadius: up ? 4 : 0,
                    borderBottomLeftRadius: up ? 0 : 4,
                    borderBottomRightRadius: up ? 0 : 4,
                  }}
                />
              </Pressable>
            );
          })}
        </View>
        {/* your current plan, per month */}
        <View pointerEvents="none" style={[styles.dashes, { top: y(planNet) - 1 }]}>
          {Array.from({ length: 40 }, (_, i) => (
            <View key={i} style={{ flex: 1, height: 2, marginRight: 3, backgroundColor: c.text }} />
          ))}
        </View>
      </View>

      {/* month labels */}
      <Row style={{ gap: 2 }}>
        {months.map((m, i) => (
          <T
            key={m.month}
            variant="small"
            style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: i === selected ? '700' : '400' }}>
            {monthShort(Number(m.month.slice(5, 7))).slice(0, months.length > 8 ? 1 : 3)}
          </T>
        ))}
      </Row>

      {/* legend */}
      <Row style={{ gap: Spacing.md, flexWrap: 'wrap' }}>
        <Row style={{ gap: 6 }}>
          <View style={[styles.swatch, { backgroundColor: c.positive }]} />
          <T variant="small">Money left</T>
        </Row>
        <Row style={{ gap: 6 }}>
          <View style={[styles.swatch, { backgroundColor: c.negative }]} />
          <T variant="small">Overspent</T>
        </Row>
        <Row style={{ gap: 6 }}>
          <View style={{ width: 16, height: 2, backgroundColor: c.text }} />
          <T variant="small">Your plan now ({signed(planNet)}/mo)</T>
        </Row>
      </Row>
      <T variant="small">
        Before this budget you averaged {signed(avg)} a month over {months.length} month{months.length === 1 ? '' : 's'}
        {planNet > avg ? `; your plan leaves ${moneyWhole(planNet - avg)} more each month.` : '.'}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', left: 0, right: 0, height: 1 },
  dashes: { position: 'absolute', left: 0, right: 0, flexDirection: 'row' },
  swatch: { width: 10, height: 10, borderRadius: 2 },
});
