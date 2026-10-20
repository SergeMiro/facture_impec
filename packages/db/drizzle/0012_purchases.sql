ALTER TABLE "parties" ALTER COLUMN "verified_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "min_margin_percent" integer;