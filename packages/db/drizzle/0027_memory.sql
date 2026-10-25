CREATE TABLE "memory_links" (
	"tenant_id" uuid NOT NULL,
	"from_path" text NOT NULL,
	"kind" text NOT NULL,
	"to_path" text NOT NULL,
	"confidence" text NOT NULL,
	CONSTRAINT "memory_links_tenant_id_from_path_kind_to_path_pk" PRIMARY KEY("tenant_id","from_path","kind","to_path"),
	CONSTRAINT "memory_links_confidence" CHECK ("memory_links"."confidence" in ('exact', 'strong', 'inferred'))
);
--> statement-breakpoint
CREATE TABLE "memory_pages" (
	"tenant_id" uuid NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL,
	"section" text NOT NULL,
	"title" text NOT NULL,
	"keys" text[] NOT NULL,
	"facts_json" jsonb NOT NULL,
	"sources" text[] NOT NULL,
	"body" text NOT NULL,
	"folded" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('french'::regconfig, "folded")) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_pages_tenant_id_path_pk" PRIMARY KEY("tenant_id","path")
);
--> statement-breakpoint
CREATE TABLE "memory_raw" (
	"tenant_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"body" text NOT NULL,
	"folded" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('french'::regconfig, "folded")) STORED,
	CONSTRAINT "memory_raw_tenant_id_ref_pk" PRIMARY KEY("tenant_id","ref")
);
--> statement-breakpoint
CREATE TABLE "memory_recalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"intent" text NOT NULL,
	"status" text NOT NULL,
	"level" integer NOT NULL,
	"ms" integer NOT NULL,
	"searched_json" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_links" ADD CONSTRAINT "memory_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_pages" ADD CONSTRAINT "memory_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_raw" ADD CONSTRAINT "memory_raw_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_recalls" ADD CONSTRAINT "memory_recalls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_links_to" ON "memory_links" USING btree ("tenant_id","to_path");--> statement-breakpoint
CREATE INDEX "memory_pages_keys" ON "memory_pages" USING gin ("keys");--> statement-breakpoint
CREATE INDEX "memory_pages_search" ON "memory_pages" USING gin ("search");--> statement-breakpoint
CREATE INDEX "memory_pages_type" ON "memory_pages" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "memory_raw_search" ON "memory_raw" USING gin ("search");--> statement-breakpoint
CREATE INDEX "memory_recalls_at" ON "memory_recalls" USING btree ("tenant_id","at");