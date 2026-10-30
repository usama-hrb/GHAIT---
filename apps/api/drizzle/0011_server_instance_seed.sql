-- Row guards for server_instance (see 0001_row_guards.sql): append-only. Its first row is the
-- data set's first epoch; restoring a backup or an export adds a new one (ADR 0002, slice 6).
SELECT install_row_guards('server_instance', true);
--> statement-breakpoint
INSERT INTO server_instance (device_id) VALUES ('server');
