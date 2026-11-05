CREATE TYPE "public"."product_conversion_source" AS ENUM('estimated', 'measured');--> statement-breakpoint
CREATE TYPE "public"."product_unit" AS ENUM('kg', 'meter', 'piece');--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"purchase_units" "product_unit"[] DEFAULT '{}'::product_unit[] NOT NULL,
	"selling_units" "product_unit"[] NOT NULL,
	"kg_to_meter_weight_g" integer,
	"kg_to_meter_length_cm" integer,
	"kg_to_meter_source" "product_conversion_source",
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "product_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "product_name_valid" CHECK (length(trim("product"."name")) > 0),
	CONSTRAINT "product_units_valid" CHECK (cardinality("product"."selling_units") > 0),
	CONSTRAINT "product_conversion_valid" CHECK (("product"."kg_to_meter_weight_g" IS NULL AND "product"."kg_to_meter_length_cm" IS NULL AND "product"."kg_to_meter_source" IS NULL)
        OR ("product"."kg_to_meter_weight_g" > 0 AND "product"."kg_to_meter_length_cm" > 0 AND "product"."kg_to_meter_source" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "product_name_idx" ON "product" USING btree ("name");--> statement-breakpoint
INSERT INTO "product" (
	"id",
	"created_at",
	"updated_at",
	"device_id",
	"name",
	"description",
	"tags",
	"purchase_units",
	"selling_units",
	"kg_to_meter_weight_g",
	"kg_to_meter_length_cm",
	"kg_to_meter_source",
	"active"
)
SELECT
	v."id",
	v."created_at",
	v."updated_at",
	v."device_id",
	f."name" || ' - ' || v."color_name",
	f."notes",
	f."tags",
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
SELECT install_row_guards('product', false);