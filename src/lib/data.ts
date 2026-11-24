import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { callFunction, supabase } from './supabase';

export interface Account {
  id: string;
  name: string;
  institution_name: string | null;
  type: 'depository' | 'credit' | string;
  subtype: string | null;
  last_four: string | null;
  balance_available: number | null;
  balance_ledger: number | null;
  hidden: boolean;
  item_id: string;
}

export interface BankItem {
  id: string;
  institution_name: string | null;
  status: 'active' | 'disconnected' | 'error';
  last_error: string | null;
  last_synced_at: string | null;
}

export type CategoryKind = 'income' | 'expense' | 'transfer' | 'savings';

export interface Category {
  id: string;
  name: string;
  color: string;
  kind: CategoryKind;
  /** Fixed (rent, utilities, insurance...) or variable (groceries, dining...). */
  expense_type: 'fixed' | 'variable';
  /** true: the budget follows the 12-month average automatically. */
  budget_auto: boolean;
  is_income: boolean;
  monthly_budget: number | null;
  sort_order: number;
  provider_categories: string[];
  /** Emoji you picked (otherwise one is chosen from the bank category). */
  icon: string | null;
}

/** Built-in categories are matched to the bank's categories; yours aren't. */
export const isCustomCategory = (c: Pick<Category, 'provider_categories'>) => !c.provider_categories?.length;

export interface CategoryInput {
  name: string;
  color: string;
  icon: string | null;
  kind: 'expense' | 'income';
  expense_type: 'fixed' | 'variable';
}

/** Creates a category and returns its id. */
export async function createCategory(householdId: string, input: CategoryInput): Promise<string> {
  const row = unwrap(
    await supabase
      .from('categories')
      .insert({
        ...input,
        household_id: householdId,
        is_income: input.kind === 'income',
        provider_categories: [],
        sort_order: 50,
      })
      .select('id')
      .single(),
  ) as { id: string };
  return row.id;
}

export async function updateCategory(id: string, input: CategoryInput) {
  unwrap(await supabase.from('categories').update({ ...input, is_income: input.kind === 'income' }).eq('id', id));
}

/** Deletes a category; its transactions become uncategorized. */
export async function deleteCategory(id: string) {
  unwrap(await supabase.from('categories').delete().eq('id', id));
}

export async function countCategoryTransactions(id: string): Promise<number> {
  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type Frequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export type WeekendShift = 'none' | 'before' | 'after';

export interface IncomeSource {
  id: string;
  name: string;
  amount: number;
  frequency: Frequency;
  anchor_date: string | null;
  day1: number | null;
  day2: number | null;
  weekend_shift: WeekendShift;
  /** Managed by paycheck detection (amount/schedule follow the bank). */
  auto: boolean;
  /** Set when this paycheck was found in bank deposits. */
  detection_key: string | null;
  average_amount: number | null;
  last_amount: number | null;
  last_paid: string | null;
  occurrences: number | null;
}

/** The fields you can edit on a paycheck. */
export type IncomeSourceInput = Pick<
  IncomeSource,
  'name' | 'amount' | 'frequency' | 'anchor_date' | 'day1' | 'day2' | 'weekend_shift'
>;

export type BillFrequency = 'monthly' | 'quarterly' | 'yearly';

export interface Bill {
  id: string;
  name: string;
  amount: number | null;
  frequency: BillFrequency;
  due_day: number;
  due_month: number | null;
  is_debt: boolean;
  balance: number | null;
  apr: number | null;
  account_id: string | null;
  category_id: string | null;
  /** Managed by bill detection; editing makes it yours. */
  auto: boolean;
  detection_key: string | null;
  last_paid: string | null;
  occurrences: number | null;
  /** Manual debts: the date `balance` was right (it pays down from there). */
  balance_date: string | null;
  debt_kind: 'auto_loan' | 'mortgage' | 'student_loan' | 'personal_loan' | 'other' | null;
  /** Counted with fixed or variable expenses on the Overview. */
  expense_type: 'fixed' | 'variable';
}

/** The fields you edit on a bill. */
export type BillInput = Omit<Bill, 'id' | 'auto' | 'detection_key' | 'last_paid' | 'occurrences'>;

export interface Liability {
  account_id: string;
  apr: number | null;
  minimum_payment: number | null;
  next_due_date: string | null;
  last_statement_balance: number | null;
}

export type Flow = 'income' | 'spending' | 'refund' | 'saved';

export interface FlowRow {
  month: string;
  flow: Flow;
  category_id: string | null;
  total: number;
  n: number;
}


export interface Transaction {
  id: string;
  account_id: string;
  date: string;
  description: string;
  merchant: string | null;
  amount: number;
  status: 'posted' | 'pending';
  category_id: string | null;
  notes: string | null;
  excluded: boolean;
}

/**
 * Runs a loader whenever the screen gains focus or `key` changes (e.g. the
 * selected month); exposes reload().
 */
export function useQuery<T>(loader: () => Promise<T>, initial: T, key = '') {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loaderRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const firstKey = useRef(key);
  useEffect(() => {
    if (key === firstKey.current) return;
    firstKey.current = key;
    reload();
  }, [key, reload]);

  return { data, loading, error, reload };
}

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function fetchAccounts(): Promise<Account[]> {
  const rows = unwrap(
    await supabase.from('accounts').select('*').order('institution_name').order('name'),
  ) as Account[];
  return rows.map((a) => ({
    ...a,
    balance_available: a.balance_available == null ? null : Number(a.balance_available),
    balance_ledger: a.balance_ledger == null ? null : Number(a.balance_ledger),
  }));
}

export async function fetchBankItems(): Promise<BankItem[]> {
  return unwrap(
    await supabase
      .from('bank_items')
      .select('id, institution_name, status, last_error, last_synced_at')
      .order('created_at'),
  );
}

export async function fetchCategories(): Promise<Category[]> {
  const rows = unwrap(
    await supabase.from('categories').select('*').order('sort_order').order('name'),
  ) as Category[];
  return rows.map((c) => ({
    ...c,
    monthly_budget: c.monthly_budget == null ? null : Number(c.monthly_budget),
  }));
}

export async function fetchTransactions(opts: { from?: string; to?: string; limit?: number } = {}) {
  let q = supabase
    .from('transactions')
    .select('*')
    .order('date', { ascending: false })
    .order('id');
  if (opts.from) q = q.gte('date', opts.from);
  if (opts.to) q = q.lt('date', opts.to);
  q = q.limit(opts.limit ?? 1000);
  return unwrap(await q) as Transaction[];
}

export async function updateTransaction(
  id: string,
  patch: Partial<Pick<Transaction, 'category_id' | 'notes' | 'excluded'>>,
) {
  unwrap(await supabase.from('transactions').update(patch).eq('id', id));
}

/** Sets a budget by hand: it stops following the automatic average. */
export async function updateCategoryBudget(id: string, monthly_budget: number | null) {
  unwrap(await supabase.from('categories').update({ monthly_budget, budget_auto: false }).eq('id', id));
}

/** Hands a category's budget back to the automatic 12-month average. */
export async function resetCategoryBudget(id: string) {
  unwrap(await supabase.from('categories').update({ monthly_budget: null, budget_auto: true }).eq('id', id));
  await refreshAutoBudgets();
}

/** Sets variable-category budgets to their 12-month average (server-side). */
export async function refreshAutoBudgets() {
  unwrap(await supabase.rpc('refresh_auto_budgets'));
}

export async function saveSavingsPerCheck(householdId: string, value: number | null) {
  unwrap(await supabase.from('households').update({ savings_per_check: value }).eq('id', householdId));
}

export async function rotateInviteCode(): Promise<string> {
  return unwrap(await supabase.rpc('rotate_invite_code')) as string;
}

export async function setAccountHidden(id: string, hidden: boolean) {
  unwrap(await supabase.from('accounts').update({ hidden }).eq('id', id));
}

/** First day of a month and of the next month, as YYYY-MM-DD. */
export function monthRange(year: number, monthIndex: number) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = monthIndex === 11 ? [year + 1, 0] : [year, monthIndex + 1];
  return {
    from: `${year}-${pad(monthIndex + 1)}-01`,
    to: `${next[0]}-${pad(next[1] + 1)}-01`,
  };
}


// ---------------------------------------------------------------------------
// Plan data: income sources, bills, debt details, money flows
// ---------------------------------------------------------------------------

const num = (v: unknown) => (v == null ? null : Number(v));

export async function fetchIncomeSources(): Promise<IncomeSource[]> {
  const rows = unwrap(
    await supabase.from('income_sources').select('*').eq('dismissed', false).order('created_at'),
  ) as IncomeSource[];
  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    average_amount: num(r.average_amount),
    last_amount: num(r.last_amount),
  }));
}

/**
 * Saves a paycheck. Editing a detected paycheck makes it yours: detection
 * stops changing its amount and schedule (it still refreshes the stats).
 */
export async function saveIncomeSource(householdId: string, src: IncomeSourceInput & { id?: string }) {
  const { id, ...fields } = src;
  if (id) unwrap(await supabase.from('income_sources').update({ ...fields, auto: false }).eq('id', id));
  else unwrap(await supabase.from('income_sources').insert({ ...fields, household_id: householdId }));
}

/** Deletes a paycheck; a detected one is hidden so detection won't re-add it. */
export async function deleteIncomeSource(src: Pick<IncomeSource, 'id' | 'detection_key'>) {
  if (src.detection_key) {
    unwrap(await supabase.from('income_sources').update({ dismissed: true }).eq('id', src.id));
  } else {
    unwrap(await supabase.from('income_sources').delete().eq('id', src.id));
  }
}

export async function fetchBills(): Promise<Bill[]> {
  const rows = unwrap(
    await supabase.from('bills').select('*').eq('dismissed', false).order('due_day'),
  ) as Bill[];
  return rows.map((r) => ({ ...r, amount: num(r.amount), balance: num(r.balance), apr: num(r.apr) }));
}

/** Saves a bill. Editing a detected bill makes it yours (detection stops changing it). */
export async function saveBill(householdId: string, bill: BillInput & { id?: string }) {
  const { id, ...fields } = bill;
  if (id) unwrap(await supabase.from('bills').update({ ...fields, auto: false }).eq('id', id));
  else unwrap(await supabase.from('bills').insert({ ...fields, household_id: householdId }));
}

/** Deletes a bill; a detected one is hidden so detection won't add it back. */
export async function deleteBill(bill: Pick<Bill, 'id' | 'detection_key'>) {
  if (bill.detection_key) unwrap(await supabase.from('bills').update({ dismissed: true }).eq('id', bill.id));
  else unwrap(await supabase.from('bills').delete().eq('id', bill.id));
}

/** Counts a bill as a fixed or a variable expense. */
export async function setBillExpenseType(id: string, expense_type: 'fixed' | 'variable') {
  unwrap(await supabase.from('bills').update({ expense_type }).eq('id', id));
}

/** Counts a spending category as fixed or variable. */
export async function setCategoryExpenseType(id: string, expense_type: 'fixed' | 'variable') {
  unwrap(await supabase.from('categories').update({ expense_type }).eq('id', id));
}

// ---------------------------------------------------------------------------
// Expected income: commission/bonus amounts and one-off income
// ---------------------------------------------------------------------------

export interface ExpectedIncome {
  id: string;
  /** Set when this replaces a scheduled paycheck on pay_date. */
  income_source_id: string | null;
  pay_date: string;
  name: string;
  /** Take-home. */
  amount: number;
  /** Before taxes, when entered as commission. */
  gross: number | null;
  /** Your own total withholding %, if you set one. */
  tax_rate: number | null;
}

export type ExpectedIncomeInput = Omit<ExpectedIncome, 'id'>;

export async function fetchExpectedIncome(from: string, to: string): Promise<ExpectedIncome[]> {
  const rows = unwrap(
    await supabase
      .from('expected_income')
      .select('id, income_source_id, pay_date, name, amount, gross, tax_rate')
      .gte('pay_date', from)
      .lte('pay_date', to)
      .order('pay_date'),
  ) as ExpectedIncome[];
  return rows.map((r) => ({ ...r, amount: Number(r.amount), gross: num(r.gross), tax_rate: num(r.tax_rate) }));
}

export async function fetchExpectedIncomeById(id: string): Promise<ExpectedIncome | null> {
  const rows = unwrap(
    await supabase
      .from('expected_income')
      .select('id, income_source_id, pay_date, name, amount, gross, tax_rate')
      .eq('id', id)
      .limit(1),
  ) as ExpectedIncome[];
  const r = rows[0];
  return r ? { ...r, amount: Number(r.amount), gross: num(r.gross), tax_rate: num(r.tax_rate) } : null;
}

export async function saveExpectedIncome(householdId: string, row: ExpectedIncomeInput & { id?: string }) {
  const { id, ...fields } = row;
  if (id) unwrap(await supabase.from('expected_income').update(fields).eq('id', id));
  else unwrap(await supabase.from('expected_income').insert({ ...fields, household_id: householdId }));
}

export async function deleteExpectedIncome(id: string) {
  unwrap(await supabase.from('expected_income').delete().eq('id', id));
}

/** Remembers you took this month's budget suggestions (they return on the 1st). */
export async function markBudgetHelpDone(householdId: string, month: string) {
  unwrap(await supabase.from('households').update({ budget_help_month: month }).eq('id', householdId));
}

export async function saveTaxSettings(householdId: string, tax_state: string | null, retirement_pct: number) {
  unwrap(await supabase.from('households').update({ tax_state, retirement_pct }).eq('id', householdId));
}

/** Spending and refunds in a category (null = uncategorized) between dates. */
export async function fetchCategoryTransactions(opts: { categoryId: string | null; from: string; to: string }) {
  let q = supabase
    .from('transaction_flows')
    .select('id, date, description, merchant, amount, flow, account_id')
    .in('flow', ['spending', 'refund'])
    .gte('date', opts.from)
    .lt('date', opts.to)
    .order('date', { ascending: false })
    .limit(1000);
  q = opts.categoryId ? q.eq('category_id', opts.categoryId) : q.is('category_id', null);
  const rows = unwrap(await q) as {
    id: string;
    date: string;
    description: string;
    merchant: string | null;
    amount: number;
    flow: 'spending' | 'refund';
    account_id: string;
  }[];
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/** Money out (spending, not transfers) since a date, newest first. */
export async function fetchSpendingSince(from: string) {
  const rows = unwrap(
    await supabase
      .from('transaction_flows')
      .select('date, amount, description, merchant, category_id')
      .eq('flow', 'spending')
      .gte('date', from)
      .order('date', { ascending: false })
      .limit(3000),
  ) as { date: string; amount: number; description: string; merchant: string | null; category_id: string | null }[];
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/** Re-runs paycheck and bill detection now (also runs after every sync). */
export async function detectRecurring() {
  return callFunction<{
    paychecks?: { found: number; added: number };
    bills?: { found: number; added: number };
  }>('paychecks-detect');
}

export async function fetchLiabilities(): Promise<Liability[]> {
  const rows = unwrap(await supabase.from('account_liabilities').select('*')) as Liability[];
  return rows.map((r) => ({
    ...r,
    apr: num(r.apr),
    minimum_payment: num(r.minimum_payment),
    last_statement_balance: num(r.last_statement_balance),
  }));
}

/** Monthly totals per flow and category since a date. */
export async function fetchMonthlyFlows(from: string): Promise<FlowRow[]> {
  const rows = unwrap(await supabase.rpc('monthly_flows', { p_from: from })) as FlowRow[];
  return rows.map((r) => ({ ...r, total: Number(r.total), n: Number(r.n) }));
}

/** The date of the household's oldest transaction, if any. */
export async function fetchFirstTransactionDate(): Promise<string | null> {
  const rows = unwrap(
    await supabase.from('transactions').select('date').order('date').limit(1),
  ) as { date: string }[];
  return rows[0]?.date ?? null;
}

export async function setCategoryBudgets(budgets: { id: string; monthly_budget: number | null }[]) {
  for (const b of budgets) await updateCategoryBudget(b.id, b.monthly_budget);
}

// ---------------------------------------------------------------------------
// Net worth
// ---------------------------------------------------------------------------

export type AssetKind = 'home' | 'vehicle' | 'investment' | 'cash' | 'other';

export interface ManualAsset {
  id: string;
  name: string;
  kind: AssetKind;
  value: number;
  value_date: string;
  annual_change_pct: number;
  loan_account_id: string | null;
  loan_bill_id: string | null;
  /** Homes only: address used for the automatic monthly value. */
  address: string | null;
  auto_value: boolean;
  value_source: 'manual' | 'rentcast';
  value_low: number | null;
  value_high: number | null;
  valued_at: string | null;
  value_error: string | null;
}

/** Fields you edit; the valuation fields are written by the server. */
export type ManualAssetInput = Omit<
  ManualAsset,
  'id' | 'value_source' | 'value_low' | 'value_high' | 'valued_at' | 'value_error'
>;

/** Looks up a home's value now (at most once a day per home). */
export async function refreshHomeValue(assetId: string) {
  return callFunction<{ results: { id: string; status: string; error?: string; value?: number }[] }>(
    'home-values',
    { assetId },
  );
}

export interface NetWorthItem {
  section: 'asset' | 'liability';
  kind: string;
  name: string;
  amount: number;
  source: 'bank' | 'manual';
  ref_id: string;
  loan_ref: string | null;
}

export interface NetWorthPoint {
  month: string;
  assets: number;
  liabilities: number;
  net_worth: number;
}

export async function fetchNetWorthItems(): Promise<NetWorthItem[]> {
  const rows = unwrap(await supabase.rpc('net_worth_items')) as NetWorthItem[];
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/** Saves this month's snapshot, then returns the history (oldest first). */
export async function fetchNetWorthHistory(): Promise<NetWorthPoint[]> {
  await supabase.rpc('record_net_worth');
  const rows = unwrap(
    await supabase.from('net_worth_history').select('month, assets, liabilities, net_worth').order('month'),
  ) as NetWorthPoint[];
  return rows.map((r) => ({
    month: r.month,
    assets: Number(r.assets),
    liabilities: Number(r.liabilities),
    net_worth: Number(r.net_worth),
  }));
}

export async function fetchManualAssets(): Promise<ManualAsset[]> {
  const rows = unwrap(await supabase.from('manual_assets').select('*').order('created_at')) as ManualAsset[];
  return rows.map((r) => ({
    ...r,
    value: Number(r.value),
    annual_change_pct: Number(r.annual_change_pct),
    value_low: r.value_low == null ? null : Number(r.value_low),
    value_high: r.value_high == null ? null : Number(r.value_high),
  }));
}

/** Saves an asset and returns its id. */
export async function saveManualAsset(householdId: string, asset: ManualAssetInput & { id?: string }) {
  const { id, ...fields } = asset;
  if (id) {
    unwrap(await supabase.from('manual_assets').update(fields).eq('id', id));
    return id;
  }
  const row = unwrap(
    await supabase.from('manual_assets').insert({ ...fields, household_id: householdId }).select('id').single(),
  ) as { id: string };
  return row.id;
}

export async function deleteManualAsset(id: string) {
  unwrap(await supabase.from('manual_assets').delete().eq('id', id));
}
