-- Allow a MISSING PDF topic match to exist without inventing a VIDEO topic.
ALTER TABLE "TopicMatch" ALTER COLUMN "videoTopicId" DROP NOT NULL;
