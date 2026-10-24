CREATE TABLE "vat_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vat_id" text NOT NULL,
	"valid" boolean NOT NULL,
	"name" text,
	"address" text,
	"request_identifier" text,
	"checked_on" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vat_checks" ADD CONSTRAINT "vat_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vat_checks_day" ON "vat_checks" USING btree ("tenant_id","vat_id","checked_on");