-- Row guards for this slice's table (see 0001_row_guards.sql). A photo is created once and only
-- voided when the colour gets another (the API refuses an edit), so UPDATE stays allowed.
SELECT install_row_guards('photo', false);
