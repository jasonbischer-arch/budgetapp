// What's actually coming on a payday: change a scheduled check's amount,
// enter commission before taxes and get an estimated take-home, or add
// income that isn't on a schedule.
//
//   /payday?source=<income id>&date=YYYY-MM-DD&name=…&scheduled=1234   a scheduled check
//   /payday?id=<expected income id>                                     an edit you saved
//   /payday?date=YYYY-MM-DD                                             new extra income
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chip, Divider, ErrorText, Input, Row, Screen, Segmented, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { confirmAction } from '@/lib/confirm';
import {
  deleteExpectedIncome,
  ExpectedIncome,
  fetchExpectedIncomeById,
  saveExpectedIncome,
  saveTaxSettings,
} from '@/lib/data';
import { money, shortDate } from '@/lib/format';
import { today } from '@/lib/schedule';
import { commissionTakeHome, STATES } from '@/lib/taxes';

type Mode = 'commission' | 'takehome';

const parseNum = (s: string) => {
  const cleaned = s.replace(/[^0-9.]/g, '');
  return cleaned === '' ? null : Number(cleaned);
};

/** Converts M/D/YYYY or YYYY-MM-DD to YYYY-MM-DD (or null). */
function toISODate(s: string) {
  const t = s.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const iso = us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : t;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : null;
}

export default function PaydayEditor() {
  const c = useTheme();
  const params = useLocalSearchParams<{ id?: string; source?: string; date?: string; name?: string; scheduled?: string }>();
  const { household, refreshHousehold } = useAuth();

  const [existing, setExisting] = useState<ExpectedIncome | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(params.source || null);
  const [name, setName] = useState(params.name ?? '');
  const [date, setDate] = useState(params.date ?? today());
  const [mode, setMode] = useState<Mode>('commission');
  const [gross, setGross] = useState('');
  const [takeHome, setTakeHome] = useState(params.scheduled ?? '');
  const [state, setState] = useState<string | null>(household?.tax_state ?? null);
  const [pickState, setPickState] = useState(!household?.tax_state);
  const [retirement, setRetirement] = useState(household?.retirement_pct ? String(household.retirement_pct) : '');
  const [ownRate, setOwnRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing something you saved before: load it.
  useEffect(() => {
    if (!params.id) return;
    fetchExpectedIncomeById(params.id)
      .then((e) => {
        if (!e) return setError('Not found');
        setExisting(e);
        setSourceId(e.income_source_id);
        setName(e.name);
        setDate(e.pay_date);
        setTakeHome(String(e.amount));
        if (e.gross != null) {
          setMode('commission');
          setGross(String(e.gross));
          setOwnRate(e.tax_rate != null ? String(e.tax_rate) : '');
        } else {
          setMode('takehome');
        }
      })
      .catch((e) => setError(String(e)));
  }, [params.id]);

  const scheduled = params.scheduled ? Number(params.scheduled) : null;
  const isScheduled = !!sourceId;
  const grossNum = parseNum(gross);
  const rateNum = parseNum(ownRate);
  const retirementNum = Math.min(75, parseNum(retirement) ?? 0);
  const estimate = useMemo(
    () =>
      commissionTakeHome({
        gross: grossNum ?? 0,
        state,
        retirementPct: retirementNum,
        overrideRate: rateNum != null && rateNum <= 100 ? rateNum : null,
      }),
    [grossNum, state, retirementNum, rateNum],
  );
  const amount = mode === 'commission' ? estimate.net : parseNum(takeHome);
  const isoDate = toISODate(date);

  const problems: string[] = [];
  if (!name.trim()) problems.push('a name');
  if (!isoDate) problems.push('the date (M/D/YYYY)');
  if (mode === 'commission' && !(grossNum && grossNum > 0)) problems.push('the commission amount');
  if (mode === 'takehome' && amount == null) problems.push('the amount');
  if (rateNum != null && rateNum > 100) problems.push('a tax rate under 100%');

  async function save() {
    if (!household || problems.length || amount == null || !isoDate) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === 'commission' && (state !== household.tax_state || retirementNum !== household.retirement_pct)) {
        await saveTaxSettings(household.id, state, retirementNum);
        await refreshHousehold();
      }
      await saveExpectedIncome(household.id, {
        ...(existing ? { id: existing.id } : {}),
        income_source_id: sourceId,
        pay_date: isoDate,
        name: name.trim(),
        amount: Math.round(amount * 100) / 100,
        gross: mode === 'commission' ? grossNum : null,
        tax_rate: mode === 'commission' && rateNum != null ? rateNum : null,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  function reset() {
    if (!existing) return router.back();
    confirmAction(
      isScheduled ? 'Use the usual amount?' : `Delete ${existing.name}?`,
      isScheduled ? 'This check goes back to the amount from your paycheck schedule.' : 'It will be removed from incoming.',
      isScheduled ? 'Reset' : 'Delete',
      async () => {
        try {
          await deleteExpectedIncome(existing.id);
          router.back();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    );
  }

  const st = state ? STATES[state] : undefined;

  return (
    <Screen>
      <Stack.Screen options={{ title: isScheduled ? 'Edit paycheck' : 'Incoming money' }} />

      <Card>
        {isScheduled ? (
          <>
            <T variant="heading">{name}</T>
            <T variant="muted">
              Payday {isoDate ? shortDate(isoDate) : date}
              {scheduled != null ? ` · usually ${money(scheduled)}` : ''}
            </T>
          </>
        ) : (
          <>
            <T variant="small">Name</T>
            <Input value={name} onChangeText={setName} placeholder="e.g. November commission" maxLength={80} />
            <T variant="small">Date it lands</T>
            <Input value={date} onChangeText={setDate} placeholder="11/28/2026" autoCapitalize="none" />
          </>
        )}
      </Card>

      <Segmented
        options={[
          { value: 'commission', label: '💼 Commission (before taxes)' },
          { value: 'takehome', label: '💵 Take-home' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'takehome' ? (
        <Card>
          <T variant="small">Amount that will hit your account</T>
          <Input value={takeHome} onChangeText={setTakeHome} keyboardType="decimal-pad" placeholder="$0.00" />
        </Card>
      ) : (
        <>
          <Card>
            <T variant="small">Commission before taxes</T>
            <Input value={gross} onChangeText={setGross} keyboardType="decimal-pad" placeholder="$0.00" autoFocus />

            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="small">State you work in</T>
              <Button title={st ? `${st.name} · change` : 'Choose'} kind="secondary" onPress={() => setPickState(!pickState)} />
            </Row>
            {pickState && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs }}>
                {Object.keys(STATES)
                  .sort()
                  .map((code) => (
                    <Chip
                      key={code}
                      label={code}
                      selected={state === code}
                      onPress={() => {
                        setState(code);
                        setPickState(false);
                      }}
                    />
                  ))}
              </View>
            )}

            <T variant="small">401(k) or other pre-tax % (optional)</T>
            <Input value={retirement} onChangeText={setRetirement} keyboardType="decimal-pad" placeholder="0%" />
          </Card>

          <Card>
            <T variant="heading">Estimated take-home</T>
            {estimate.lines.map((l) => (
              <Row key={l.label} style={{ justifyContent: 'space-between' }}>
                <T variant="small">
                  {l.label} · {l.rate}%
                </T>
                <T variant="money">−{money(l.amount)}</T>
              </Row>
            ))}
            <Divider />
            <Row style={{ justifyContent: 'space-between' }}>
              <T style={{ fontWeight: '700' }}>Take-home ({estimate.totalRate}% withheld)</T>
              <T variant="money" color={c.positive} style={{ fontSize: 20, fontWeight: '800' }}>
                {money(estimate.net)}
              </T>
            </Row>
            <T variant="small">
              Withholding on commission paid separately: 22% federal, Social Security, Medicare
              {st ? ` and ${st.name}'s rate` : ''}. {st?.note ?? ''} Your paystub may differ. If it does, enter the
              total % your employer takes:
            </T>
            <Input
              value={ownRate}
              onChangeText={setOwnRate}
              keyboardType="decimal-pad"
              placeholder="Your total tax % (optional)"
            />
          </Card>
        </>
      )}

      <ErrorText message={error} />
      {problems.length > 0 && <T variant="small">To save, add {problems.join(', ')}.</T>}
      <Button
        title={amount != null ? `Save · ${money(amount)} incoming` : 'Save'}
        onPress={save}
        loading={saving}
        disabled={problems.length > 0}
      />
      {existing && (
        <Button title={isScheduled ? 'Use the usual amount' : 'Delete'} kind="danger" onPress={reset} />
      )}
    </Screen>
  );
}
