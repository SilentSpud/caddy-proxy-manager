CREATE TABLE `crs_plugins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`repository` text NOT NULL,
	`version` text NOT NULL,
	`description` text,
	`ruleIdStart` integer NOT NULL,
	`ruleIdEnd` integer NOT NULL,
	`configRules` text NOT NULL,
	`beforeRules` text NOT NULL,
	`afterRules` text NOT NULL,
	`configOverride` text,
	`createdBy` integer,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crs_plugins_name_unique` ON `crs_plugins` (`name`);