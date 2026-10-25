CREATE TABLE "relay_chats" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"licence_id" uuid NOT NULL,
	"bound_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relay_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"licence_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relay_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"licence_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"chat_id" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relay_inbox_kind" CHECK ("relay_inbox"."kind" in ('bound', 'press'))
);
--> statement-breakpoint
CREATE TABLE "relay_licences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"public_key" text,
	"registered_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relay_licences_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "relay_licences_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE "telegram_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_links" ADD COLUMN "channel" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "relay_chats" ADD CONSTRAINT "relay_chats_licence_id_relay_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "public"."relay_licences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_codes" ADD CONSTRAINT "relay_codes_licence_id_relay_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "public"."relay_licences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_inbox" ADD CONSTRAINT "relay_inbox_licence_id_relay_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "public"."relay_licences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_codes" ADD CONSTRAINT "telegram_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_codes" ADD CONSTRAINT "telegram_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relay_inbox_licence" ON "relay_inbox" USING btree ("licence_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chats_live" ON "telegram_chats" USING btree ("chat_id") WHERE "telegram_chats"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chats_person" ON "telegram_chats" USING btree ("tenant_id","user_id") WHERE "telegram_chats"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "action_links" ADD CONSTRAINT "action_links_channel" CHECK ("action_links"."channel" in ('email', 'telegram'));