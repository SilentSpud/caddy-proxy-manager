-- Extra databases for the end-to-end stack's additional controller instances.
--
-- docker-compose.yml's postgres service creates one database; the suite runs four web containers
-- (web, web-registration-enabled, web-controller, web-agent) and each needs its own, because they
-- assert on each other's data being separate. Run by the postgres image from
-- /docker-entrypoint-initdb.d on first initialization only, which is every run: the suite tears
-- the volume down with `down -v`.
CREATE DATABASE cpm_registration OWNER cpm;
CREATE DATABASE cpm_controller OWNER cpm;
CREATE DATABASE cpm_agent OWNER cpm;
