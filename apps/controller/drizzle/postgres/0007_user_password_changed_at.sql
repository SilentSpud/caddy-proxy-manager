-- When a user's login password was last set, which nothing recorded before. Left null for existing
-- rows rather than guessed: the credential account's updatedAt looks like the answer but is not,
-- since the environment-seeded admin rewrites it on every start, and "not recorded" is honest
-- where a wrong date would not be.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" text;
