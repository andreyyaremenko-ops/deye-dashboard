CREATE TYPE "public"."background_status" AS ENUM('uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'staff');--> statement-breakpoint
CREATE TABLE "backgrounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"name" text NOT NULL,
	"category" text,
	"license" text,
	"source" text,
	"status" "background_status" DEFAULT 'ready' NOT NULL,
	"files" jsonb,
	"preview" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_state" (
	"device_id" text PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"claim_code_hash" text NOT NULL,
	"org_id" uuid,
	"name" text,
	"hw" text,
	"fw" text,
	"stick_serial" bigint,
	"inverter_serial" text,
	"inverter_type" integer,
	"model_id" text,
	"claimed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"online" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inverter_models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"device_type" integer NOT NULL,
	"poll_ranges" jsonb NOT NULL,
	"register_map" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role" "org_role" DEFAULT 'staff' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "org_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan_id" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"limits" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"view_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry" (
	"time" timestamp with time zone NOT NULL,
	"device_id" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_raw" (
	"time" timestamp with time zone NOT NULL,
	"device_id" text NOT NULL,
	"start_reg" integer NOT NULL,
	"regs" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcode_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"background_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"is_superadmin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "backgrounds" ADD CONSTRAINT "backgrounds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_state" ADD CONSTRAINT "device_state_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_model_id_inverter_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."inverter_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screens" ADD CONSTRAINT "screens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry" ADD CONSTRAINT "telemetry_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_raw" ADD CONSTRAINT "telemetry_raw_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcode_jobs" ADD CONSTRAINT "transcode_jobs_background_id_backgrounds_id_fk" FOREIGN KEY ("background_id") REFERENCES "public"."backgrounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backgrounds_org_idx" ON "backgrounds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "devices_org_idx" ON "devices" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "screens_view_token_idx" ON "screens" USING btree ("view_token");--> statement-breakpoint
CREATE INDEX "screens_org_idx" ON "screens" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "telemetry_device_metric_time_idx" ON "telemetry" USING btree ("device_id","metric","time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "telemetry_raw_device_time_idx" ON "telemetry_raw" USING btree ("device_id","time" DESC NULLS LAST);