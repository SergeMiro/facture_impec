CREATE TABLE "connected_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"drive_id" text NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"problem" text,
	"behind" boolean DEFAULT false NOT NULL,
	"picked_by" text NOT NULL,
	"picked_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folder_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"content_tag" text,
	"document_id" uuid,
	"skipped" text,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connected_folders" ADD CONSTRAINT "connected_folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_folders" ADD CONSTRAINT "connected_folders_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_items" ADD CONSTRAINT "folder_items_folder_id_connected_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."connected_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_items" ADD CONSTRAINT "folder_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connected_folders_item" ON "connected_folders" USING btree ("tenant_id","drive_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folder_items_item" ON "folder_items" USING btree ("folder_id","item_id");