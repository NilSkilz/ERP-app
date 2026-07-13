CREATE TABLE `variant_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`filename` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`caption` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `variant_attachments_variant_idx` ON `variant_attachments` (`variant_id`);--> statement-breakpoint
ALTER TABLE `product_variants` ADD `target_stock` integer;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `build_notes` text;