CREATE TABLE "chats" (
	"finding_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"messages_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"finding_id" uuid,
	"by" text NOT NULL,
	"tool_call_id" text,
	"workbook_id" text,
	"sheet" text NOT NULL,
	"cell" text NOT NULL,
	"field" text NOT NULL,
	"before_value" text NOT NULL,
	"before_formula" text,
	"after_value" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"found_value" text,
	"reason" text,
	"applied_at" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "fix_json" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "edit_lock_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edits" ADD CONSTRAINT "edits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edits" ADD CONSTRAINT "edits_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edits" ADD CONSTRAINT "edits_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_tenant" ON "chats" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "edits_invoice" ON "edits" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "edits_tenant" ON "edits" USING btree ("tenant_id");