CREATE TABLE "inbound_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"is_test" boolean NOT NULL,
	"count" integer NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"first_entry" integer NOT NULL,
	"last_entry" integer NOT NULL,
	"fec_name" text NOT NULL,
	"fec" text NOT NULL,
	"csv_name" text NOT NULL,
	"csv" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "parsed_json" jsonb;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "triage_json" jsonb;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "triaged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "supplier_key" text;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "supplier_name" text;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "issue_date" date;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "amount" bigint;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "ibans_json" jsonb;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "export_id" uuid;--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_exports" ADD CONSTRAINT "inbound_exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_exports_tenant" ON "inbound_exports" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD CONSTRAINT "inbound_queue_export_id_inbound_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."inbound_exports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_queue_supplier" ON "inbound_queue" USING btree ("tenant_id","supplier_key");--> statement-breakpoint
-- inbound_queue.status is written only by applyInboundTransition (src/transition.ts), like invoices.status.
CREATE FUNCTION fi_guard_inbound_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('fi.status_write', true), '') <> 'on' AND (
    (TG_OP = 'INSERT' AND NEW.status <> 'new') OR
    (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status)
  ) THEN
    RAISE EXCEPTION 'inbound_queue.status changes only through applyInboundTransition' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inbound_queue_status_guard BEFORE INSERT OR UPDATE OF status ON inbound_queue
  FOR EACH ROW EXECUTE FUNCTION fi_guard_inbound_status();
