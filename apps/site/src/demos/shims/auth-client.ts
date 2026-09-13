/**
 * Stands in for the controller's `src/lib/auth-client` inside the demos (see the alias in
 * astro.config.mjs).
 *
 * The real one is Better Auth's client, which posts to `/api/auth/*` on whatever origin loaded it -
 * here the documentation site, which has no such route and would answer with a 404 page. This one
 * never makes a request. Every attempt fails the way a wrong password or an unreachable provider
 * does, after a pause long enough to see the pending state, so what a reader gets to try is the
 * form's own handling of that: the name kept on screen, the error in the product's words.
 */
const pause = () => new Promise((resolve) => setTimeout(resolve, 700));

export const authClient = {
  signIn: {
    async username(_input: { username: string; password: string }) {
      await pause();
      // No message, so the form falls back to its own wording for a rejected password.
      return { error: { status: 401 } };
    },
    async social(_input: { provider: string; callbackURL?: string; errorCallbackURL?: string }) {
      await pause();
      throw new Error("There is no identity provider behind the documentation site");
    },
  },
};
