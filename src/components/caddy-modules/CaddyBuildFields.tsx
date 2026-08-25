"use client";

/**
 * The module picker for the Caddy image.
 *
 * Two things happen on this panel and they are deliberately kept apart:
 *
 *   Save    — records which plugins the operator wants. Takes effect for config
 *             generation straight away (a module switched off stops producing
 *             handlers immediately) but does not touch the running container.
 *   Rebuild — recompiles Caddy with that selection and recreates the container.
 *             Minutes long, and the proxy restarts at the end of it.
 *
 * Collapsing them into one button would mean every stray toggle triggered a
 * multi-minute recompile and a restart of the live proxy, so the rebuild stays
 * an explicit, separately-confirmed act.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Hammer, Plus, Trash2 } from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { Link } from "@astryxdesign/core/Link";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@/components/ui/FormBooleanControls";
import { CodeEditor } from "@/components/ui/CodeEditor";
import {
  CADDY_MODULES,
  type CaddyCustomModule,
  type CaddyModuleCategory,
  type CaddyModuleDefinition,
  customModuleSpec,
  validateCustomModule,
} from "@/src/lib/caddy-modules";

type BuildStatus = {
  state: "idle" | "pending" | "building" | "applied" | "failed";
  message?: string;
  appliedAt?: string;
  error?: string;
};

type BuildDiff = {
  appliedSpecs: string[];
  desiredSpecs: string[];
  added: string[];
  removed: string[];
  needsRebuild: boolean;
};

type BuildResponse = { diff: BuildDiff; status: BuildStatus };

type CustomModuleRow = CaddyCustomModule & { uid: string };

let rowIdCounter = 0;
const nextRowId = () => `custom-${++rowIdCounter}`;

const CATEGORY_LABELS: Record<CaddyModuleCategory, string> = {
  proxy: "Proxying",
  security: "Security",
  dns: "ACME DNS-01 providers",
};

const CATEGORY_ORDER: CaddyModuleCategory[] = ["proxy", "security", "dns"];

function groupModules(): [CaddyModuleCategory, CaddyModuleDefinition[]][] {
  return CATEGORY_ORDER.map((category) => [
    category,
    CADDY_MODULES.filter((m) => m.category === category),
  ]);
}

export function CaddyBuildFields({
  initialModules,
  initialCustomModules,
}: {
  /** Stored overrides. A module missing from the map counts as enabled. */
  initialModules: Record<string, boolean>;
  initialCustomModules: CaddyCustomModule[];
}) {
  const [modules, setModules] = useState<Record<string, boolean>>(() => {
    const resolved: Record<string, boolean> = {};
    for (const module of CADDY_MODULES) {
      resolved[module.id] = initialModules[module.id] !== false;
    }
    return resolved;
  });
  // Rows carry a client-only id because they have no server identity until
  // they are saved, and reordering or deleting by array index makes React
  // recycle inputs into the wrong row mid-edit.
  const [customModules, setCustomModules] = useState<CustomModuleRow[]>(() =>
    initialCustomModules.map((entry) => ({ ...entry, uid: nextRowId() })),
  );
  const [build, setBuild] = useState<BuildResponse | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  // Errors from the trigger request itself, which never reach the status file.
  const [rebuildError, setRebuildError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/caddy-build");
      if (res.ok) setBuild(await res.json());
    } catch {
      // A failed poll is not worth interrupting the page for; the next tick retries.
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Poll only while the sidecar is working. A build takes minutes, so a slower
  // interval than the L4 banner's keeps the request count sane.
  const inFlight = build?.status.state === "pending" || build?.status.state === "building";
  useEffect(() => {
    if (!inFlight) return;
    const interval = setInterval(() => void fetchStatus(), 5000);
    return () => clearInterval(interval);
  }, [inFlight, fetchStatus]);

  const enabledCount = useMemo(
    () =>
      Object.values(modules).filter(Boolean).length + customModules.filter((c) => c.enabled).length,
    [modules, customModules],
  );

  // Previewed from the same field list the server builds from, so what is shown
  // is what the rebuild will actually pass to xcaddy.
  const previewSpecs = useMemo(() => {
    const builtIn = CADDY_MODULES.filter((m) => modules[m.id]).map((m) => m.modulePath);
    const custom = customModules
      .filter((c) => c.enabled && validateCustomModule(c) === null)
      .map(customModuleSpec);
    return Array.from(new Set([...builtIn, ...custom])).sort();
  }, [modules, customModules]);

  const dockerfilePreview = useMemo(
    () =>
      [
        "# The build argument the rebuild passes to docker/caddy/Dockerfile.",
        "# Copy this into your own build if you would rather not use the sidecar:",
        '#   docker compose build --build-arg CADDY_MODULES="..." caddy',
        "",
        "xcaddy build master \\",
        ...previewSpecs.map((spec) => `  --with ${spec} \\`),
        "  --output /usr/bin/caddy",
      ].join("\n"),
    [previewSpecs],
  );

  const handleRebuild = async () => {
    setRebuilding(true);
    setRebuildError(null);
    try {
      const res = await fetch("/api/caddy-build", { method: "POST" });
      if (!res.ok) {
        // Deliberately not left to the status poll. The failures that land here
        // — an invalid custom module, Caddy unreachable, an expired session —
        // all abort before the sidecar writes any status at all, and the poll
        // only runs while the status says pending/building. Without this the
        // spinner just stops and the button looks broken.
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setRebuildError(body?.error ?? `Rebuild could not be started (HTTP ${res.status}).`);
        return;
      }
      await fetchStatus();
    } catch (error) {
      setRebuildError(error instanceof Error ? error.message : "Rebuild could not be started.");
    } finally {
      setRebuilding(false);
    }
  };

  const addCustomModule = () =>
    setCustomModules((prev) => [
      ...prev,
      { modulePath: "", version: "", enabled: true, uid: nextRowId() },
    ]);

  const updateCustomModule = (uid: string, patch: Partial<CaddyCustomModule>) =>
    setCustomModules((prev) => prev.map((c) => (c.uid === uid ? { ...c, ...patch } : c)));

  const removeCustomModule = (uid: string) =>
    setCustomModules((prev) => prev.filter((c) => c.uid !== uid));

  return (
    <VStack gap={5}>
      {rebuildError && (
        <Banner status="error" title="Rebuild failed to start" description={rebuildError} />
      )}

      <RebuildBanner
        build={build}
        rebuilding={rebuilding}
        onRebuild={handleRebuild}
        inFlight={Boolean(inFlight)}
      />

      <Banner
        status="info"
        title="Plugins are compiled into Caddy"
        description="Turning a module off stops this app from generating config for it right away. Removing it from the binary — and adding a new one — needs a rebuild, which restarts the proxy."
      />

      {groupModules().map(([category, group]) => (
        <Card key={category} padding={4}>
          <VStack gap={3}>
            <HStack justify="between" align="center">
              <Text type="label" size="xsm" weight="semibold" color="secondary">
                {CATEGORY_LABELS[category]}
              </Text>
              <Badge label={`${group.filter((m) => modules[m.id]).length}/${group.length}`} />
            </HStack>
            <Divider />
            {group.map((module) => (
              <ModuleToggle
                key={module.id}
                module={module}
                value={modules[module.id] ?? true}
                onChange={(next) => setModules((prev) => ({ ...prev, [module.id]: next }))}
              />
            ))}
          </VStack>
        </Card>
      ))}

      <Card padding={4}>
        <VStack gap={3}>
          <Text type="label" size="xsm" weight="semibold" color="secondary">
            Custom modules
          </Text>
          <Divider />
          <Text type="body" size="xsm" color="secondary">
            Any Caddy plugin published as a Go module. Compiled from source at build time, so an
            unreachable or non-building module fails the rebuild — the running container is left
            untouched when that happens.
          </Text>

          {customModules.length === 0 && (
            <Text type="body" size="sm" color="secondary">
              No custom modules.
            </Text>
          )}

          {customModules.map((entry) => {
            const error = entry.modulePath.trim() ? validateCustomModule(entry) : null;
            return (
              <Card key={entry.uid} variant="muted" padding={3}>
                <VStack gap={2}>
                  <HStack gap={2} align="end" wrap="wrap">
                    <TextInput
                      label="Module path"
                      value={entry.modulePath}
                      onChange={(next) => updateCustomModule(entry.uid, { modulePath: next })}
                      placeholder="github.com/greenpau/caddy-security"
                      status={error ? { type: "error", message: error } : undefined}
                    />
                    <TextInput
                      label="Version"
                      value={entry.version ?? ""}
                      onChange={(next) => updateCustomModule(entry.uid, { version: next })}
                      placeholder="latest"
                      description="Tag, branch, or commit"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 />}
                      label="Remove"
                      isIconOnly
                      onClick={() => removeCustomModule(entry.uid)}
                    />
                  </HStack>
                  <Switch
                    label="Include in the build"
                    value={entry.enabled}
                    onChange={(next) => updateCustomModule(entry.uid, { enabled: next })}
                  />
                </VStack>
              </Card>
            );
          })}

          <HStack justify="start">
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus />}
              label="Add module"
              onClick={addCustomModule}
            />
          </HStack>
        </VStack>
      </Card>

      <CodeEditor
        label="Build command preview"
        language="dockerfile"
        value={dockerfilePreview}
        isReadOnly
        height="md"
        description={`${enabledCount} module(s) selected. This is exactly what the rebuild runs.`}
      />

      {/* Every control above is React state, so the values reach the server
          action through these hidden inputs rather than through the DOM. */}
      {CADDY_MODULES.map((module) => (
        <input
          key={module.id}
          type="hidden"
          name={`module:${module.id}`}
          value={modules[module.id] ? "on" : ""}
        />
      ))}
      <input
        type="hidden"
        name="customModulesJson"
        value={JSON.stringify(
          customModules.map(({ uid: _uid, ...entry }) => entry as CaddyCustomModule),
        )}
      />
    </VStack>
  );
}

function ModuleToggle({
  module,
  value,
  onChange,
}: {
  module: CaddyModuleDefinition;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <VStack gap={1}>
      <Switch label={module.name} value={value} onChange={onChange} />
      <Text type="body" size="xsm" color="secondary">
        {module.description}{" "}
        {module.docsUrl && (
          <Link href={module.docsUrl} target="_blank" rel="noreferrer">
            {module.modulePath}
          </Link>
        )}
      </Text>
    </VStack>
  );
}

function RebuildBanner({
  build,
  rebuilding,
  onRebuild,
  inFlight,
}: {
  build: BuildResponse | null;
  rebuilding: boolean;
  onRebuild: () => void;
  inFlight: boolean;
}) {
  if (!build) return null;
  const { diff, status } = build;

  if (!diff.needsRebuild && !inFlight && status.state !== "failed") {
    return (
      <Banner
        status="success"
        title="Caddy is running the selected modules"
        description={`${diff.appliedSpecs.length} module(s) compiled in.`}
      />
    );
  }

  const bannerStatus = status.state === "failed" ? "error" : inFlight ? "info" : "warning";

  return (
    <Banner
      status={bannerStatus}
      icon={inFlight ? <Spinner size="sm" /> : undefined}
      title={
        inFlight
          ? (status.message ?? "Rebuilding Caddy…")
          : status.state === "failed"
            ? "The last rebuild failed"
            : "Rebuild required"
      }
      description={
        <VStack gap={2}>
          {status.state === "failed" && status.error && (
            <Text type="body" size="xsm">
              {status.error}
            </Text>
          )}
          {diff.added.length > 0 && (
            <HStack gap={1} wrap="wrap" vAlign="center">
              <Text type="body" size="sm">
                Adding:
              </Text>
              {diff.added.map((spec) => (
                <Badge key={spec} label={spec} />
              ))}
            </HStack>
          )}
          {diff.removed.length > 0 && (
            <HStack gap={1} wrap="wrap" vAlign="center">
              <Text type="body" size="sm">
                Removing:
              </Text>
              {diff.removed.map((spec) => (
                <Badge key={spec} label={spec} />
              ))}
            </HStack>
          )}
          {!inFlight && (
            <Text type="body" size="xsm" color="secondary">
              Compiling Caddy takes several minutes. The proxy keeps serving on the current binary
              until the new one is ready, then restarts.
            </Text>
          )}
        </VStack>
      }
      endContent={
        <Button
          variant="secondary"
          size="sm"
          icon={<Hammer />}
          label="Rebuild Caddy"
          isLoading={rebuilding}
          isDisabled={rebuilding || inFlight}
          onClick={onRebuild}
        />
      }
    />
  );
}
