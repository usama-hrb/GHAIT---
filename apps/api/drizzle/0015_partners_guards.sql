-- Row guards for this slice's tables (see 0001_row_guards.sql). A partner is edited; capital
-- moves and draws are only ever voided after they are created (the API refuses edits).
SELECT install_row_guards('partner', false);
--> statement-breakpoint
SELECT install_row_guards('capital_move', false);
--> statement-breakpoint
SELECT install_row_guards('partner_draw', false);
