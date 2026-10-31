-- Row guards for this slice's tables (see 0001_row_guards.sql). Both are edited (last write
-- wins) and voided, never deleted.
SELECT install_row_guards('recurring_expense', false);
--> statement-breakpoint
SELECT install_row_guards('expense', false);
