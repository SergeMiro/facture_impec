CREATE TABLE "connected_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"drive_id" text NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"content_tag" text,
	"size" integer,
	"sheets_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"problem" text,
	"picked_by" text NOT NULL,
	"picked_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone,
	"changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_id" text NOT NULL,
	"label" text NOT NULL,
	"account_kind" text NOT NULL,
	"directory" text NOT NULL,
	"drive_url" text,
	"refresh_token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"subscription_id" text,
	"subscription_expires_at" timestamp with time zone,
	"client_state_hash" text,
	"connected_by" text NOT NULL,
	"connected_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone,
	"wait_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "connected_files" ADD CONSTRAINT "connected_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_files" ADD CONSTRAINT "connected_files_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connected_files_item" ON "connected_files" USING btree ("tenant_id","drive_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_provider" ON "connections" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE INDEX "connections_subscription" ON "connections" USING btree ("subscription_id");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_file_id_connected_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."connected_files"("id") ON DELETE cascade ON UPDATE no action;