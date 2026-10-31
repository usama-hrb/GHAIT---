-- Row guards for this slice's table (see 0001_row_guards.sql). A cash count is voided, never
-- edited (the API refuses edits), so UPDATE stays allowed for the void.
SELECT install_row_guards('cash_adjustment', false);
