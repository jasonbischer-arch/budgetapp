import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppLock } from '@/components/app-lock';
import { AuthProvider, useAuth } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, household, loading } = useAuth();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  const signedIn = !!session;
  const ready = signedIn && !!household;

  return (
    <AppLock enabled={signedIn}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !household}>
          <Stack.Screen name="household" />
        </Stack.Protected>
        <Stack.Protected guard={ready}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="transaction/[id]"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: 'Transaction',
            }}
          />
          <Stack.Screen
            name="bill/[id]"
            options={{ presentation: 'modal', headerShown: true, title: 'Bill' }}
          />
          <Stack.Screen
            name="asset/[id]"
            options={{ presentation: 'modal', headerShown: true, title: 'Asset' }}
          />
          <Stack.Screen
            name="income/[id]"
            options={{ presentation: 'modal', headerShown: true, title: 'Paycheck' }}
          />
          <Stack.Screen
            name="expenses/pick"
            options={{ presentation: 'modal', headerShown: true, title: 'Add an expense' }}
          />
          <Stack.Screen
            name="expenses/[type]"
            options={{ presentation: 'modal', headerShown: true, title: 'Expenses' }}
          />
          <Stack.Screen
            name="networth-account/[id]"
            options={{ presentation: 'modal', headerShown: true, title: 'Net worth item' }}
          />
          <Stack.Screen name="savings" options={{ presentation: 'modal', headerShown: true, title: 'Ways to cut' }} />
          <Stack.Screen name="payday" options={{ presentation: 'modal', headerShown: true, title: 'Incoming' }} />
          <Stack.Screen
            name="categories/index"
            options={{ presentation: 'modal', headerShown: true, title: 'Categories' }}
          />
          <Stack.Screen
            name="categories/[id]"
            options={{ presentation: 'modal', headerShown: true, title: 'Category' }}
          />
          <Stack.Screen
            name="category/[id]"
            options={{ presentation: 'modal', headerShown: true, title: 'Category' }}
          />
        </Stack.Protected>
      </Stack>
    </AppLock>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    // Swipe gestures (e.g. swipe a bill to remove it from your plan).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
