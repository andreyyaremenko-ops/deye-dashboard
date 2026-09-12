ALTER TABLE "screens" ADD COLUMN "pair_code" text;--> statement-breakpoint
ALTER TABLE "screens" ADD COLUMN "pair_code_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "screens_pair_code_idx" ON "screens" USING btree ("pair_code");