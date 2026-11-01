-- Row guards for this slice's tables (see 0001_row_guards.sql). A sale return is final, like a
-- sale void: append-only. A supplier payment is created, or voided with a reason, never edited
-- (the API refuses edits), so UPDATE stays allowed for the void.
SELECT install_row_guards('sale_return', true);
SELECT install_row_guards('supplier_payment', false);
