-- The flag says « sous-traitance with this company », for a supplier and for a customer alike.
ALTER TABLE "parties" RENAME COLUMN "subcontractor" TO "subcontracting";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "btp" boolean DEFAULT false NOT NULL;
