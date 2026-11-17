CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"agents_enabled" boolean DEFAULT true NOT NULL,
	"agents_paused_at" timestamp with time zone,
	"agents_paused_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "on_hold" boolean DEFAULT false NOT NULL;