CREATE TABLE "logger_frames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial" bigint NOT NULL,
	"control" integer NOT NULL,
	"frame" "bytea" NOT NULL,
	"remote_ip" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "logger_frames_serial_time_idx" ON "logger_frames" USING btree ("serial","received_at" DESC NULLS LAST);