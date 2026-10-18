CREATE TABLE "invoice_archive" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"invoice_id" uuid,
	"inbound_id" uuid,
	"number" text,
	"issue_date" date,
	"xml" text NOT NULL,
	"xml_sha256" text NOT NULL,
	"pdf_base64" text,
	"pdf_sha256" text,
	"chain" text NOT NULL,
	"archived_at" timestamp with time zone NOT NULL,
	"keep_until" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'customer' NOT NULL,
	"legal_name" text NOT NULL,
	"siren" text NOT NULL,
	"vat_id" text,
	"address_json" jsonb,
	"email" text,
	"names_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pdp_routing_json" jsonb,
	"autopilot" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'sirene' NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "autopilot_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "autopilot_fingerprint" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "autopilot_held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "pdp_key_sealed" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "pdp_key_hint" text;--> statement-breakpoint
ALTER TABLE "invoice_archive" ADD CONSTRAINT "invoice_archive_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_archive" ADD CONSTRAINT "invoice_archive_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_archive" ADD CONSTRAINT "invoice_archive_inbound_id_inbound_queue_id_fk" FOREIGN KEY ("inbound_id") REFERENCES "public"."inbound_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_archive_invoice" ON "invoice_archive" USING btree ("invoice_id") WHERE "invoice_archive"."invoice_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_archive_inbound" ON "invoice_archive" USING btree ("inbound_id") WHERE "invoice_archive"."inbound_id" is not null;--> statement-breakpoint
CREATE INDEX "invoice_archive_tenant" ON "invoice_archive" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_siren" ON "parties" USING btree ("tenant_id","kind","siren");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_autopilot" ON "invoices" USING btree ("autopilot_at") WHERE "invoices"."autopilot_at" is not null;--> statement-breakpoint
-- The archive is written once (plan §10): no change ever, no deletion before its ten years are up.
CREATE FUNCTION fi_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.keep_until < current_date THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'invoice_archive is kept unchanged until keep_until' USING ERRCODE = 'P0001';
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_archive_guard BEFORE UPDATE OR DELETE ON invoice_archive
  FOR EACH ROW EXECUTE FUNCTION fi_archive_guard();
--> statement-breakpoint
CREATE TRIGGER invoice_archive_no_truncate BEFORE TRUNCATE ON invoice_archive
  FOR EACH STATEMENT EXECUTE FUNCTION fi_archive_guard();
