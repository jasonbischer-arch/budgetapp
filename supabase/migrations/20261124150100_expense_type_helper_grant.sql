-- The category trigger runs as the signed-in user and calls this pure helper.
grant execute on function public.default_expense_type(text[]) to authenticated;
