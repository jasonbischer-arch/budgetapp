import { useState } from 'react';
import { Pressable } from 'react-native';

import { Button, Card, ErrorText, Input, Screen, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { isConfigured, supabase } from '@/lib/supabase';

const MIN_PASSWORD = 10;

export default function SignIn() {
  const c = useTheme();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setInfo(null);
    const creds = { email: email.trim(), password };
    const { data, error } =
      mode === 'sign-in'
        ? await supabase.auth.signInWithPassword(creds)
        : await supabase.auth.signUp(creds);
    if (error) setError(error.message);
    else if (mode === 'sign-up' && !data.session) {
      setInfo('Check your email to confirm your account, then sign in.');
      setMode('sign-in');
    }
    setBusy(false);
  }

  return (
    <Screen>
      <T variant="title" style={{ marginTop: 48 }}>Budget</T>
      <T variant="muted">Your household&apos;s money, all in one place.</T>

      {!isConfigured && (
        <Card>
          <T variant="heading">Setup needed</T>
          <T variant="muted">
            Add your Supabase URL and anon key to .env.local (see README), then restart the app.
          </T>
        </Card>
      )}

      <Card>
        <T variant="heading">{mode === 'sign-in' ? 'Sign in' : 'Create account'}</T>
        <Input
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Input
          placeholder="Password"
          secureTextEntry
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        {mode === 'sign-up' && (
          <T variant="small">Use at least {MIN_PASSWORD} characters. A passphrase works well.</T>
        )}
        <ErrorText message={error} />
        {info && <T color={c.positive}>{info}</T>}
        <Button
          title={mode === 'sign-in' ? 'Sign in' : 'Create account'}
          onPress={submit}
          loading={busy}
          disabled={!email || password.length < (mode === 'sign-up' ? MIN_PASSWORD : 1)}
        />
        <Pressable onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
          <T color={c.primary} style={{ textAlign: 'center' }}>
            {mode === 'sign-in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </T>
        </Pressable>
      </Card>
    </Screen>
  );
}
