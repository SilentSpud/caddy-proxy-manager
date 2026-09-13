import LoginClient from "@cpm/controller/src/components/auth/LoginClient";
import { DemoSurface } from "../DemoSurface";

/**
 * The sign-in screen itself, both steps of it.
 *
 * `LoginClient` runs unchanged. Its auth client is swapped for a shim that fails every attempt (see
 * shims/auth-client.ts), which is the honest outcome with no controller behind the page - and the
 * interesting one, because a failed password is where the kept username earns its place.
 *
 * Two providers, one of them primary, so the `tonal` button has something to be set against.
 */
export default function SignInDemo() {
  return (
    <DemoSurface>
      {/* The screen centres itself in the full viewport height; the wrapper lets demo.css undo
          that inside a documentation page. */}
      <div className="cpm-demo-auth">
        <LoginClient
          enabledProviders={[
            { id: "authentik", name: "Authentik", isPrimary: true },
            { id: "github", name: "GitHub" },
          ]}
        />
      </div>
    </DemoSurface>
  );
}
