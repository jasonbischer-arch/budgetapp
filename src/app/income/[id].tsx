import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { Button, Card, ErrorText, Input, Row, Screen, Segmented, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { deleteIncomeSource, fetchIncomeSources, Frequency, saveIncomeSource } from '@/lib/data';
import { shortDate, weekday } from '@/lib/format';
import { addDays, paydays, today } from '@/lib/schedule';

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 wks' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'monthly', label: 'Monthly' },
];

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const dayNum = (s: string) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
};

/** Converts M/D/YYYY or YYYY-MM-DD to YYYY-MM-DD. */
function normalizeDate(s: string) {
  const t = s.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return t;
}

export default function IncomeEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { household } = useAuth();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('biweekly');
  const [anchor, setAnchor] = useState('');
  const [day1, setDay1] = useState('');
  const [day2, setDay2] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    fetchIncomeSources()
      .then((all) => {
        const s = all.find((x) => x.id === id);
        if (!s) return setError('Paycheck not found');
        setName(s.name);
        setAmount(String(s.amount));
        setFrequency(s.frequency);
        setAnchor(s.anchor_date ?? '');
        setDay1(s.day1 ? String(s.day1) : '');
        setDay2(s.day2 ? String(s.day2) : '');
      })
      .catch((e) => setError(String(e)));
  }, [id, isNew]);

  const anchorISO = normalizeDate(anchor);
  const needsAnchor = frequency === 'weekly' || frequency === 'biweekly';
  const draft = {
    name: name.trim(),
    amount: Number(amount.replace(/[^0-9.]/g, '')),
    frequency,
    anchor_date: needsAnchor && isDate(anchorISO) ? anchorISO : null,
    day1: frequency === 'semimonthly' || frequency === 'monthly' ? dayNum(day1) : null,
    day2: frequency === 'semimonthly' ? dayNum(day2) : null,
  };
  const valid =
    !!draft.name &&
    draft.amount > 0 &&
    (needsAnchor ? !!draft.anchor_date : !!draft.day1 && (frequency !== 'semimonthly' || !!draft.day2));
  const preview = valid ? paydays({ id: 'p', ...draft }, today(), addDays(today(), 62)).slice(0, 4) : [];

  async function save() {
    if (!household || !valid) return;
    setSaving(true);
    try {
      await saveIncomeSource(household.id, { ...(isNew ? {} : { id }), ...draft });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  function remove() {
    const go = async () => {
      await deleteIncomeSource(id).catch((e) => setError(String(e)));
      router.back();
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete ${name}?`)) go();
    } else {
      Alert.alert('Delete paycheck', `Delete ${name}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: go },
      ]);
    }
  }

  return (
    <Screen>
      <Card>
        <T variant="small">Name</T>
        <Input value={name} onChangeText={setName} placeholder="e.g. Jason's paycheck" maxLength={80} />
        <T variant="small">Take-home amount per paycheck</T>
        <Input value={amount} onChangeText={setAmount} placeholder="$0.00" keyboardType="decimal-pad" />
      </Card>

      <Card>
        <T variant="small">How often</T>
        <Segmented options={FREQUENCIES} value={frequency} onChange={setFrequency} />
        {needsAnchor && (
          <>
            <T variant="small">A recent or upcoming payday (MM/DD/YYYY)</T>
            <Input value={anchor} onChangeText={setAnchor} placeholder="11/27/2026" autoCorrect={false} />
          </>
        )}
        {frequency === 'semimonthly' && (
          <Row style={{ gap: Spacing.md }}>
            <View style={{ flex: 1, gap: Spacing.xs }}>
              <T variant="small">First payday (day)</T>
              <Input value={day1} onChangeText={setDay1} placeholder="7" keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1, gap: Spacing.xs }}>
              <T variant="small">Second payday (day)</T>
              <Input value={day2} onChangeText={setDay2} placeholder="22" keyboardType="number-pad" />
            </View>
          </Row>
        )}
        {frequency === 'monthly' && (
          <>
            <T variant="small">Payday (day of month)</T>
            <Input value={day1} onChangeText={setDay1} placeholder="1" keyboardType="number-pad" />
          </>
        )}
        {preview.length > 0 && (
          <T variant="small">
            Next paydays: {preview.map((p) => `${weekday(p.date)} ${shortDate(p.date)}`).join(' · ')}
          </T>
        )}
      </Card>

      <ErrorText message={error} />
      <Button title="Save" onPress={save} loading={saving} disabled={!valid} />
      {!isNew && <Button title="Delete paycheck" kind="danger" onPress={remove} />}
    </Screen>
  );
}
