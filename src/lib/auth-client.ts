import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth/client";
import { usernameClient } from "better-auth/client/plugins";

// Cast via unknown because better-auth's usernameClient $InferServerPlugin requires
// `email: string` while BetterAuthClientPlugin expects `email?: any` — the version
// resolution differs across environments (local vs. Docker), so the cast keeps both happy.
const usernamePlugin = usernameClient() as unknown as BetterAuthClientPlugin;

// There is no genericOAuthClient here: as of better-auth 1.7 the server-side
// genericOAuth plugin registers each configured provider as a first-class social
// provider, so they are driven through the core `signIn.social` / `callback/:id`
// endpoints. The client plugin had no endpoints of its own left to contribute and
// was removed upstream. Every call site already uses `signIn.social({ provider })`.
export const authClient = createAuthClient({
  plugins: [usernamePlugin],
});
