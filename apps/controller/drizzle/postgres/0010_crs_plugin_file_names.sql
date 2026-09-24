-- The file names a CRS plugin's release shipped, so the installed-plugins view can list them.
ALTER TABLE "crs_plugins" ADD COLUMN IF NOT EXISTS "fileNames" text DEFAULT '[]' NOT NULL;
