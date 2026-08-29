import { type NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { getCaddyBuildDiff, sanitizeCaddyBuildSettings } from "@/src/lib/caddy-build";
import { describeModuleConflicts } from "@/src/lib/caddy-build-conflicts";
import { applyCaddyConfig } from "@/src/lib/caddy";
import { CADDY_MODULES } from "@/src/lib/caddy-modules";
import { getCaddyBuildSettings, saveCaddyBuildSettings } from "@/src/lib/settings";

/**
 * GET /api/v1/caddy/modules — the module catalog, the current selection, and how it differs from
 * the running image. The catalog ships along because module ids are what PUT expects.
 */
export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const [settings, diff] = await Promise.all([getCaddyBuildSettings(), getCaddyBuildDiff()]);
    return NextResponse.json({
      available: CADDY_MODULES.map((m) => ({
        id: m.id,
        name: m.name,
        modulePath: m.modulePath,
        description: m.description,
        category: m.category,
        features: m.features,
      })),
      selection: {
        modules: settings?.modules ?? {},
        customModules: settings?.customModules ?? [],
      },
      diff,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * PUT /api/v1/caddy/modules — replace the selection. Does not rebuild: the running container keeps
 * its module set until POST /api/caddy-build. The returned diff says what a rebuild would change.
 */
export async function PUT(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    const body = await request.json();
    const settings = sanitizeCaddyBuildSettings({
      modules: body?.modules,
      customModules: body?.customModules,
    });

    // The same refusal the Settings UI applies. Without it this endpoint is a way around the
    // guard: disabling a module something still uses would be accepted here, and the config
    // builder would then quietly stop emitting that feature's handlers.
    const conflict = await describeModuleConflicts(settings);
    if (conflict) {
      return NextResponse.json({ error: conflict }, { status: 409 });
    }

    await saveCaddyBuildSettings(settings);

    // Regenerate the config so it stops naming any module just switched off, matching what the
    // Settings save does. A stale config would hand the next rebuild something its binary can't
    // load.
    await applyCaddyConfig();

    return NextResponse.json({ selection: settings, diff: await getCaddyBuildDiff() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
