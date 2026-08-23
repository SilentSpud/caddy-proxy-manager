import bcrypt from "bcryptjs";
import db, { nowIso } from "./db";
import { CREDENTIAL_ISSUER } from "./account-issuer";
import { config } from "./config";
import { users, accounts } from "./db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Ensures the admin user from environment variables exists in the database.
 * This is called during application startup.
 * The password from environment variables is hashed and stored securely.
 */

//Todo: this could probably be handled better, especially for the adminid.
export async function ensureAdminUser(): Promise<void> {
  // OIDC-only mode: no local accounts exist, so there is no bootstrap admin to
  // seed and no admin credentials to require. Roles come from the IdP's groups.
  if (config.auth.disableLocalUsers) {
    console.log(
      "Local user management is disabled (AUTH_DISABLE_LOCAL_USERS=true) — skipping admin user seed",
    );
    return;
  }

  const adminUsername = config.adminUsername;
  const adminPassword = config.adminPassword;
  if (!adminUsername || !adminPassword) {
    console.warn("Admin credentials are not configured — skipping admin user seed");
    return;
  }

  const adminId = 1; // Must match the hardcoded ID in auth.ts
  const adminEmail = `${adminUsername}@localhost`;
  const provider = "credentials";
  const subject = adminUsername;

  // Hash the admin password for secure storage
  const passwordHash = bcrypt.hashSync(adminPassword, 12);

  // Check if admin user already exists
  const existingUser = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.id, adminId),
  });

  if (existingUser) {
    // Admin user exists, update credentials if needed
    // Always update password hash to handle password changes in env vars
    // Also ensure role is always "admin" for the primary admin user
    const now = nowIso();
    await db
      .update(users)
      .set({
        email: adminEmail,
        subject,
        passwordHash,
        role: "admin",
        username: adminUsername.toLowerCase(),
        displayUsername: adminUsername,
        updatedAt: now,
      })
      .where(eq(users.id, adminId));
    // Ensure credential account row exists for Better Auth
    await ensureCredentialAccount(adminId, passwordHash);
    console.log(`Updated admin user: ${adminUsername}`);
    return;
  }

  // Create admin user with hashed password
  const now = nowIso();
  await db.insert(users).values({
    id: adminId,
    email: adminEmail,
    name: adminUsername,
    passwordHash,
    role: "admin",
    provider,
    subject,
    username: adminUsername.toLowerCase(),
    displayUsername: adminUsername,
    avatarUrl: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  console.log(`Created admin user: ${adminUsername}`);

  // Ensure credential account row exists for Better Auth
  await ensureCredentialAccount(adminId, passwordHash);
}

/**
 * Ensures a credential account row exists in the accounts table for Better Auth.
 * Better Auth requires an accounts row with providerId="credential" and the password hash.
 */
async function ensureCredentialAccount(userId: number, passwordHash: string): Promise<void> {
  const now = nowIso();
  const existing = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .get();

  if (existing) {
    // Update password hash if changed
    await db
      .update(accounts)
      .set({
        password: passwordHash,
        updatedAt: now,
      })
      .where(eq(accounts.id, existing.id));
  } else {
    await db.insert(accounts).values({
      userId,
      accountId: userId.toString(),
      providerId: "credential",
      issuer: CREDENTIAL_ISSUER,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  }
}
