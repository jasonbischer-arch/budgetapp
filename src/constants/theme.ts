import '@/global.css';

export const Colors = {
  light: {
    text: '#0F172A',
    textSecondary: '#64748B',
    background: '#F8FAFC',
    card: '#FFFFFF',
    border: '#E2E8F0',
    primary: '#0F766E',
    primaryText: '#FFFFFF',
    positive: '#15803D',
    negative: '#B91C1C',
    warning: '#B45309',
    track: '#E2E8F0',
  },
  dark: {
    text: '#F1F5F9',
    textSecondary: '#94A3B8',
    background: '#0B1120',
    card: '#111827',
    border: '#1F2937',
    primary: '#2DD4BF',
    primaryText: '#042F2E',
    positive: '#4ADE80',
    negative: '#F87171',
    warning: '#FBBF24',
    track: '#1F2937',
  },
} as const;

export type Palette = { [K in keyof typeof Colors.light]: string };

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const Radius = { sm: 8, md: 12, lg: 16 } as const;
export const MaxContentWidth = 760;
