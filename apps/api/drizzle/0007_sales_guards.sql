-- Row guards for this slice's tables (see 0001_row_guards.sql). A sale only ever changes to get
-- voidedAt (its sale_void); lines, payments, allocations and voids are append-only.
SELECT install_row_guards('customer', false);
--> statement-breakpoint
SELECT install_row_guards('sale', false);
--> statement-breakpoint
SELECT install_row_guards('sale_line', true);
--> statement-breakpoint
SELECT install_row_guards('payment', true);
--> statement-breakpoint
SELECT install_row_guards('payment_allocation', true);
--> statement-breakpoint
SELECT install_row_guards('sale_void', true);
