CREATE TABLE "device_counters" (
	"device_id" text NOT NULL,
	"month" text NOT NULL,
	"counters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_counters_device_id_month_pk" PRIMARY KEY("device_id","month")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "pv_kwp" double precision;--> statement-breakpoint
ALTER TABLE "device_counters" ADD CONSTRAINT "device_counters_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;