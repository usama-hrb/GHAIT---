CREATE TABLE "locked_cost" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"settlement_id" uuid NOT NULL,
	"stock_move_id" uuid NOT NULL,
	"cost_cents" bigint NOT NULL,
	CONSTRAINT "locked_cost_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "locked_cost_not_negative" CHECK ("locked_cost"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "profit_split_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"effective_from" date NOT NULL,
	"owner_weight" integer NOT NULL,
	"partner_weight" integer NOT NULL,
	"shop_weight" integer NOT NULL,
	CONSTRAINT "profit_split_rule_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "profit_split_rule_weights_valid" CHECK ("profit_split_rule"."owner_weight" >= 0 AND "profit_split_rule"."partner_weight" >= 0 AND "profit_split_rule"."shop_weight" >= 0 AND "profit_split_rule"."owner_weight" + "profit_split_rule"."partner_weight" + "profit_split_rule"."shop_weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"recognized_profit_cents" bigint NOT NULL,
	"recovered_bad_debt_cents" bigint NOT NULL,
	"damage_cents" bigint NOT NULL,
	"bad_debt_cents" bigint NOT NULL,
	"below_cost_cents" bigint NOT NULL,
	"expenses_cents" bigint NOT NULL,
	"cash_over_short_cents" bigint NOT NULL,
	"carried_deficit_in_cents" bigint NOT NULL,
	"net_profit_cents" bigint NOT NULL,
	"owner_share_cents" bigint NOT NULL,
	"partner_share_cents" bigint NOT NULL,
	"shop_share_cents" bigint NOT NULL,
	"carry_deficit_out_cents" bigint NOT NULL,
	"owner_weight" integer NOT NULL,
	"partner_weight" integer NOT NULL,
	"shop_weight" integer NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "settlement_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "settlement_period_valid" CHECK ("settlement"."period_end" >= "settlement"."period_start")
);
--> statement-breakpoint
CREATE TABLE "settlement_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	"settlement_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "settlement_share_server_seq_key" UNIQUE("server_seq"),
	CONSTRAINT "settlement_share_amount_positive" CHECK ("settlement_share"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "capital_move" ADD COLUMN "settlement_id" uuid;--> statement-breakpoint
ALTER TABLE "locked_cost" ADD CONSTRAINT "locked_cost_settlement_id_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locked_cost" ADD CONSTRAINT "locked_cost_stock_move_id_stock_move_id_fk" FOREIGN KEY ("stock_move_id") REFERENCES "public"."stock_move"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_share" ADD CONSTRAINT "settlement_share_settlement_id_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_share" ADD CONSTRAINT "settlement_share_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "locked_cost_settlement_idx" ON "locked_cost" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locked_cost_live_move_key" ON "locked_cost" USING btree ("stock_move_id") WHERE "locked_cost"."voided_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "profit_split_rule_live_date_key" ON "profit_split_rule" USING btree ("effective_from") WHERE "profit_split_rule"."voided_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_live_period_end_key" ON "settlement" USING btree ("period_end") WHERE "settlement"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "settlement_share_settlement_idx" ON "settlement_share" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "settlement_share_partner_idx" ON "settlement_share" USING btree ("partner_id");--> statement-breakpoint
ALTER TABLE "capital_move" ADD CONSTRAINT "capital_move_settlement_id_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capital_move_settlement_idx" ON "capital_move" USING btree ("settlement_id");--> statement-breakpoint
ALTER TABLE "capital_move" ADD CONSTRAINT "capital_move_retained_from_settlement" CHECK (("capital_move"."type" = 'retained_profit') = ("capital_move"."settlement_id" IS NOT NULL));