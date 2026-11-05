-- ADR 0012. The stock moves from rolls to product batches. This file only READS the old tables
-- (fabric, variant, roll, stock_move, purchase): they stay as they are, as history. It runs in
-- one transaction and ends with a reconciliation that aborts it if anything is off.
--
-- The mapping is the one tested in packages/contracts (legacyRollAsProductBatch); the API test
-- test/product-stock-backfill.e2e-spec.ts re-runs the statements between the markers on seeded
-- legacy data and checks every roll's ledger against its batch's.

SELECT install_row_guards('product_batch', false);--> statement-breakpoint
SELECT install_row_guards('product_stock_move', true);--> statement-breakpoint

-- backfill:start

-- A colour made after the Product migration (0026) gets its Product now, as the migration would.
INSERT INTO "product" (
	"id", "created_at", "updated_at", "device_id", "name", "description", "tags",
	"purchase_units", "selling_units", "kg_to_meter_weight_g", "kg_to_meter_length_cm",
	"kg_to_meter_source", "active"
)
SELECT
	v."id", v."created_at", v."updated_at", v."device_id",
	f."name" || ' - ' || v."color_name", f."notes", f."tags",
	COALESCE((
		SELECT array_agg(units.unit ORDER BY units.unit)
		FROM (
			SELECT DISTINCT p."method"::text::"product_unit" AS unit
			FROM "roll" r
			INNER JOIN "purchase" p ON p."id" = r."purchase_id"
			WHERE r."variant_id" = v."id"
		) units
	), ARRAY[]::"product_unit"[]),
	CASE
		WHEN f."sellable_as_piece" THEN ARRAY['meter', 'piece']::"product_unit"[]
		ELSE ARRAY['meter']::"product_unit"[]
	END,
	CASE WHEN f."est_cm_per_kg" IS NULL THEN NULL ELSE 1000 END,
	f."est_cm_per_kg",
	CASE WHEN f."est_cm_per_kg" IS NULL THEN NULL ELSE 'estimated'::"product_conversion_source" END,
	(v."voided_at" IS NULL AND f."voided_at" IS NULL)
FROM "variant" v
INNER JOIN "fabric" f ON f."id" = v."fabric_id"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- What a product sells for, and when it runs low: the fabric's prices and the colour's threshold
-- (the minimum was only a warning on the fabric; it is a floor on the product, ADR 0012).
UPDATE "product" p SET
	"price_per_m_cents" = f."ref_price_per_m_cents",
	"min_price_per_m_cents" = f."min_price_per_m_cents",
	"price_per_piece_cents" = CASE WHEN f."sellable_as_piece" THEN f."piece_price_cents" END,
	"min_price_per_piece_cents" = CASE WHEN f."sellable_as_piece" THEN 0 END,
	"low_stock_threshold" = v."low_stock_threshold_cm",
	"updated_at" = now(),
	"device_id" = 'server'
FROM "variant" v
INNER JOIN "fabric" f ON f."id" = v."fabric_id"
WHERE p."id" = v."id" AND p."price_per_m_cents" IS NULL;--> statement-breakpoint

-- A picture belongs to the product, which is the colour it was made for.
UPDATE "photo" SET "product_id" = "variant_id" WHERE "product_id" IS NULL AND "variant_id" IS NOT NULL;--> statement-breakpoint

-- One batch per roll, with the roll's id. Bought by weight (the purchase kept the weight): a kg
-- batch of that weight, converting at the roll's length, estimated until measured. Otherwise a
-- meter batch of the roll's length (a ready piece stays cut by the metre, PB6).
INSERT INTO "product_batch" (
	"id", "created_at", "updated_at", "device_id", "voided_at", "code", "product_id",
	"purchase_id", "purchase_date", "unit", "received_quantity", "cost_total_cents",
	"conversion_weight_g", "conversion_length_cm", "conversion_source", "status"
)
SELECT
	r."id", r."created_at", r."updated_at", r."device_id", r."voided_at", r."short_code",
	r."variant_id", r."purchase_id", p."date",
	CASE WHEN p."method" = 'kg' AND p."weight_g" IS NOT NULL THEN 'kg' ELSE 'meter' END::"product_unit",
	CASE WHEN p."method" = 'kg' AND p."weight_g" IS NOT NULL THEN p."weight_g" ELSE r."length_cm_initial" END,
	r."cost_total_cents",
	CASE WHEN p."method" = 'kg' AND p."weight_g" IS NOT NULL THEN p."weight_g" END,
	CASE WHEN p."method" = 'kg' AND p."weight_g" IS NOT NULL THEN r."length_cm_initial" END,
	CASE WHEN p."method" = 'kg' AND p."weight_g" IS NOT NULL
		THEN (CASE WHEN r."length_estimated" THEN 'estimated' ELSE 'measured' END)::"product_conversion_source"
	END,
	r."status"::text::"batch_status"
FROM "roll" r
INNER JOIN "purchase" p ON p."id" = r."purchase_id"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- Every move, with its id. The receipt is the batch's received quantity in its own unit; on a kg
-- batch a legacy measurement (length_correction) becomes a measurement of the roll's whole length
-- after it; everything else is the same signed length in meters.
INSERT INTO "product_stock_move" (
	"id", "created_at", "updated_at", "device_id", "voided_at", "batch_id", "type", "unit",
	"delta", "ref_id", "date", "note", "actor"
)
SELECT
	m."id", m."created_at", m."updated_at", m."device_id", m."voided_at", m."roll_id",
	(CASE WHEN m."type" = 'length_correction' AND b."unit" = 'kg' THEN 'measurement' ELSE m."type"::text END)::"product_stock_move_type",
	(CASE WHEN m."type" = 'purchase' AND b."unit" = 'kg' THEN 'kg' ELSE 'meter' END)::"product_unit",
	CASE
		WHEN m."type" = 'purchase' THEN b."received_quantity"
		WHEN m."type" = 'length_correction' AND b."unit" = 'kg' THEN
			r."length_cm_initial" + SUM(CASE WHEN m."type" = 'length_correction' THEN m."delta_cm" ELSE 0 END)
				OVER (PARTITION BY m."roll_id" ORDER BY m."server_seq", m."created_at", m."id")
		ELSE m."delta_cm"
	END,
	m."ref_id", m."date", m."note", NULL
FROM "stock_move" m
INNER JOIN "roll" r ON r."id" = m."roll_id"
INNER JOIN "product_batch" b ON b."id" = m."roll_id"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- A roll that somehow has no purchase move still gets its receipt, so its ledger can be read.
INSERT INTO "product_stock_move" (
	"id", "created_at", "updated_at", "device_id", "batch_id", "type", "unit", "delta", "ref_id", "date"
)
SELECT gen_random_uuid(), b."created_at", b."updated_at", b."device_id", b."id", 'purchase', b."unit",
	b."received_quantity", b."purchase_id", b."purchase_date"
FROM "product_batch" b
WHERE NOT EXISTS (
	SELECT 1 FROM "product_stock_move" m WHERE m."batch_id" = b."id" AND m."type" = 'purchase'
);--> statement-breakpoint

-- backfill:end

-- Reconciliation: nothing may be lost or changed on the way. A mismatch aborts the migration.
DO $$
DECLARE
	rolls bigint; batches bigint; moves bigint; copied bigint;
	roll_cost numeric; batch_cost numeric; unmapped bigint;
BEGIN
	SELECT count(*), COALESCE(sum("cost_total_cents"), 0) INTO rolls, roll_cost FROM "roll";
	SELECT count(*), COALESCE(sum(b."cost_total_cents"), 0) INTO batches, batch_cost
		FROM "product_batch" b WHERE EXISTS (SELECT 1 FROM "roll" r WHERE r."id" = b."id");
	IF rolls <> batches OR roll_cost <> batch_cost THEN
		RAISE EXCEPTION 'stock backfill: % rolls (cost %) became % batches (cost %)',
			rolls, roll_cost, batches, batch_cost;
	END IF;

	SELECT count(*) INTO moves FROM "stock_move";
	SELECT count(*) INTO copied FROM "product_stock_move" m
		WHERE EXISTS (SELECT 1 FROM "stock_move" s WHERE s."id" = m."id");
	IF moves <> copied THEN
		RAISE EXCEPTION 'stock backfill: % stock moves became % product stock moves', moves, copied;
	END IF;

	SELECT count(*) INTO unmapped FROM "variant" v
		WHERE NOT EXISTS (SELECT 1 FROM "product" p WHERE p."id" = v."id");
	IF unmapped > 0 THEN
		RAISE EXCEPTION 'stock backfill: % colours have no product', unmapped;
	END IF;
END
$$;
