import { useState } from 'react';

import { Button, Card, ErrorText, Input, Screen, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export default function HouseholdSetup() {
  const { refreshHousehold, signOut } = useAuth();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'create' | 'join') {
    setBusy(kind);
    setError(null);
    const { data, error } =
      kind === 'create'
        ? await supabase.rpc('create_household', { household_name: name })
        : await supabase.rpc('join_household', { code });
    if (error) setError(error.message);
    else if (!data) setError('That invite code didn\u2019t match. Check it and try again.');
    else await refreshHousehold();
    setBusy(null);
  }

  return (
    <Screen>
      <T variant="title" style={{ marginTop: 48 }}>Set up your household</T>
      <T variant="muted">
        One of you creates the household, then shares the invite code so the other can join. You
        both see the same accounts and budgets.
      </T>

      <Card>
        <T variant="heading">Create a household</T>
        <Input placeholder="Name (e.g. The Smiths)" value={name} onChangeText={setName} />
        <Button title="Create" onPress={() => run('create')} loading={busy === 'create'} />
      </Card>

      <Card>
        <T variant="heading">Join with an invite code</T>
        <Input
          placeholder="Invite code"
          autoCapitalize="characters"
          value={code}
          onChangeText={setCode}
        />
        <Button
          title="Join"
          kind="secondary"
          onPress={() => run('join')}
          loading={busy === 'join'}
          disabled={code.trim().length < 4}
        />
      </Card>

      <ErrorText message={error} />
      <Button title="Sign out" kind="secondary" onPress={signOut} />
    </Screen>
  );
}
