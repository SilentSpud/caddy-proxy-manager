import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { usernameClient } from "better-auth/client/plugins";

// Cast via unknown because better-auth's usernameClient $InferServerPlugin requires
// `email: string` while BetterAuthClientPlugin expects `email?: any` — the version
// resolution differs across environments (local vs. Docker), so the cast keeps both happy.
const usernamePlugin = usernameClient() as unknown as BetterAuthClientPlugin;

// No genericOAuthClient: since better-auth 1.7 the server plugin registers each provider as a
// first-class social provider, so call sites use `signIn.social({ provider })`.
export const authClient = createAuthClient({
  plugins: [usernamePlugin],
});
