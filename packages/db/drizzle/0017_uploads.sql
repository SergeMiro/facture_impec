CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" text,
	"sheets_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parsed_json" jsonb,
	"supplier_key" text,
	"number" text,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_name" ON "uploads" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "docs_upload" ON "docs" USING btree ("upload_id");