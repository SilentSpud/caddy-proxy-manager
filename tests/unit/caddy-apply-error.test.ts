import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CaddyApplyError,
  logCaddyApplyFailure,
} from "@/src/lib/caddy-apply-error";

describe("Caddy apply error redaction", () => {
  it("logs safe metadata without raw messages, response bodies, URLs, or stacks", () => {
    const sensitiveDetail = "http://caddy:2019 raw-response-secret-sentinel";
    const failure = Object.assign(new Error(sensitiveDetail), { code: "ECONNREFUSED" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const errorId = logCaddyApplyFailure("Caddy admin request failed", failure, {
      status: 502,
    });

    expect(errorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(sensitiveDetail);
    expect(consoleSpy).toHaveBeenCalledWith("Caddy apply failure", expect.objectContaining({
      errorId,
      context: "Caddy admin request failed",
      errorType: "Error",
      code: "ECONNREFUSED",
      status: 502,
    }));
    consoleSpy.mockRestore();
  });

  it("never constructs an exception from Caddy response text", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/caddy.ts"), "utf8");
    const error = new CaddyApplyError("Caddy rejected configuration", "CADDY_REJECTED");

    expect(error.message).toBe("Caddy rejected configuration");
    expect(source).not.toMatch(/(?:throw new Error|console\.error)[^\n]*response\.text/);
    expect(source).toContain("responseBytes: Buffer.byteLength(response.text)");
  });
});
