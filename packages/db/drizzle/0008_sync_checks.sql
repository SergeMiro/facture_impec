ALTER TABLE "invoices" ADD COLUMN "validated_key" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "requires_purchase_order" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "public_entity" boolean DEFAULT false NOT NULL;