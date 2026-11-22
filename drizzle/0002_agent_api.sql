ALTER TABLE "agent_run" ADD COLUMN "agent" text NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "api_token_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "created_by_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_api_token_id_api_token_id_fk" FOREIGN KEY ("api_token_id") REFERENCES "public"."api_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_run_id_agent_run_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;