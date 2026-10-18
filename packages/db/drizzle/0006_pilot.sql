CREATE TABLE "billing_usage" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"billable" boolean DEFAULT false NOT NULL,
	"reported_at" timestamp with time zone,
	"report_error" text
);
--> statement-breakpoint
CREATE TABLE "signup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"siren" text NOT NULL,
	"company_json" jsonb NOT NULL,
	"terms_version" text NOT NULL,
	"link_hash" text NOT NULL,
	"poll_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_requests_link_hash_unique" UNIQUE("link_hash"),
	CONSTRAINT "signup_requests_poll_hash_unique" UNIQUE("poll_hash")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "live_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "white_label_json" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_status" text DEFAULT 'trial' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_interval" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_usage" ADD CONSTRAINT "billing_usage_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage" ADD CONSTRAINT "billing_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_requests" ADD CONSTRAINT "signup_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_usage_month" ON "billing_usage" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE INDEX "signup_requests_email" ON "signup_requests" USING btree ("email","created_at");--> statement-breakpoint
-- Every company created before billing existed was set up by the operator: a pilot, never billed.
UPDATE "tenants" SET "billing_status" = 'pilot';
