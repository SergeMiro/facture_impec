CREATE TABLE "check_state" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"checked_on" date NOT NULL,
	"mark" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"message" text NOT NULL,
	"severity" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"invoice_id" uuid,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"amount" bigint,
	"params_json" jsonb NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"is_test" boolean NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_doc_id" uuid NOT NULL,
	"to_doc_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "prepaid" bigint;--> statement-breakpoint
ALTER TABLE "check_state" ADD CONSTRAINT "check_state_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_from_doc_id_docs_id_fk" FOREIGN KEY ("from_doc_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_to_doc_id_docs_id_fk" FOREIGN KEY ("to_doc_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "findings_key" ON "findings" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "findings_open" ON "findings" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "findings_invoice" ON "findings" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "links_pair" ON "links" USING btree ("from_doc_id","to_doc_id","kind");--> statement-breakpoint
CREATE INDEX "links_tenant" ON "links" USING btree ("tenant_id","status");