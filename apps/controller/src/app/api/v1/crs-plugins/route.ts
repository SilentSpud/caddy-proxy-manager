import { type NextRequest, NextResponse } from "next/server";
import { requireApiAdmin, apiErrorResponse } from "@/src/lib/api-auth";
import { installCrsPlugin, listCrsPlugins } from "@/src/lib/models/crs-plugins";

export async function GET(request: NextRequest) {
  try {
    await requireApiAdmin(request);
    return NextResponse.json(await listCrsPlugins());
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireApiAdmin(request);
    const body = await request.json();
    if (typeof body?.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const plugin = await installCrsPlugin(body.name.trim(), userId);
    return NextResponse.json(plugin, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
