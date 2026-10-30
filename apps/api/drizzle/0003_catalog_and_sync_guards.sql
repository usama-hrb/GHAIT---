-- Row guards for this slice's tables (see 0001_row_guards.sql).
SELECT install_row_guards('supplier', false);
--> statement-breakpoint
SELECT install_row_guards('fabric', false);
--> statement-breakpoint
SELECT install_row_guards('variant', false);
--> statement-breakpoint
SELECT install_row_guards('sync_op', true);
--> statement-breakpoint
SELECT install_row_guards('sync_conflict', true);
