ALTER TABLE "payment_reports" DROP CONSTRAINT "payment_reports_invoice_id_unique";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "amount_paid" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_reports_invoice" ON "payment_reports" USING btree ("invoice_id");--> statement-breakpoint
-- Invoices already paid were paid in full (« Encaissée » recorded the whole amount before 0020).
UPDATE "invoices" SET "amount_paid" = coalesce("payable", 0) WHERE "status" = 'paid';
