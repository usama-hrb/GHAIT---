-- Row guards for this slice's tables (see 0001_row_guards.sql). A split rule is edited while in
-- the future; a settlement and what it created are only voided, when the period is unlocked.
SELECT install_row_guards('profit_split_rule', false);
--> statement-breakpoint
SELECT install_row_guards('settlement', false);
--> statement-breakpoint
SELECT install_row_guards('settlement_share', false);
--> statement-breakpoint
SELECT install_row_guards('locked_cost', false);
