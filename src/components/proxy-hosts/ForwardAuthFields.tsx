import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { ForwardAuthSettings } from "@/lib/settings";
import { ProxyHost } from "@/lib/models/proxy-hosts";

const AUTHELIA_ENDPOINT = "/api/authz/forward-auth";
const AUTHELIA_HEADERS = [
    "Remote-User",
    "Remote-Groups",
    "Remote-Email",
    "Remote-Name",
    "Remote-IP"
];
const DEFAULT_TRUSTED_PROXIES = ["private_ranges"];

type Provider = "authelia" | "custom";

function getForwardAuthFormDefaults(
    forwardAuth: ProxyHost["forwardAuth"] | null,
    defaults: ForwardAuthSettings | null | undefined
) {
    const provider: Provider = forwardAuth?.provider ?? (defaults?.provider === "custom" ? "custom" : "authelia");
    return {
        enabled: forwardAuth?.enabled ?? false,
        provider,
        upstream: forwardAuth?.authUpstream ?? defaults?.authUpstream ?? "",
        endpoint:
            forwardAuth?.authEndpoint ??
            defaults?.authEndpoint ??
            (provider === "authelia" ? AUTHELIA_ENDPOINT : ""),
        copyHeaders:
            forwardAuth && forwardAuth.copyHeaders.length > 0
                ? forwardAuth.copyHeaders.join("\n")
                : provider === "authelia"
                    ? AUTHELIA_HEADERS.join("\n")
                    : "",
        trustedProxies:
            forwardAuth && forwardAuth.trustedProxies.length > 0
                ? forwardAuth.trustedProxies.join("\n")
                : DEFAULT_TRUSTED_PROXIES.join("\n"),
        apiSplit: forwardAuth?.apiSplit ?? false,
        apiBypassHeaders:
            forwardAuth && forwardAuth.apiBypassHeaders.length > 0
                ? forwardAuth.apiBypassHeaders.join(", ")
                : ""
    };
}

/**
 * Generic forward-auth provider section (Authelia and other forward-auth
 * servers, issue #188). Supports the split browser vs API pattern:
 *
 *  - Browser requests are redirected to the auth portal by the auth server.
 *  - With "401 for non-browser clients" enabled, API clients and WebSocket
 *    handshakes get a bare 401 instead of the portal redirect.
 *  - "Bypass headers" lets requests carrying e.g. an X-Api-Key skip forward
 *    auth entirely so the upstream can enforce its own API-key auth.
 */
export function ForwardAuthFields({
    forwardAuth,
    defaults
}: {
    forwardAuth?: ProxyHost["forwardAuth"] | null;
    /**
     * Global Forward Auth defaults, used to prefill blank fields. Pass `null`
     * explicitly when there are no defaults (mirrors AuthentikFields, #232).
     */
    defaults: ForwardAuthSettings | null;
}) {
    const initial = forwardAuth ?? null;
    const [enabled, setEnabled] = useState(false);
    const [provider, setProvider] = useState<Provider>("authelia");
    const [upstream, setUpstream] = useState("");
    const [endpoint, setEndpoint] = useState("");
    const [copyHeadersValue, setCopyHeadersValue] = useState("");
    const [trustedProxiesValue, setTrustedProxiesValue] = useState("");
    const [apiSplit, setApiSplit] = useState(false);
    const [apiBypassHeadersValue, setApiBypassHeadersValue] = useState("");

    useEffect(() => {
        const next = getForwardAuthFormDefaults(initial, defaults);
        setEnabled(next.enabled);
        setProvider(next.provider);
        setUpstream(next.upstream);
        setEndpoint(next.endpoint);
        setCopyHeadersValue(next.copyHeaders);
        setTrustedProxiesValue(next.trustedProxies);
        setApiSplit(next.apiSplit);
        setApiBypassHeadersValue(next.apiBypassHeaders);
    }, [initial, defaults]);

    function applyPreset(nextProvider: Provider) {
        setProvider(nextProvider);
        const presetEndpoint = nextProvider === "authelia" ? AUTHELIA_ENDPOINT : "";
        const presetHeaders = nextProvider === "authelia" ? AUTHELIA_HEADERS.join("\n") : "";
        const otherEndpoint = nextProvider === "authelia" ? "" : AUTHELIA_ENDPOINT;
        const otherHeaders = nextProvider === "authelia" ? "" : AUTHELIA_HEADERS.join("\n");
        // Only swap in preset values when the field is blank or still holds the
        // other preset's default — never clobber custom configuration.
        setEndpoint((current) => (current.trim() === "" || current === otherEndpoint ? presetEndpoint : current));
        setCopyHeadersValue((current) =>
            current.trim() === "" || current === otherHeaders ? presetHeaders : current
        );
    }

    return (
        <div className="rounded-lg border border-primary bg-primary/5 p-5">
            <input type="hidden" name="forwardAuthPresent" value="1" />
            <input type="hidden" name="forwardAuthEnabledPresent" value="1" />
            <input type="hidden" name="forwardAuthEnabled" value={enabled ? "true" : "false"} />
            <input type="hidden" name="forwardAuthApiSplitPresent" value="1" />
            <input type="hidden" name="forwardAuthApiSplit" value={apiSplit ? "true" : "false"} />
            <div className="flex flex-col gap-4">
                <div className="flex flex-row items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold">Generic Forward Auth</p>
                        <p className="text-sm text-muted-foreground">
                            Authelia or any forward-auth server, with split browser vs API authentication
                        </p>
                    </div>
                    <Switch
                        checked={enabled}
                        onCheckedChange={setEnabled}
                    />
                </div>

                <div className={cn(
                    "overflow-hidden transition-all duration-200",
                    enabled ? "max-h-[2400px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                )}>
                    <div className="flex flex-col gap-4">
                        <div>
                            <label className="text-sm font-medium mb-1 block">Provider Preset</label>
                            <Select
                                name="forwardAuthProvider"
                                value={provider}
                                onValueChange={(value) => applyPreset(value as Provider)}
                                disabled={!enabled}
                            >
                                <SelectTrigger aria-label="Provider preset">
                                    <SelectValue placeholder="Authelia" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="authelia">Authelia</SelectItem>
                                    <SelectItem value="custom">Custom (generic forward auth)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Auth Server URL</label>
                            <Input
                                name="forwardAuthUpstream"
                                placeholder={provider === "authelia" ? "http://authelia:9091" : "http://forward-auth:9000"}
                                value={upstream}
                                onChange={(event) => setUpstream(event.target.value)}
                                required={enabled}
                                disabled={!enabled}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Base URL Caddy uses to reach the auth server (no path).
                            </p>
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Auth Endpoint</label>
                            <Input
                                name="forwardAuthEndpoint"
                                placeholder={AUTHELIA_ENDPOINT}
                                value={endpoint}
                                onChange={(event) => setEndpoint(event.target.value)}
                                required={enabled}
                                disabled={!enabled}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                URI the auth check is sent to. For Authelia you can append the portal URL as a
                                query parameter, e.g. <code>/api/authz/forward-auth?authelia_url=https://auth.example.com</code>.
                            </p>
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Headers to Copy</label>
                            <Textarea
                                name="forwardAuthCopyHeaders"
                                value={copyHeadersValue}
                                onChange={(event) => setCopyHeadersValue(event.target.value)}
                                disabled={!enabled}
                                rows={3}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Identity headers copied from the auth response to the upstream request (one per line).
                                These headers are stripped from incoming requests to prevent spoofing.
                            </p>
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Trusted Proxies</label>
                            <Input
                                name="forwardAuthTrustedProxies"
                                value={trustedProxiesValue}
                                onChange={(event) => setTrustedProxiesValue(event.target.value)}
                                disabled={!enabled}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                CIDR ranges Caddy trusts for X-Forwarded-For on the auth subrequest. Use &quot;private_ranges&quot; for all private networks.
                            </p>
                        </div>
                        <div className="rounded-md border bg-background p-3 flex flex-col gap-3">
                            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                                API / service clients
                            </p>
                            <div className="flex items-start gap-2">
                                <Switch
                                    id="forwardAuthApiSplitToggle"
                                    checked={apiSplit}
                                    onCheckedChange={setApiSplit}
                                    disabled={!enabled}
                                />
                                <label htmlFor="forwardAuthApiSplitToggle" className={cn("text-sm cursor-pointer", !enabled && "cursor-not-allowed opacity-50")}>
                                    Return 401 for non-browser clients
                                </label>
                            </div>
                            <p className="text-xs text-muted-foreground -mt-2">
                                When enabled, API clients and WebSocket handshakes (anything without a browser
                                Accept header) receive a plain 401 from unauthenticated requests instead of a
                                redirect to the login portal. Recommended for hosts with both a web UI and an API.
                            </p>
                            <div>
                                <label className="text-sm font-medium mb-1 block">Bypass Headers (Optional)</label>
                                <Input
                                    name="forwardAuthApiBypassHeaders"
                                    placeholder="X-Api-Key, Authorization"
                                    value={apiBypassHeadersValue}
                                    onChange={(event) => setApiBypassHeadersValue(event.target.value)}
                                    disabled={!enabled}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Comma-separated. Requests carrying any of these headers skip forward auth so
                                    the upstream can authenticate them itself (e.g. Moonraker&apos;s X-Api-Key).
                                </p>
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Protected Paths (Optional)</label>
                            <Textarea
                                name="forwardAuthProtectedPaths"
                                placeholder="/secret/*, /admin/*"
                                defaultValue={initial?.protectedPaths?.join(", ") ?? ""}
                                disabled={!enabled}
                                rows={2}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Leave empty to protect entire domain. Comma-separated paths to protect specific routes only.
                            </p>
                        </div>
                        <div>
                            <label className="text-sm font-medium mb-1 block">Excluded Paths (Optional)</label>
                            <Textarea
                                name="forwardAuthExcludedPaths"
                                placeholder="/share/*, /rest/*"
                                defaultValue={initial?.excludedPaths?.join(", ") ?? ""}
                                disabled={!enabled}
                                rows={2}
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                Paths to exclude from authentication. These paths will bypass forward auth while all other paths remain protected. Ignored if Protected Paths is set.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
