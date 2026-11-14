-- Control-database guards (ADR 0029). The control tables are not shop data: they are not synced, so
-- they have no server_seq or device_id and the shops' row guards do not apply. They follow the rest
-- of the data rules in their own way:
--   control_guard_no_delete / _no_truncate   nothing is deleted: a shop is closed and an address is
--                                            released, never removed
--   control_guard_append_only                 shop_event is never updated
--   control_guard_keep_columns                what identifies a row never changes: a shop keeps its
--                                            id, slug and database, an address keeps its shop
--   control_guard_shop_update                 a closed shop stays closed; updated_at is set here
-- A new control table calls SELECT install_control_guards('<table>', <append_only>) in its own
-- migration. test/control-database.e2e-spec.ts fails for any table without them.

CREATE FUNCTION control_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is never deleted: close the shop or release the address instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
CREATE FUNCTION control_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: write a new row instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
-- The columns to keep are the trigger's arguments. A name that is not a column of the table would
-- compare two missing values and guard nothing, so the test tries every column that is named.
CREATE FUNCTION control_keep_columns() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION '%.% never changes', TG_TABLE_NAME, col
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION control_shop_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'closed' AND NEW.state <> 'closed' THEN
    RAISE EXCEPTION 'a closed shop stays closed' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION install_control_guards(target regclass, append_only boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER control_guard_no_delete BEFORE DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION control_reject_delete()',
    target);
  EXECUTE format(
    'CREATE TRIGGER control_guard_no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION control_reject_delete()',
    target);
  IF append_only THEN
    EXECUTE format(
      'CREATE TRIGGER control_guard_append_only BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION control_reject_update()',
      target);
  END IF;
END
$$;
--> statement-breakpoint
SELECT install_control_guards('shop', false);
--> statement-breakpoint
SELECT install_control_guards('shop_host', false);
--> statement-breakpoint
SELECT install_control_guards('shop_setup_code', false);
--> statement-breakpoint
SELECT install_control_guards('shop_event', true);
--> statement-breakpoint
CREATE TRIGGER control_guard_keep_columns BEFORE UPDATE ON shop
  FOR EACH ROW EXECUTE FUNCTION control_keep_columns('id', 'slug', 'db_name', 'created_at');
--> statement-breakpoint
CREATE TRIGGER control_guard_shop_update BEFORE UPDATE ON shop
  FOR EACH ROW EXECUTE FUNCTION control_shop_update();
--> statement-breakpoint
CREATE TRIGGER control_guard_keep_columns BEFORE UPDATE ON shop_host
  FOR EACH ROW EXECUTE FUNCTION control_keep_columns('id', 'host', 'shop_id', 'created_at');
--> statement-breakpoint
CREATE TRIGGER control_guard_keep_columns BEFORE UPDATE ON shop_setup_code
  FOR EACH ROW EXECUTE FUNCTION control_keep_columns(
    'id', 'shop_id', 'code_hash', 'expires_at', 'created_at');
