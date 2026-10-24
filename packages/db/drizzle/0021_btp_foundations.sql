CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"key" text NOT NULL,
	"obligation_id" uuid,
	"document_id" uuid,
	"party_id" uuid,
	"payload_json" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"snooze_until" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"channel" text,
	"comment" text,
	"sent_at" timestamp with time zone,
	"error" text,
	"is_test" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actions_kind" CHECK ("actions"."kind" in ('relance_facture', 'relance_situation', 'demande_attestation_vigilance', 'demande_kbis', 'demande_attestation_assurance', 'demande_liberation_retenue', 'confirmer_tiers')),
	CONSTRAINT "actions_status" CHECK ("actions"."status" in ('draft', 'snoozed', 'approved', 'rejected', 'sent', 'failed')),
	CONSTRAINT "actions_channel" CHECK ("actions"."channel" in ('excel', 'email', 'telegram', 'whatsapp'))
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chantiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"erp_ref" text,
	"customer_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"address_json" jsonb,
	"reception_on" date,
	"reserves_lifted_on" date,
	"retenue_bps" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chantiers_status" CHECK ("chantiers"."status" in ('open', 'closed')),
	CONSTRAINT "chantiers_retenue" CHECK ("chantiers"."retenue_bps" between 0 and 500)
);
--> statement-breakpoint
CREATE TABLE "connector_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connector" text NOT NULL,
	"cursor_json" jsonb,
	"last_run_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text,
	"stage" text DEFAULT 'ingested' NOT NULL,
	"review_reason" text,
	"party_id" uuid,
	"chantier_id" uuid,
	"hints_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extracted_json" jsonb,
	"validation_json" jsonb,
	"is_test" boolean NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_source" CHECK ("documents"."source" in ('mail', 'drive', 'pdp', 'excel', 'erp')),
	CONSTRAINT "documents_kind" CHECK ("documents"."kind" in ('facture_achat', 'facture_vente', 'situation', 'avoir', 'devis', 'contrat_sous_traitance', 'contrat_travail', 'attestation_vigilance', 'kbis', 'attestation_assurance_decennale', 'attestation_assurance_rc', 'liste_salaries_etrangers', 'pv_reception', 'dgd', 'autre')),
	CONSTRAINT "documents_stage" CHECK ("documents"."stage" in ('ingested', 'classified', 'extracted', 'validated', 'linked', 'done', 'needs_review'))
);
--> statement-breakpoint
CREATE TABLE "obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_on" date NOT NULL,
	"key" text NOT NULL,
	"party_id" uuid,
	"chantier_id" uuid,
	"source_document_id" uuid,
	"invoice_id" uuid,
	"amount" bigint,
	"last_reminded_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"is_test" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obligations_kind" CHECK ("obligations"."kind" in ('attestation_vigilance_renouvellement', 'kbis_renouvellement', 'assurance_expiration', 'facture_echeance', 'situation_echeance', 'retenue_garantie_liberation', 'tva_declaration', 'contrat_fin')),
	CONSTRAINT "obligations_status" CHECK ("obligations"."status" in ('open', 'done', 'dismissed')),
	CONSTRAINT "obligations_source" CHECK ("obligations"."source_document_id" is not null or "obligations"."invoice_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "subcontractor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "siret" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "erp_ref" text;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chantiers" ADD CONSTRAINT "chantiers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chantiers" ADD CONSTRAINT "chantiers_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_syncs" ADD CONSTRAINT "connector_syncs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_chantier_id_chantiers_id_fk" FOREIGN KEY ("chantier_id") REFERENCES "public"."chantiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_chantier_id_chantiers_id_fk" FOREIGN KEY ("chantier_id") REFERENCES "public"."chantiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "actions_key" ON "actions" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "actions_tenant" ON "actions" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "blobs_tenant" ON "blobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chantiers_erp_ref" ON "chantiers" USING btree ("tenant_id","erp_ref");--> statement-breakpoint
CREATE INDEX "chantiers_tenant" ON "chantiers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_syncs_connector" ON "connector_syncs" USING btree ("tenant_id","connector");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_sha256" ON "documents" USING btree ("tenant_id","is_test","sha256");--> statement-breakpoint
CREATE INDEX "documents_party" ON "documents" USING btree ("tenant_id","party_id","kind");--> statement-breakpoint
CREATE INDEX "documents_stage" ON "documents" USING btree ("tenant_id","stage","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "obligations_key" ON "obligations" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "obligations_tenant" ON "obligations" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE INDEX "obligations_due" ON "obligations" USING btree ("status","due_on");