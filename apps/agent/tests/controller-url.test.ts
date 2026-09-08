/**
 * Turning what an operator types into an origin the agent dials.
 *
 * The port rules carry the weight here. An address with no port is the normal case in two very
 * different deployments — `10.0.0.5`, where the controller's own 3000 is meant, and
 * `https://cpm.tailnet.ts.net`, where Tailscale is terminating TLS on 443 — and one default
 * cannot be right for both. Every case below was checked against a real tailnet node.
 */
import { describe, expect, it } from "bun:test";
import {
  ControllerAddressError,
  normalizeControllerUrl,
  normalizePairingCode,
} from "../src/controller-url";

describe("bare hosts keep meaning the controller's own port", () => {
  it("assumes http and 3000 for an address with neither", () => {
    expect(normalizeControllerUrl("10.0.0.5")).toBe("http://10.0.0.5:3000");
  });

  it("keeps a port the operator typed", () => {
    expect(normalizeControllerUrl("10.0.0.5:8080")).toBe("http://10.0.0.5:8080");
  });

  it("takes a MagicDNS short name as a host", () => {
    // What an agent on the same tailnet as the controller would be given.
    expect(normalizeControllerUrl("cpm-controller")).toBe("http://cpm-controller:3000");
  });

  it("still means 3000 when only the http scheme was spelled out", () => {
    // The compose default is `http://web:3000`; `http://web` has always meant the same thing.
    expect(normalizeControllerUrl("http://web")).toBe("http://web:3000");
  });

  it("brackets an IPv6 literal and defaults its port the same way", () => {
    expect(normalizeControllerUrl("[fd7a:115c:a1e0::1]")).toBe("http://[fd7a:115c:a1e0::1]:3000");
    expect(normalizeControllerUrl("[fd7a:115c:a1e0::1]:3000")).toBe(
      "http://[fd7a:115c:a1e0::1]:3000",
    );
  });
});

describe("an https address means whatever is terminating TLS, not the controller", () => {
  it("defaults to 443, because the controller never serves TLS itself", () => {
    // `tailscale serve` publishes the controller at exactly this address with no port to type.
    // Defaulting it to 3000 dialled a port nothing was listening on.
    expect(normalizeControllerUrl("https://cpm.tailnet-1234.ts.net")).toBe(
      "https://cpm.tailnet-1234.ts.net:443",
    );
  });

  it("keeps an explicitly typed 443 rather than discarding it", () => {
    // `new URL` normalises a scheme's default port away, so the explicit :443 vanished and the
    // old rule fell through to 3000 — silently sending the agent somewhere it was not told to.
    expect(normalizeControllerUrl("https://cpm.tailnet-1234.ts.net:443")).toBe(
      "https://cpm.tailnet-1234.ts.net:443",
    );
  });

  it("keeps an explicitly typed 80 on an http address", () => {
    expect(normalizeControllerUrl("http://10.0.0.5:80")).toBe("http://10.0.0.5:80");
  });

  it("keeps any other port it was given", () => {
    expect(normalizeControllerUrl("https://cpm.example.com:8443")).toBe(
      "https://cpm.example.com:8443",
    );
  });

  it("lets --port override the scheme's default", () => {
    expect(normalizeControllerUrl("https://cpm.tailnet-1234.ts.net", 3000)).toBe(
      "https://cpm.tailnet-1234.ts.net:3000",
    );
  });
});

describe("refusals", () => {
  it("rejects an empty address", () => {
    expect(() => normalizeControllerUrl("  ")).toThrow(ControllerAddressError);
  });

  it("rejects a pasted dashboard URL rather than trimming it", () => {
    // Quietly dropping the path would send a pairing code somewhere the operator did not mean.
    expect(() => normalizeControllerUrl("https://cpm.example.com/settings")).toThrow(
      ControllerAddressError,
    );
  });

  it("rejects a scheme that is not http or https", () => {
    expect(() => normalizeControllerUrl("ssh://cpm.example.com")).toThrow(ControllerAddressError);
  });

  it("rejects a port outside the valid range", () => {
    expect(() => normalizeControllerUrl("10.0.0.5", 70000)).toThrow(ControllerAddressError);
  });
});

describe("pairing codes", () => {
  it("upper-cases and strips spaces", () => {
    expect(normalizePairingCode(" ab cdef ")).toBe("ABCDEF");
  });

  it("refuses anything that is not six letters", () => {
    expect(() => normalizePairingCode("ABC12F")).toThrow(ControllerAddressError);
  });
});
