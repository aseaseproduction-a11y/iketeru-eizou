CREATE TABLE `favoriteProfiles` (
	`id` varchar(64) NOT NULL,
	`displayName` varchar(80) NOT NULL,
	`normalizedName` varchar(160) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `favoriteProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `favorite_profiles_normalized_name_unique` UNIQUE(`normalizedName`)
);
--> statement-breakpoint
CREATE TABLE `profileCreatorFavorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` varchar(64) NOT NULL,
	`creatorName` varchar(160) NOT NULL,
	`normalizedCreatorName` varchar(240) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `profileCreatorFavorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `profile_creator_favorites_profile_creator_unique` UNIQUE(`profileId`,`normalizedCreatorName`)
);
--> statement-breakpoint
CREATE TABLE `profileVideoFavorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` varchar(64) NOT NULL,
	`videoId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `profileVideoFavorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `profile_video_favorites_profile_video_unique` UNIQUE(`profileId`,`videoId`)
);
