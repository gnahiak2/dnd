CREATE TABLE `events` (
	`room_id` text NOT NULL,
	`seq` integer NOT NULL,
	`at` integer NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`room_id`, `seq`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`display_name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_token_hash_unique` ON `players` (`token_hash`);--> statement-breakpoint
CREATE INDEX `players_room_idx` ON `players` (`room_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
