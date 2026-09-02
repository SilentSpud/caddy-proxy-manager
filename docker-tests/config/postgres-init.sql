-- web-agent runs as a separate controller instance and must not share the primary's database.
-- The postgres image creates only POSTGRES_DB, so the second one is made here.
CREATE DATABASE cpm_agent OWNER cpm;
