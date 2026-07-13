CREATE TABLE `batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`batch_number` integer NOT NULL,
	`quantity_made` integer NOT NULL,
	`unit_cost_pence_at_production` integer NOT NULL,
	`notes` text,
	`produced_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batches_variant_number_unique` ON `batches` (`variant_id`,`batch_number`);--> statement-breakpoint
CREATE TABLE `components` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sku` text,
	`unit` text NOT NULL,
	`stock_quantity` real,
	`stock_value_pence` integer,
	`cost_per_unit_pence` real,
	`reorder_level` real,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `components_sku_unique` ON `components` (`sku`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`sku` text NOT NULL,
	`variant_name` text NOT NULL,
	`stock_quantity` integer DEFAULT 0 NOT NULL,
	`price_pence` integer NOT NULL,
	`unit_cost_pence` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_sku_unique` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE INDEX `product_variants_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`description` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant_id` integer NOT NULL,
	`component_id` integer NOT NULL,
	`quantity_per_unit` real,
	`cost_pool_pence_per_unit` integer,
	`notes` text,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_variant_component_unique` ON `recipes` (`variant_id`,`component_id`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`component_id` integer NOT NULL,
	`reason` text NOT NULL,
	`quantity_delta` real DEFAULT 0 NOT NULL,
	`value_delta_pence` integer DEFAULT 0 NOT NULL,
	`batch_id` integer,
	`notes` text,
	`occurred_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`component_id`) REFERENCES `components`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_movements_component_idx` ON `stock_movements` (`component_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_batch_idx` ON `stock_movements` (`batch_id`);