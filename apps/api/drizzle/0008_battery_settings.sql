ALTER TABLE "devices" ADD COLUMN "battery_kwh" double precision;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "min_soc" integer DEFAULT 20 NOT NULL;