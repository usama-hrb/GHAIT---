-- Row guards (CLAUDE.md "Data rules"), installed on every table by install_row_guards():
--   set_server_seq   every insert and update takes the next server_seq (sync cursor, ADR 0002);
--                    a client cannot choose it
--   reject_delete    no hard delete anywhere: any DELETE or TRUNCATE statement, even one that
--                    matches no row, is refused; void the row instead
--   reject_update    append-only tables (audit_log now; stock_move and payment later)
-- A new table calls SELECT install_row_guards('<table>', <append_only>) in its own migration.
-- test/database.e2e-spec.ts fails for any table without them.

CREATE FUNCTION set_server_seq() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.server_seq := nextval('server_seq');
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is never deleted: set voided_at instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
CREATE FUNCTION reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: write a compensating row instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
CREATE FUNCTION install_row_guards(target regclass, append_only boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER row_guard_no_delete BEFORE DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION reject_delete()',
    target);
  EXECUTE format(
    'CREATE TRIGGER row_guard_no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION reject_delete()',
    target);
  IF append_only THEN
    EXECUTE format(
      'CREATE TRIGGER row_guard_server_seq BEFORE INSERT ON %s FOR EACH ROW EXECUTE FUNCTION set_server_seq()',
      target);
    EXECUTE format(
      'CREATE TRIGGER row_guard_append_only BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION reject_update()',
      target);
  ELSE
    EXECUTE format(
      'CREATE TRIGGER row_guard_server_seq BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_server_seq()',
      target);
  END IF;
END
$$;
--> statement-breakpoint
SELECT install_row_guards('app_user', false);
--> statement-breakpoint
SELECT install_row_guards('auth_session', false);
--> statement-breakpoint
SELECT install_row_guards('setting', false);
--> statement-breakpoint
SELECT install_row_guards('audit_log', true);
