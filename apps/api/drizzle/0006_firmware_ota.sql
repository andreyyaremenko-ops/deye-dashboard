CREATE TABLE "firmware" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hw" text NOT NULL,
	"channel" text NOT NULL,
	"version" text NOT NULL,
	"file" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "fw_channel" text DEFAULT 'stable' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "firmware_hw_channel_version_idx" ON "firmware" USING btree ("hw","channel","version");