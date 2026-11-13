ALTER TABLE `videos` ADD `purposes` text DEFAULT ('[]') NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `purposes` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `expressions` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `toneEmotions` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `toneVisuals` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `toneTechniques` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `productions` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `privateRating` varchar(16);
