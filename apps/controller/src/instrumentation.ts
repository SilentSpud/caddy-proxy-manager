/** Next.js instrumentation hook — runs once when the server starts. */
export async function register() {
  // Only run on the server side
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Refuse to run under anything but Bun. This catches the paths where the app gets to execute
    // at all; the standalone build dies earlier, while linking, so `bun run build` plants an
    // equivalent check atop dist/standalone/server.js (scripts/inject-runtime-guard.mjs).
    const { assertBunRuntime } = await import("./lib/runtime-guard");
    assertBunRuntime();

    // Validate production configuration early to catch misconfigurations
    const { validateProductionConfig } = await import("./lib/config");
    try {
      validateProductionConfig();
    } catch (error) {
      console.error("Configuration validation failed:", error);
      if (process.env.NODE_ENV === "production") {
        // Fail fast in production with bad config
        throw error;
      }
    }

    const { ensureAdminUser } = await import("./lib/init-db");
    try {
      await ensureAdminUser();
      console.log("Database initialization complete");
    } catch (error) {
      console.error("Failed to initialize database:", error);
      // Don't throw — let the app start; errors surface when users reach the features
    }

    // After the seed, so an environment-configured deployment is recognised by the account it has
    // just created rather than being sent through a setup flow it does not need.
    const { backfillSetupCompletion } = await import("./lib/setup");
    try {
      await backfillSetupCompletion();
    } catch (error) {
      console.error("Failed to check first-run setup state:", error);
    }

    // With local users disabled, an OAuth provider is the only way in. Warn loudly rather than
    // throwing: an operator locked out of the UI can only recover by configuring a provider via
    // OAUTH_* environment variables, which needs the app to keep starting.
    const { config: appConfig } = await import("./lib/config");
    if (appConfig.auth.disableLocalUsers) {
      try {
        const { listEnabledOAuthProviders } = await import("./lib/models/oauth-providers");
        const providers = await listEnabledOAuthProviders();
        if (providers.length === 0) {
          console.error(
            "WARNING: AUTH_DISABLE_LOCAL_USERS=true but no OAuth provider is enabled — " +
              "no one can sign in. Configure a provider with the OAUTH_* environment variables.",
          );
        } else {
          console.log(
            `Local user management disabled — sign-in via ${providers.map((p) => p.name).join(", ")}`,
          );
        }
      } catch (error) {
        console.error("Failed to check OAuth provider availability:", error);
      }
    }

    // Imported keys and provider options could contain plaintext secrets in
    // older releases. Repair them before any request handler reads the rows.
    const { migrateLegacyCertificateStorage } = await import("./lib/models/certificates");
    try {
      const migrated = await migrateLegacyCertificateStorage();
      if (migrated > 0) {
        console.log(`Hardened ${migrated} legacy certificate record(s)`);
      }
    } catch (error) {
      console.error("Failed to harden legacy certificate storage");
      if (process.env.NODE_ENV === "production") throw error;
    }

    // Apply Caddy configuration from database on startup
    const { applyCaddyConfig } = await import("./lib/caddy");
    try {
      console.log("Applying Caddy configuration from database...");
      await applyCaddyConfig();
      console.log("Caddy configuration applied successfully");
    } catch (error) {
      console.error("Failed to apply Caddy configuration on startup:", error);
      // Don't throw — Caddy may not be ready yet, or the config may be applied later; this keeps
      // proxy hosts working after a container restart
    }

    // Start Caddy health monitoring to detect restarts and auto-reapply config
    const { startCaddyMonitoring } = await import("./lib/caddy-monitor");
    try {
      startCaddyMonitoring();
      console.log("Caddy health monitoring started");
    } catch (error) {
      console.error("Failed to start Caddy health monitoring:", error);
      // Don't throw - monitoring is a nice-to-have feature
    }

    // Initialize ClickHouse analytics database
    const { initClickHouse, closeClickHouse } = await import("./lib/clickhouse/client");
    try {
      await initClickHouse();
      console.log("ClickHouse analytics initialized");
    } catch (error) {
      console.error("Failed to initialize ClickHouse:", error);
      // Don't throw - analytics is non-critical
    }

    // Start log parser for analytics
    const { initLogParser, parseNewLogEntries, stopLogParser } = await import("./lib/log-parser");
    try {
      await initLogParser();
      const logParserInterval = setInterval(async () => {
        try {
          await parseNewLogEntries();
        } catch (err) {
          console.error("Log parser interval error:", err);
        }
      }, 30_000);
      process.on("SIGTERM", () => {
        stopLogParser();
        clearInterval(logParserInterval);
        closeClickHouse();
      });
      console.log("Log parser started");
    } catch (error) {
      console.error("Failed to start log parser:", error);
    }

    // Start WAF log parser for WAF event tracking
    const { initWafLogParser, parseNewWafLogEntries, stopWafLogParser } = await import(
      "./lib/waf-log-parser"
    );
    try {
      await initWafLogParser();
      const wafParserInterval = setInterval(async () => {
        try {
          await parseNewWafLogEntries();
        } catch (err) {
          console.error("WAF log parser interval error:", err);
        }
      }, 30_000);
      process.on("SIGTERM", () => {
        stopWafLogParser();
        clearInterval(wafParserInterval);
      });
      console.log("WAF log parser started");
    } catch (error) {
      console.error("Failed to start WAF log parser:", error);
    }

    // Start periodic instance sync if configured (controller mode only)
    const { getInstanceMode, getSyncIntervalMs, syncInstances } = await import(
      "./lib/instance-sync"
    );
    try {
      const mode = await getInstanceMode();
      const intervalMs = getSyncIntervalMs();

      if (mode === "controller" && intervalMs > 0) {
        console.log(`Starting periodic instance sync (every ${intervalMs / 1000}s)`);
        setInterval(async () => {
          try {
            const result = await syncInstances();
            if (result.total > 0) {
              console.log(`Periodic sync completed: ${result.success}/${result.total} succeeded`);
            }
          } catch (error) {
            console.error("Periodic sync failed:", error);
          }
        }, intervalMs);
      }
    } catch (error) {
      console.error("Failed to start periodic instance sync:", error);
      // Don't throw - periodic sync is optional
    }
  }
}
