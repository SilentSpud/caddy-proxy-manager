-- Each revision's before and after values, so revisions can be compared and restored. Null on
-- rows written before this, which the history shows as neither.
ALTER TABLE "settings_revisions" ADD COLUMN IF NOT EXISTS "changes" text;
