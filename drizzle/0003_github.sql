ALTER TABLE "task" ADD COLUMN "pr_head_sha" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "merge_commit_sha" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "production_deployed_at" timestamp with time zone;