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

export interface Category {
  id: string;
  name: string;
  color: string;
  is_income: boolean;
  monthly_budget: number | null;
  sort_order: number;
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
  return unwrap(
    await supabase.from('accounts').select('*').order('institution_name').order('name'),
  );
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
  return unwrap(await supabase.from('categories').select('*').order('sort_order').order('name'));
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

/**
 * Spending per category for a set of transactions. Spending is money out
 * (negative amounts), reported as a positive number. Excluded transactions
 * (transfers, card payments) are ignored.
 */
export function summarize(txns: Transaction[], categories: Category[]) {
  const incomeIds = new Set(categories.filter((c) => c.is_income).map((c) => c.id));
  const spentByCategory = new Map<string | null, number>();
  let income = 0;
  let spent = 0;
  for (const t of txns) {
    if (t.excluded) continue;
    if (t.category_id && incomeIds.has(t.category_id)) {
      income += t.amount;
      continue;
    }
    if (t.amount < 0) {
      spent += -t.amount;
      spentByCategory.set(t.category_id, (spentByCategory.get(t.category_id) ?? 0) - t.amount);
    } else if (!t.category_id) {
      income += t.amount; // uncategorized deposits count as income
    } else {
      // refunds reduce spending in their category
      spent -= t.amount;
      spentByCategory.set(t.category_id, (spentByCategory.get(t.category_id) ?? 0) - t.amount);
    }
  }
  return { income, spent, spentByCategory };
}
