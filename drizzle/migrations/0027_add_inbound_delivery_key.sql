ALTER TABLE `messages` ADD COLUMN `inbound_delivery_key` text;
CREATE UNIQUE INDEX `messages_inbound_delivery_key_idx`
ON `messages` (`inbound_delivery_key`);
