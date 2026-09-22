CREATE TABLE "radio_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"source_url" text NOT NULL,
	"content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "radio_stations" ADD CONSTRAINT "radio_stations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "radio_stations_org_url_idx" ON "radio_stations" USING btree ("org_id","url");