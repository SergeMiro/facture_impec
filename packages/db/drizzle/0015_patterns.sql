CREATE TABLE "item_synonyms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"alias_id" uuid NOT NULL,
	"status" text NOT NULL,
	"score" integer NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"party" text,
	"party_name" text,
	"item_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"until" date,
	"finding_key" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "scope_json" jsonb;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "short" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "item_synonyms" ADD CONSTRAINT "item_synonyms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_synonyms" ADD CONSTRAINT "item_synonyms_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_synonyms" ADD CONSTRAINT "item_synonyms_alias_id_items_id_fk" FOREIGN KEY ("alias_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_exceptions" ADD CONSTRAINT "rule_exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_exceptions" ADD CONSTRAINT "rule_exceptions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_synonyms_pair" ON "item_synonyms" USING btree ("item_id","alias_id");--> statement-breakpoint
CREATE INDEX "item_synonyms_tenant" ON "item_synonyms" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "rule_exceptions_tenant" ON "rule_exceptions" USING btree ("tenant_id");