import '@/global.css';

export const Colors = {
  light: {
    text: '#0F172A',
    textSecondary: '#64748B',
    textMuted: '#94A3B8',
    background: '#F1F5F4',
    card: '#FFFFFF',
    cardAlt: '#F8FAFA',
    border: '#E3E8E7',
    primary: '#0F766E',
    primaryText: '#FFFFFF',
    primarySoft: '#E6F4F2',
    // Highlight card at the top of the Overview.
    hero: '#0B4F4A',
    heroText: '#FFFFFF',
    heroMuted: '#C9EAE5',
    // Gradient pairs for highlight cards.
    gradMoney: ['#0B4F4A', '#14857A', '#1BAF7A'],
    gradPlan: ['#1E3A8A', '#2A78D6', '#14857A'],
    gradWorth: ['#3B2A8F', '#6250D6', '#2A78D6'],
    // One hue for magnitude bars (spending by category, leftovers).
    bar: '#14857A',
    // Two identity colors that pass color-blind checks side by side
    // (paycheck split: save / spend).
    accent: '#2A78D6',
    saveColor: '#1BAF7A',
    track: '#E3E8E7',
    positive: '#15803D',
    negative: '#B91C1C',
    warning: '#B45309',
    warningSoft: '#FEF3E2',
    shadow: 'rgba(15, 23, 42, 0.06)',
  },
  dark: {
    text: '#F1F5F9',
    textSecondary: '#A3B1C2',
    textMuted: '#6B7A8C',
    background: '#0A1110',
    card: '#121C1B',
    cardAlt: '#172322',
    border: '#22302E',
    primary: '#2DD4BF',
    primaryText: '#042F2E',
    primarySoft: '#123330',
    hero: '#0F3D39',
    heroText: '#F0FDFA',
    heroMuted: '#B5DCD6',
    gradMoney: ['#0B3B37', '#106A61', '#13875F'],
    gradPlan: ['#172E6B', '#1F5FAE', '#106A61'],
    gradWorth: ['#2B1F6B', '#4A3BB0', '#1F5FAE'],
    bar: '#2BB5A4',
    accent: '#3987E5',
    saveColor: '#199E70',
    track: '#22302E',
    positive: '#4ADE80',
    negative: '#F87171',
    warning: '#FBBF24',
    warningSoft: '#3A2A10',
    shadow: 'rgba(0, 0, 0, 0.3)',
  },
} as const;

export type Palette = {
  [K in keyof typeof Colors.light]: (typeof Colors.light)[K] extends readonly string[] ? readonly string[] : string;
};

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const Radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
export const MaxContentWidth = 760;
