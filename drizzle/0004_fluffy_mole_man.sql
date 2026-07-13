CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`labour_hourly_rate_pence` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `product_variants` ADD `labour_hours_per_unit` real;