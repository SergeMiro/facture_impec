CREATE TABLE "schedule_runs" (
	"name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL
);
