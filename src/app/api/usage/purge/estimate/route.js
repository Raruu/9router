import { NextResponse } from "next/server";
import { flushRequestDetails } from "@/lib/usageDb";
import { estimatePurgeSize } from "@/lib/db/helpers/maintenance.js";
import { PURGE_TARGETS, CONTENT_SECTIONS, normalizeSections } from "@/lib/db/helpers/purgeOps.js";

/**
 * POST /api/usage/purge/estimate
 * Body: { target: "overview" | "details" | "details-content", sections?: string[] }
 *
 * Dry-runs the purge on a temporary copy of the DB (VACUUM INTO + ATTACH +
 * VACUUM) and returns the size that copy ends up at. The live DB is never
 * modified. Returns sizeAfter: null with a `reason` when an estimate is not
 * possible (unsupported driver, too large, no temp space, failure).
 *
 * Auth is handled by dashboardGuard (/api/usage is protected).
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const target = body?.target;

    if (!PURGE_TARGETS.includes(target)) {
      return NextResponse.json(
        { error: `target must be one of: ${PURGE_TARGETS.join(", ")}` },
        { status: 400 }
      );
    }

    let sections = null;
    if (target === "details-content") {
      sections = normalizeSections(body?.sections);
      if (!sections.length) {
        return NextResponse.json(
          { error: `sections must contain at least one of: ${CONTENT_SECTIONS.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Match the real purge's view of the data: buffered details would be flushed
    // (or redacted) by it, so they must be in the snapshot the estimate measures.
    if (target !== "overview") await flushRequestDetails();

    const { sizeBefore, sizeAfter, reason } = await estimatePurgeSize(target, sections);
    return NextResponse.json({ success: true, target, sizeBefore, sizeAfter, reason });
  } catch (error) {
    console.error("[API] Failed to estimate purge size:", error);
    return NextResponse.json({ error: "Failed to estimate purge size" }, { status: 500 });
  }
}
