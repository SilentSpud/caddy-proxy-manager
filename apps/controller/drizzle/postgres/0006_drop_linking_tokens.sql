-- The manual account-linking flow is gone. next-auth's sign-in callback stored a short-lived token
-- here and redirected to /link-account; Better Auth replaced that callback and nothing has written
-- to the table since. Linking now happens either automatically, for a provider trusted to link by
-- email, or from Profile once signed in.
--
-- Nothing is lost: every row was a five-minute token for a redirect that no longer exists.
DROP TABLE IF EXISTS "linking_tokens";
