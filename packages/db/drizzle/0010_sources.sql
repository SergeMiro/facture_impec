CREATE TABLE "layout_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"layout_json" jsonb NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text DEFAULT 'sheet' NOT NULL,
	"workbook_id" text NOT NULL,
	"sheet" text NOT NULL,
	"profile_id" uuid,
	"kind" text NOT NULL,
	"layout_json" jsonb NOT NULL,
	"fingerprint" text,
	"consented_at" timestamp with time zone NOT NULL,
	"consented_by" text NOT NULL,
	"etag" text,
	"read_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	"stats_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "kind" text DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "order_ref" text;--> statement-breakpoint
ALTER TABLE "layout_profiles" ADD CONSTRAINT "layout_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_profile_id_layout_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."layout_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "layout_profiles_fingerprint" ON "layout_profiles" USING btree ("tenant_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_sheet" ON "sources" USING btree ("tenant_id","workbook_id","sheet");--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "docs_source" ON "docs" USING btree ("source_id","source_key");