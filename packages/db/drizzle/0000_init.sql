CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"before_hash" text,
	"after_hash" text
);
--> statement-breakpoint
CREATE TABLE "invoice_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"event" text,
	"from_status" text,
	"to_status" text,
	"pdp_event_id" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" text DEFAULT 'out' NOT NULL,
	"number" text,
	"issue_date" date,
	"due_date" date,
	"currency" text,
	"buyer_name" text,
	"payable" bigint,
	"draft_json" jsonb NOT NULL,
	"document_json" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pdp_ref" text,
	"pdp_status_raw" text,
	"xml_cii" text,
	"source" text DEFAULT 'api' NOT NULL,
	"excel_binding_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdp_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider" text NOT NULL,
	"pdp_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pdp_submissions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"siren" text NOT NULL,
	"vat_id" text,
	"address_json" jsonb,
	"pdp_provider" text NOT NULL,
	"pdp_account" text NOT NULL,
	"mode" text DEFAULT 'review' NOT NULL,
	"autopilot_max_amount" bigint,
	"sandbox_enabled" boolean DEFAULT true NOT NULL,
	"pseudonymize_llm" boolean DEFAULT true NOT NULL,
	"vat_on_debits" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"severity_max" text NOT NULL,
	"issues_json" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdp_submissions" ADD CONSTRAINT "pdp_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdp_submissions" ADD CONSTRAINT "pdp_submissions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_tenant" ON "audit_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "invoice_events_invoice" ON "invoice_events" USING btree ("invoice_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_events_pdp_event" ON "invoice_events" USING btree ("invoice_id","pdp_event_id") WHERE "invoice_events"."pdp_event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices" USING btree ("tenant_id","is_test","number") WHERE "invoices"."direction" = 'out' and "invoices"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "invoices_tenant_status" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "invoices_pdp_ref" ON "invoices" USING btree ("pdp_ref");--> statement-breakpoint
CREATE INDEX "validation_results_invoice" ON "validation_results" USING btree ("invoice_id","run_at");