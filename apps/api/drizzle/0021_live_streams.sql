CREATE TABLE "live_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"path_id" text NOT NULL,
	"publish_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_streams_path_id_unique" UNIQUE("path_id")
);
--> statement-breakpoint
ALTER TABLE "live_streams" ADD CONSTRAINT "live_streams_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_streams_org_idx" ON "live_streams" USING btree ("org_id");