import {
  Account,
  Bill,
  Category,
  fetchAccounts,
  fetchBills,
  fetchCategories,
  fetchFirstTransactionDate,
  fetchIncomeSources,
  fetchLiabilities,
  fetchMonthlyFlows,
  FlowRow,
  IncomeSource,
  Liability,
  refreshAutoBudgets,
  useQuery,
} from './data';
import { monthStart } from './insights';
import { BillSchedule, PaySchedule } from './schedule';

export interface HouseholdData {
  accounts: Account[];
  categories: Category[];
  flows: FlowRow[];
  firstDate: string | null;
  incomes: IncomeSource[];
  bills: Bill[];
  liabilities: Liability[];
}

const EMPTY: HouseholdData = {
  accounts: [],
  categories: [],
  flows: [],
  firstDate: null,
  incomes: [],
  bills: [],
  liabilities: [],
};

/** Everything the Overview and Plan tabs need, reloaded on focus. */
export function useHouseholdData() {
  return useQuery<HouseholdData>(async () => {
    // Keep automatic budgets at the latest 12-month average (cheap; only
    // changes categories that follow the average).
    await refreshAutoBudgets().catch(() => {});
    const [accounts, categories, flows, firstDate, incomes, bills, liabilities] = await Promise.all([
      fetchAccounts(),
      fetchCategories(),
      fetchMonthlyFlows(monthStart(new Date(), -12)),
      fetchFirstTransactionDate(),
      fetchIncomeSources(),
      fetchBills(),
      fetchLiabilities(),
    ]);
    return { accounts, categories, flows, firstDate, incomes, bills, liabilities };
  }, EMPTY);
}

/** Cash in checking/savings and what's owed on cards (visible accounts). */
export function balances(accounts: Account[]) {
  const visible = accounts.filter((a) => !a.hidden);
  const cash = visible
    .filter((a) => a.type === 'depository')
    .reduce((s, a) => s + (a.balance_available ?? a.balance_ledger ?? 0), 0);
  const cardAccounts = visible.filter((a) => a.type === 'credit');
  const cards = cardAccounts.reduce((s, a) => s + (a.balance_ledger ?? 0), 0);
  return { cash, cards, cardAccounts };
}

export const toPaySchedule = (s: IncomeSource): PaySchedule => s;

/**
 * A bill as the planner sees it. Bills linked to a connected card or loan use
 * the bank's minimum payment when no amount is entered.
 */
export function toBillSchedule(bill: Bill, liabilities: Liability[]): BillSchedule {
  const l = bill.account_id ? liabilities.find((x) => x.account_id === bill.account_id) : undefined;
  return {
    id: bill.id,
    name: bill.name,
    amount: bill.amount ?? l?.minimum_payment ?? 0,
    frequency: bill.frequency,
    due_day: bill.due_day,
    due_month: bill.due_month,
  };
}

/** Balance and APR for a bill: from the linked account when there is one. */
export function debtDetails(bill: Bill, accounts: Account[], liabilities: Liability[]) {
  const account = bill.account_id ? accounts.find((a) => a.id === bill.account_id) : undefined;
  const l = bill.account_id ? liabilities.find((x) => x.account_id === bill.account_id) : undefined;
  const balance = account ? Math.abs(account.balance_ledger ?? 0) : bill.balance;
  const apr = bill.apr ?? l?.apr ?? null;
  const monthlyInterest = balance != null && apr != null ? (balance * apr) / 100 / 12 : null;
  return { account, balance, apr, monthlyInterest, linked: !!account };
}
