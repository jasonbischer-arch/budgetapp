import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from './supabase';

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
  is_income: boolean;
  monthly_budget: number | null;
  sort_order: number;
  provider_categories: string[];
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
}

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

export async function updateCategoryBudget(id: string, monthly_budget: number | null) {
  unwrap(await supabase.from('categories').update({ monthly_budget }).eq('id', id));
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
  const rows = unwrap(await supabase.from('bills').select('*').order('due_day')) as Bill[];
  return rows.map((r) => ({ ...r, amount: num(r.amount), balance: num(r.balance), apr: num(r.apr) }));
}

export async function saveBill(householdId: string, bill: Omit<Bill, 'id'> & { id?: string }) {
  const { id, ...fields } = bill;
  if (id) unwrap(await supabase.from('bills').update(fields).eq('id', id));
  else unwrap(await supabase.from('bills').insert({ ...fields, household_id: householdId }));
}

export async function deleteBill(id: string) {
  unwrap(await supabase.from('bills').delete().eq('id', id));
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
