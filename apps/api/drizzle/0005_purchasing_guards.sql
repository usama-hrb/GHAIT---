-- Row guards for this slice's tables (see 0001_row_guards.sql). stock_move is append-only.
SELECT install_row_guards('device', false);
--> statement-breakpoint
SELECT install_row_guards('purchase', false);
--> statement-breakpoint
SELECT install_row_guards('roll', false);
--> statement-breakpoint
SELECT install_row_guards('stock_move', true);
