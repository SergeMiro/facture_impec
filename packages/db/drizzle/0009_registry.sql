CREATE TABLE "doc_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"doc_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"item_id" uuid,
	"line_id" text,
	"name" text,
	"seller_ref" text,
	"buyer_ref" text,
	"standard_id" text,
	"quantity" text,
	"unit_code" text,
	"net_price" text,
	"discount" bigint,
	"net_amount" bigint,
	"vat_category" text,
	"vat_rate" text,
	"order_line_ref" text,
	"cell" text
);
--> statement-breakpoint
CREATE TABLE "docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"invoice_id" uuid,
	"inbound_id" uuid,
	"is_test" boolean NOT NULL,
	"type_code" text,
	"number" text,
	"issue_date" date,
	"party_siren" text,
	"party_name" text,
	"currency" text,
	"net_total" bigint,
	"source_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doc_lines" ADD CONSTRAINT "doc_lines_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_lines" ADD CONSTRAINT "doc_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_lines" ADD CONSTRAINT "doc_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_inbound_id_inbound_queue_id_fk" FOREIGN KEY ("inbound_id") REFERENCES "public"."inbound_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_lines_doc" ON "doc_lines" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "doc_lines_item" ON "doc_lines" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "docs_invoice" ON "docs" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "docs_inbound" ON "docs" USING btree ("inbound_id");--> statement-breakpoint
CREATE INDEX "docs_tenant" ON "docs" USING btree ("tenant_id","direction","issue_date");--> statement-breakpoint
CREATE UNIQUE INDEX "items_key" ON "items" USING btree ("tenant_id","key");