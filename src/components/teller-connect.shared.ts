// Shared types and config for Teller Connect (web and native).

export interface TellerEnrollment {
  accessToken: string;
  enrollment: { id: string; institution?: { name?: string } };
  user?: { id: string };
}

export interface TellerConnectProps {
  /** Pass an enrollment id to reconnect a bank that needs re-authentication. */
  enrollmentId?: string;
  onSuccess: (enrollment: TellerEnrollment) => void;
  onExit?: () => void;
}

export const TELLER_APP_ID = process.env.EXPO_PUBLIC_TELLER_APP_ID ?? '';
export const TELLER_ENV = process.env.EXPO_PUBLIC_TELLER_ENV ?? 'sandbox';
export const TELLER_SCRIPT = 'https://cdn.teller.io/connect/connect.js';

export function tellerSetupOptions(enrollmentId?: string) {
  return {
    applicationId: TELLER_APP_ID,
    environment: TELLER_ENV,
    products: ['transactions', 'balance'],
    selectAccount: 'multiple',
    ...(enrollmentId ? { enrollmentId } : {}),
  };
}
