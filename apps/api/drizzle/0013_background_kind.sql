CREATE TYPE "public"."background_kind" AS ENUM('video', 'image');--> statement-breakpoint
ALTER TABLE "backgrounds" ADD COLUMN "kind" "background_kind" DEFAULT 'video' NOT NULL;