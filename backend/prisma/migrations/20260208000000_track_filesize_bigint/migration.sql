-- AlterTable: Change Track.fileSize from INT4 to INT8 (BigInt)
-- This is needed to support audio files larger than ~2GB (INT4 max = 2,147,483,647)
ALTER TABLE "Track" ALTER COLUMN "fileSize" SET DATA TYPE BIGINT;
