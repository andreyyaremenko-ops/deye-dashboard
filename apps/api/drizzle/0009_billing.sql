CREATE TYPE "public"."payment_status" AS ENUM('created', 'processing', 'hold', 'success', 'failure', 'reversed', 'expired');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text,
	"plan_id" text NOT NULL,
	"months" integer NOT NULL,
	"amount" integer NOT NULL,
	"ccy" integer DEFAULT 980 NOT NULL,
	"invoice_id" text,
	"page_url" text,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"failure_reason" text,
	"applied_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_invoice_id_unique" UNIQUE("invoice_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "price_month" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_org_idx" ON "payments" USING btree ("org_id");