import { router } from 'expo-router';
import { StyleSheet, View, Pressable } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorText,
  GradientCard,
  IconBubble,
  MeterRow,
  Row,
  Screen,
  SectionHeader,
  Stat,
  T,
} from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  Account,
  Bill,
  fetchAccounts,
  fetchBills,
  fetchLiabilities,
  Liability,
  fetchManualAssets,
  fetchNetWorthHistory,
  fetchNetWorthItems,
  ManualAsset,
  NetWorthItem,
  NetWorthPoint,
  updateAccountNetWorth,
  useQuery,
} from '@/lib/data';
import { duration, money, moneyWhole, monthYear } from '@/lib/format';
import { debtDetails } from '@/lib/household-data';
import { GROUP_STYLE } from '@/lib/visuals';

const ASSET_GROUPS: { kind: string; label: string }[] = [
  { kind: 'cash', label: 'Cash & savings' },
  { kind: 'investment', label: 'Investments & retirement' },
  { kind: 'home', label: 'Real estate' },
  { kind: 'vehicle', label: 'Vehicles' },
  { kind: 'other', label: 'Other assets' },
];

const DEBT_GROUPS: { kind: string; label: string }[] = [
  { kind: 'mortgage', label: 'Mortgages' },
  { kind: 'auto_loan', label: 'Auto loans' },
  { kind: 'student_loan', label: 'Student loans' },
  { kind: 'credit_card', label: 'Credit cards' },
  { kind: 'loan', label: 'Other loans' },
  { kind: 'debt', label: 'Other debts' },
];

interface Data {
  items: NetWorthItem[];
  history: NetWorthPoint[];
  assets: ManualAsset[];
  accounts: Account[];
  bills: Bill[];
  liabilities: Liability[];
}

export default function NetWorth() {
  const c = useTheme();
  const { data, loading, error, reload } = useQuery<Data>(
    async () => {
      const [items, history, assets, accounts, bills, liabilities] = await Promise.all([
        fetchNetWorthItems(),
        fetchNetWorthHistory(),
        fetchManualAssets(),
        fetchAccounts(),
        fetchBills(),
        fetchLiabilities(),
      ]);
      return { items, history, assets, accounts, bills, liabilities };
    },
    { items: [], history: [], assets: [], accounts: [], bills: [], liabilities: [] },
    '',
    'networth',
  );

  const assets = data.items.filter((i) => i.section === 'asset');
  const debts = data.items.filter((i) => i.section === 'liability');
  const totalAssets = assets.reduce((s, i) => s + i.amount, 0);
  const totalDebts = debts.reduce((s, i) => s + i.amount, 0);
  const netWorth = totalAssets - totalDebts;

  const prev = data.history.length >= 2 ? data.history[data.history.length - 2] : null;
  const change = prev ? netWorth - prev.net_worth : null;

  // Equity for homes and vehicles linked to their loan.
  const equity = assets
    .filter((a) => (a.kind === 'home' || a.kind === 'vehicle') && a.loan_ref)
    .map((a) => {
      const loan = debts.find((d) => d.ref_id === a.loan_ref);
      // The loan's bill (one you entered, or the one paying a connected loan),
      // for its payoff date.
      const bill = data.bills.find((b) => b.id === a.loan_ref || b.account_id === a.loan_ref);
      const plan = bill ? debtDetails(bill, data.accounts, data.liabilities).payoff : null;
      return { asset: a, loan, equity: a.amount - (loan?.amount ?? 0), plan };
    });

  const debtRatio = totalAssets > 0 ? totalDebts / totalAssets : null;
  const manualById = new Map(data.assets.map((a) => [a.id, a]));
  const excluded = data.accounts.filter(
    (a) => a.net_worth_excluded && !a.hidden && ['depository', 'investment', 'credit', 'loan'].includes(a.type),
  );

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <T variant="title" style={{ marginTop: Spacing.sm }}>
        Net worth
      </T>
      <ErrorText message={error} />

      <GradientCard colors={c.gradWorth}>
        <T color={c.heroMuted} style={styles.heroLabel}>
          WHAT YOU OWN − WHAT YOU OWE
        </T>
        <T
          color={c.heroText}
          style={styles.heroValue}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLabel={`Net worth ${moneyWhole(netWorth)}`}>
          {moneyWhole(netWorth)}
        </T>
        {change != null && (
          <T color={c.heroMuted}>
            {change >= 0 ? '▲' : '▼'} {moneyWhole(Math.abs(change))} since last month
          </T>
        )}
        <View style={[styles.heroDivider, { backgroundColor: c.heroMuted }]} />
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <T color={c.heroMuted}>Assets</T>
            <T color={c.heroText} style={styles.heroSub}>
              {moneyWhole(totalAssets)}
            </T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T color={c.heroMuted}>Debts</T>
            <T color={c.heroText} style={styles.heroSub}>
              {moneyWhole(totalDebts)}
            </T>
          </View>
        </Row>
      </GradientCard>

      <HistoryChart history={data.history} />

      {equity.length > 0 && (
        <>
          <SectionHeader title="Equity" />
          {equity.map(({ asset, loan, equity: eq, plan }) => (
            <Card key={asset.ref_id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <T variant="heading">{asset.name}</T>
                <T variant="money" color={eq >= 0 ? c.positive : c.negative} style={{ fontSize: 18 }}>
                  {moneyWhole(eq)}
                </T>
              </Row>
              <T variant="small">
                Worth {moneyWhole(asset.amount)} − {loan ? `${loan.name} ${moneyWhole(loan.amount)}` : 'loan'} owed
              </T>
              {plan?.months != null && plan.payoffDate && (
                <T variant="small" color={c.positive} style={{ fontWeight: '600' }}>
                  🏁 Paid off {monthYear(plan.payoffDate)} · {duration(plan.months)} to go
                </T>
              )}
              {asset.amount > 0 && (
                <MeterRow
                  label="You own"
                  value={Math.max(0, eq)}
                  max={asset.amount}
                  figure={`${Math.round((Math.max(0, eq) / asset.amount) * 100)}%`}
                />
              )}
            </Card>
          ))}
        </>
      )}

      <SectionHeader title="What you own" action="+ Add" onAction={() => router.push('/asset/new')} />
      <Card>
        <MixBar groups={ASSET_GROUPS} items={assets} />
        {assets.length === 0 && (
          <T variant="muted">Connect bank and investment accounts, and add your home and vehicles.</T>
        )}
        {ASSET_GROUPS.map((g) => (
          <Group key={g.kind} label={g.label} items={assets.filter((a) => a.kind === g.kind)} manualById={manualById} />
        ))}
        <Button
          title="Add home, vehicle or other asset"
          kind="secondary"
          onPress={() => router.push('/asset/new')}
        />
        <T variant="small">Tap any item to edit or remove it.</T>
      </Card>

      <SectionHeader title="What you owe" action="+ Add" onAction={() => router.push({ pathname: '/bill/[id]', params: { id: 'new', debt: '1' } })} />
      <Card>
        <MixBar groups={DEBT_GROUPS} items={debts} />
        {debts.length === 0 && <T variant="muted">No debts found. Nice. 🎉</T>}
        {DEBT_GROUPS.map((g) => (
          <Group key={g.kind} label={g.label} items={debts.filter((d) => d.kind === g.kind)} manualById={manualById} />
        ))}
        <Button
          title="Add a loan or debt"
          kind="secondary"
          onPress={() => router.push({ pathname: '/bill/[id]', params: { id: 'new', debt: '1' } })}
        />
        <T variant="small">
          Connected cards and loans update with each bank sync. Debts you add pay down every month
          from their payment and interest rate. Tap any item to edit or remove it.
        </T>
      </Card>

      {excluded.length > 0 && (
        <>
          <SectionHeader title="Not counted" />
          <Card>
            <T variant="small">Left out of net worth. Their transactions still count in your budgets.</T>
            {excluded.map((a) => (
              <Row key={a.id} style={{ justifyContent: 'space-between', gap: Spacing.sm }}>
                <T variant="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {a.nickname || `${a.name}${a.last_four ? ` ••${a.last_four}` : ''}`}
                </T>
                <Button
                  title="Add back"
                  kind="secondary"
                  onPress={() => updateAccountNetWorth(a.id, { net_worth_excluded: false }).then(reload)}
                />
              </Row>
            ))}
          </Card>
        </>
      )}

      {debtRatio != null && (
        <Row style={{ gap: Spacing.md, alignItems: 'stretch' }}>
          <Stat label="Debt-to-assets" value={`${Math.round(debtRatio * 100)}%`} sub="lower is better" />
          <Stat
            label="Liquid (cash + investments)"
            value={moneyWhole(
              assets.filter((a) => a.kind === 'cash' || a.kind === 'investment').reduce((s, a) => s + a.amount, 0),
            )}
          />
        </Row>
      )}

      <SectionHeader title="How it's calculated" />
      <Card>
        <T>
          <T style={{ fontWeight: '700' }}>Net worth = everything you own − everything you owe.</T>
        </T>
        <T variant="small">
          • Checking, savings, brokerage and retirement accounts use their current balance from your
          bank. Retirement accounts are shown before taxes.
        </T>
        <T variant="small">
          • Homes can update automatically: turn it on and add the address, and a market estimate
          (similar to a Zestimate, from RentCast) is fetched on the 1st of each month. Otherwise
          homes and vehicles use your estimate, adjusted each year by the rate you choose (homes
          +3%, vehicles −15% by default).
        </T>
        <T variant="small">
          • Debts come from connected cards and loans, plus debts you entered in Bills. Each is
          counted once, even when it&apos;s linked to a home or vehicle to show equity.
        </T>
        <T variant="small">
          • Hidden accounts are left out. A snapshot is saved every day, so the chart fills in month
          by month.
        </T>
      </Card>
    </Screen>
  );
}

function Group({
  label,
  items,
  manualById,
}: {
  label: string;
  items: NetWorthItem[];
  manualById: Map<string, ManualAsset>;
}) {
  if (!items.length) return null;
  const total = items.reduce((s, i) => s + i.amount, 0);
  const style = GROUP_STYLE[items[0].kind] ?? { emoji: '•', color: '#94A3B8' };
  return (
    <View style={{ gap: Spacing.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: Spacing.sm, flexShrink: 1 }}>
          <IconBubble emoji={style.emoji} color={style.color} size={30} />
          <T style={{ fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
            {label}
          </T>
        </Row>
        <T variant="money">{money(total)}</T>
      </Row>
      {items
        .sort((a, b) => b.amount - a.amount)
        .map((i) => {
          const manual = i.source === 'manual' ? manualById.get(i.ref_id) : undefined;
          // Every item opens its editor: your assets and debts open theirs (with
          // Delete); connected accounts open their net worth settings.
          const isDebtItem = i.section === 'liability' && i.source === 'manual';
          const pathname = i.source === 'bank' ? '/networth-account/[id]' : isDebtItem ? '/bill/[id]' : '/asset/[id]';
          return (
            <Pressable
              key={i.ref_id}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${i.name}, ${money(i.amount)}`}
              onPress={() => router.push({ pathname, params: { id: i.ref_id } })}
              style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Row style={{ justifyContent: 'space-between', paddingLeft: 38 }}>
                <Row style={{ gap: 6, flexShrink: 1 }}>
                  <T variant="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {i.name}
                  </T>
                  {i.source === 'manual' && (
                    <Badge
                      text={manual?.value_error ? 'CHECK' : manual?.auto_value ? 'AUTO' : manual ? 'ESTIMATE' : '↓ MONTHLY'}
                      tone={manual?.value_error ? 'warning' : manual?.auto_value ? 'primary' : 'neutral'}
                    />
                  )}
                </Row>
                <T variant="muted">
                  {money(i.amount)} <T variant="small">✎</T>
                </T>
              </Row>
            </Pressable>
          );
        })}
      <Divider />
    </View>
  );
}

/** One colored block per group, sized by amount, with a labeled legend. */
function MixBar({ groups, items }: { groups: { kind: string; label: string }[]; items: NetWorthItem[] }) {
  const parts = groups
    .map((g) => ({
      ...g,
      total: items.filter((i) => i.kind === g.kind).reduce((s, i) => s + i.amount, 0),
      ...(GROUP_STYLE[g.kind] ?? { emoji: '•', color: '#94A3B8' }),
    }))
    .filter((p) => p.total > 0);
  const total = parts.reduce((s, p) => s + p.total, 0);
  if (parts.length < 2 || total <= 0) return null;
  return (
    <View style={{ gap: Spacing.sm }}>
      <View style={styles.mix}>
        {parts.map((p) => (
          <View key={p.kind} style={{ flex: p.total, backgroundColor: p.color }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.md, rowGap: 4 }}>
        {parts.map((p) => (
          <Row key={p.kind} style={{ gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: p.color }} />
            <T variant="small">
              {p.label} {Math.round((p.total / total) * 100)}%
            </T>
          </Row>
        ))}
      </View>
    </View>
  );
}

/** Monthly net worth columns (single series: no legend, values labeled). */
function HistoryChart({ history }: { history: NetWorthPoint[] }) {
  const c = useTheme();
  const points = history.slice(-12);
  if (points.length < 2) {
    return (
      <T variant="small">
        Your net worth history starts this month. A snapshot is saved every day, and the trend chart
        appears once there are two months.
      </T>
    );
  }
  const max = Math.max(...points.map((p) => Math.abs(p.net_worth)), 1);
  const hasNegative = points.some((p) => p.net_worth < 0);
  const H = 120;
  return (
    <Card>
      <T variant="heading">Net worth by month</T>
      <View style={{ height: H, flexDirection: 'row', alignItems: hasNegative ? 'center' : 'flex-end', gap: 4 }}>
        {points.map((p) => {
          const h = (Math.abs(p.net_worth) / max) * (hasNegative ? H / 2 : H);
          const label = new Date(p.month + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
          return (
            <View
              key={p.month}
              accessible
              accessibilityLabel={`${label}: ${moneyWhole(p.net_worth)}`}
              style={{
                flex: 1,
                height: hasNegative ? H : h,
                justifyContent: hasNegative ? (p.net_worth >= 0 ? 'flex-start' : 'flex-end') : 'flex-end',
              }}>
              <View
                style={{
                  height: Math.max(2, h),
                  marginTop: hasNegative && p.net_worth >= 0 ? H / 2 - h : 0,
                  marginBottom: hasNegative && p.net_worth < 0 ? H / 2 - h : 0,
                  backgroundColor: p.net_worth >= 0 ? c.bar : c.negative,
                  borderTopLeftRadius: p.net_worth >= 0 ? 4 : 0,
                  borderTopRightRadius: p.net_worth >= 0 ? 4 : 0,
                  borderBottomLeftRadius: p.net_worth < 0 ? 4 : 0,
                  borderBottomRightRadius: p.net_worth < 0 ? 4 : 0,
                }}
              />
            </View>
          );
        })}
      </View>
      <Row style={{ gap: 4 }}>
        {points.map((p) => (
          <T key={p.month} variant="small" style={{ flex: 1, textAlign: 'center', fontSize: 10 }}>
            {new Date(p.month + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })}
          </T>
        ))}
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="small">{moneyWhole(points[0].net_worth)}</T>
        <T variant="small" style={{ fontWeight: '700' }}>
          {moneyWhole(points[points.length - 1].net_worth)} now
        </T>
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  mix: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 },
  heroLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  heroValue: { fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroDivider: { height: StyleSheet.hairlineWidth, opacity: 0.4, marginVertical: Spacing.md },
  heroSub: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
