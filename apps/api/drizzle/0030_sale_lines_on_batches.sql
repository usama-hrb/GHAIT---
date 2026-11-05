-- ADR 0012. Sales are priced and costed on product batches. A sale line gets its batch, unit,
-- quantity and prices; a locked cost points at the batch move. The roll columns stay as history.
--
-- One risky step: sale_line is append-only, so the backfill below switches its update guard off
-- for that one statement, inside this migration's transaction (a failure rolls the whole thing
-- back, guard included). It only copies a line's own facts into the new columns (the roll's id is
-- the batch's id, ADR 0012); the reconciliation after it aborts the migration if anything differs.
-- test/sale-lines-backfill.e2e-spec.ts re-runs the statements between the markers on seeded
-- legacy data.

CREATE TYPE "public"."sale_unit" AS ENUM('meter', 'piece');--> statement-breakpoint
ALTER TABLE "sale_line" DROP CONSTRAINT "sale_line_values_valid";--> statement-breakpoint
ALTER TABLE "locked_cost" DROP CONSTRAINT "locked_cost_stock_move_id_stock_move_id_fk";
--> statement-breakpoint
DROP INDEX "sale_line_roll_idx";--> statement-breakpoint
ALTER TABLE "sale_line" ALTER COLUMN "roll_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ALTER COLUMN "sold_cm" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ALTER COLUMN "ref_price_per_m_cents" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ALTER COLUMN "min_price_per_m_cents" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ALTER COLUMN "actual_price_per_m_cents" DROP NOT NULL;--> statement-breakpoint
-- Nullable until the backfill has filled them; made NOT NULL right after it.
ALTER TABLE "sale_line" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_line" ADD COLUMN "unit" "sale_unit";--> statement-breakpoint
ALTER TABLE "sale_line" ADD COLUMN "quantity" integer;--> statement-breakpoint
ALTER TABLE "sale_line" ADD COLUMN "ref_price_cents" bigint;--> statement-breakpoint
ALTER TABLE "sale_line" ADD COLUMN "min_price_cents" bigint;--> statement-breakpoint
ALTER TABLE "sale_line" ADD COLUMN "actual_price_cents" bigint;--> statement-breakpoint
ALTER TABLE "sale_line" ADD COLUMN "min_override_by" text;--> statement-breakpoint

-- backfill:start

ALTER TABLE "sale_line" DISABLE TRIGGER "row_guard_append_only";--> statement-breakpoint
-- A line sold before batches was cut by the meter from a roll; its roll is its batch.
UPDATE "sale_line" SET
	"batch_id" = "roll_id",
	"unit" = 'meter',
	"quantity" = "sold_cm",
	"ref_price_cents" = "ref_price_per_m_cents",
	"min_price_cents" = "min_price_per_m_cents",
	"actual_price_cents" = "actual_price_per_m_cents"
WHERE "batch_id" IS NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ENABLE TRIGGER "row_guard_append_only";--> statement-breakpoint

-- backfill:end

-- Reconciliation: every line has its batch and the same facts; every frozen cost has its move.
DO $$
DECLARE
	unfilled bigint; changed bigint; orphans bigint; guard char;
BEGIN
	SELECT count(*) INTO unfilled FROM "sale_line"
		WHERE "batch_id" IS NULL OR "unit" IS NULL OR "quantity" IS NULL
			OR "ref_price_cents" IS NULL OR "min_price_cents" IS NULL OR "actual_price_cents" IS NULL;
	IF unfilled > 0 THEN
		RAISE EXCEPTION 'sale lines backfill: % lines were not filled', unfilled;
	END IF;

	SELECT count(*) INTO changed FROM "sale_line"
		WHERE "roll_id" IS NOT NULL AND (
			"batch_id" <> "roll_id" OR "unit" <> 'meter' OR "quantity" <> "sold_cm"
			OR "ref_price_cents" <> "ref_price_per_m_cents"
			OR "min_price_cents" <> "min_price_per_m_cents"
			OR "actual_price_cents" <> "actual_price_per_m_cents");
	IF changed > 0 THEN
		RAISE EXCEPTION 'sale lines backfill: % lines differ from their roll columns', changed;
	END IF;

	SELECT count(*) INTO orphans FROM "sale_line" l
		WHERE NOT EXISTS (SELECT 1 FROM "product_batch" b WHERE b."id" = l."batch_id");
	IF orphans > 0 THEN
		RAISE EXCEPTION 'sale lines backfill: % lines have no batch', orphans;
	END IF;

	SELECT count(*) INTO orphans FROM "locked_cost" c
		WHERE NOT EXISTS (SELECT 1 FROM "product_stock_move" m WHERE m."id" = c."stock_move_id");
	IF orphans > 0 THEN
		RAISE EXCEPTION 'sale lines backfill: % frozen costs have no stock move', orphans;
	END IF;

	-- The append-only guard must be back on (it was switched off for the backfill).
	SELECT t.tgenabled INTO guard FROM pg_trigger t
		WHERE t.tgrelid = 'sale_line'::regclass AND t.tgname = 'row_guard_append_only';
	IF guard IS DISTINCT FROM 'O' THEN
		RAISE EXCEPTION 'sale lines backfill: the append-only guard of sale_line is not enabled';
	END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "sale_line" ALTER COLUMN "batch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ALTER COLUMN "unit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ALTER COLUMN "quantity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ALTER COLUMN "ref_price_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ALTER COLUMN "min_price_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ALTER COLUMN "actual_price_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_batch_id_product_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."product_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locked_cost" ADD CONSTRAINT "locked_cost_stock_move_id_product_stock_move_id_fk" FOREIGN KEY ("stock_move_id") REFERENCES "public"."product_stock_move"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_line_batch_idx" ON "sale_line" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_override_named" CHECK ("sale_line"."min_override_by" IS NULL OR length(btrim("sale_line"."min_override_by")) > 0);--> statement-breakpoint
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_values_valid" CHECK ("sale_line"."quantity" > 0 AND "sale_line"."line_total_cents" >= 0);
