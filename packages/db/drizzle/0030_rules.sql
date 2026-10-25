CREATE TABLE "memory_findings" (
	"tenant_id" uuid NOT NULL,
	"id" text NOT NULL,
	"code" text NOT NULL,
	"page" text NOT NULL,
	"detail" text NOT NULL,
	"fix" text NOT NULL,
	"link_json" jsonb,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"found_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "memory_findings_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "memory_findings_fix" CHECK ("memory_findings"."fix" in ('reindex', 'relink', 'drop_link', 'question')),
	CONSTRAINT "memory_findings_status" CHECK ("memory_findings"."status" in ('open', 'fixed', 'dismissed', 'gone'))
);
--> statement-breakpoint
CREATE TABLE "rule_hits" (
	"tenant_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"entity" text NOT NULL,
	"status" text NOT NULL,
	"facts_json" jsonb NOT NULL,
	"cites" text[] NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "rule_hits_tenant_id_rule_entity_pk" PRIMARY KEY("tenant_id","rule","entity"),
	CONSTRAINT "rule_hits_status" CHECK ("rule_hits"."status" in ('open', 'gone'))
);
--> statement-breakpoint
CREATE TABLE "rule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"fired" integer DEFAULT 0 NOT NULL,
	"cooled" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "memory_recalls" ADD COLUMN "found" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_findings" ADD CONSTRAINT "memory_findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_findings" ADD CONSTRAINT "memory_findings_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_hits" ADD CONSTRAINT "rule_hits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_findings_status" ON "memory_findings" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "rule_hits_open" ON "rule_hits" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "rule_runs_at" ON "rule_runs" USING btree ("tenant_id","ran_at");