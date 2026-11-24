// Emojis and colors for categories, bills and net worth groups.

interface CategoryLike {
  name: string;
  color?: string;
  provider_categories?: string[];
}

/** Most specific first: Plaid detailed categories, then primary, then name words. */
const CATEGORY_EMOJI: [string, string][] = [
  ['FOOD_AND_DRINK_GROCERIES', '🛒'],
  ['FOOD_AND_DRINK', '🍔'],
  ['RENT_AND_UTILITIES_RENT', '🏠'],
  ['HOME_IMPROVEMENT', '🔨'],
  ['RENT_AND_UTILITIES', '💡'],
  ['TRANSPORTATION', '🚗'],
  ['TRAVEL', '✈️'],
  ['GENERAL_MERCHANDISE', '🛍️'],
  ['ENTERTAINMENT', '🎬'],
  ['MEDICAL', '🩺'],
  ['PERSONAL_CARE', '💇'],
  ['GENERAL_SERVICES_INSURANCE', '🛡️'],
  ['GENERAL_SERVICES_EDUCATION', '🎓'],
  ['GENERAL_SERVICES', '📺'],
  ['GOVERNMENT_AND_NON_PROFIT_DONATIONS', '🎁'],
  ['GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT', '🧾'],
  ['LOAN_PAYMENTS', '🏦'],
  ['TRANSFER_OUT_SAVINGS', '📈'],
  ['BANK_FEES', '💸'],
  ['TRANSFER_IN', '🔁'],
  ['INCOME', '💰'],
  ['OTHER', '📦'],
];

const NAME_EMOJI: [RegExp, string][] = [
  [/grocer/i, '🛒'],
  [/dining|restaurant|food|drink|coffee/i, '🍔'],
  [/rent|home|house|mortgage/i, '🏠'],
  [/utilit|electric|power|gas|water|energy/i, '💡'],
  [/phone|mobile|wireless|verizon|t-mobile|at&t/i, '📱'],
  [/internet|wifi|comcast|xfinity|spectrum|fiber/i, '🌐'],
  [/car|auto|vehicle|tiguan|honda|toyota|ford|ally|fuel/i, '🚗'],
  [/travel|flight|hotel|airline/i, '✈️'],
  [/shop|amazon|target|walmart/i, '🛍️'],
  [/netflix|hulu|disney|spotify|stream|subscri|youtube|hbo|max/i, '📺'],
  [/gym|fitness|climb/i, '🏋️'],
  [/insur/i, '🛡️'],
  [/student|tuition|school|education/i, '🎓'],
  [/health|medical|doctor|dental|pharma/i, '🩺'],
  [/card|visa|mastercard|amex|discover/i, '💳'],
  [/loan/i, '🏦'],
  [/tax/i, '🧾'],
  [/income|pay|salary/i, '💰'],
  [/sav|invest/i, '📈'],
  [/gift|giv|donat|church|charity/i, '🎁'],
  [/pet|dog|cat|vet/i, '🐾'],
  [/kid|child|daycare/i, '🧸'],
];

export function categoryEmoji(cat: CategoryLike | undefined | null): string {
  if (!cat) return '❔';
  for (const [code, emoji] of CATEGORY_EMOJI) {
    if (cat.provider_categories?.includes(code)) return emoji;
  }
  return nameEmoji(cat.name) ?? '📦';
}

export function nameEmoji(name: string): string | null {
  for (const [re, emoji] of NAME_EMOJI) if (re.test(name)) return emoji;
  return null;
}

const DEBT_EMOJI: Record<string, string> = {
  auto_loan: '🚗',
  mortgage: '🏠',
  student_loan: '🎓',
  personal_loan: '🏦',
  other: '🏦',
};

/** An emoji for a bill: its debt type, else its category, else its name. */
export function billEmoji(
  bill: { name: string; is_debt: boolean; debt_kind?: string | null; account_type?: string | null },
  category?: CategoryLike | null,
): string {
  if (bill.account_type === 'credit') return '💳';
  if (bill.debt_kind && DEBT_EMOJI[bill.debt_kind]) return DEBT_EMOJI[bill.debt_kind];
  return nameEmoji(bill.name) ?? (category ? categoryEmoji(category) : bill.is_debt ? '🏦' : '🧾');
}

/** Net worth groups: color and emoji (colors validated together for contrast). */
export const GROUP_STYLE: Record<string, { emoji: string; color: string }> = {
  cash: { emoji: '💵', color: '#2A78D6' },
  investment: { emoji: '📈', color: '#1BAF7A' },
  home: { emoji: '🏠', color: '#6250D6' },
  vehicle: { emoji: '🚗', color: '#EDA100' },
  other: { emoji: '💎', color: '#E87BA4' },
  mortgage: { emoji: '🏠', color: '#6250D6' },
  auto_loan: { emoji: '🚗', color: '#EDA100' },
  student_loan: { emoji: '🎓', color: '#1BAF7A' },
  credit_card: { emoji: '💳', color: '#E34948' },
  loan: { emoji: '🏦', color: '#2A78D6' },
  debt: { emoji: '🧾', color: '#E87BA4' },
};

/** A light tint of a hex color for backgrounds (e.g. '#2A78D6' -> rgba(...,0.12)). */
export function tint(hex: string, alpha = 0.12): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
