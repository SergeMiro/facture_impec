CREATE TABLE "inbound_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"pdp_ref" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"xml" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_queue" ADD CONSTRAINT "inbound_queue_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_queue_pdp_ref" ON "inbound_queue" USING btree ("tenant_id","provider","pdp_ref");--> statement-breakpoint
CREATE INDEX "inbound_queue_tenant" ON "inbound_queue" USING btree ("tenant_id","received_at");