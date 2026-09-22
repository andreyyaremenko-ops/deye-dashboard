ALTER TABLE "menu_styles" ADD COLUMN "image_provider" text DEFAULT 'xai' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_styles" ADD COLUMN "image_model" text DEFAULT 'grok-imagine-image-2.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_styles" ADD COLUMN "image_quality" text DEFAULT 'medium' NOT NULL;