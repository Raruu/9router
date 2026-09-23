import { NextResponse } from "next/server";
import {
  clearUsageHistory, clearRequestDetails, clearRequestDetailContent, CONTENT_SECTIONS,
} from "@/lib/usageDb";
import { getDbFileSize, checkpointDb } from "@/lib/db/helpers/maintenance.js";

const TARGETS = new Set(["overview", "details", "details-content"]);

/**
 * POST /api/usage/purge
 * Body: { target: "overview" | "details" | "details-content", sections?: string[] }
 *
 * "overview"        wipes usageHistory + usageDaily + the lifetime counter
 *                   (Overview cards/charts/tables and the Logs view).
 * "details"         wipes every stored request detail row.
 * "details-content" replaces the stored payloads of the given `sections`
 *                   (subset of request/providerRequest/providerResponse/response)
 *                   with { redacted: true } on every row, keeping the rows and
 *                   their metadata (tokens/latency/status) intact.
 *
 * API-key quota counters are untouched by all targets. Auth is handled by
 * dashboardGuard (/api/usage is protected).
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const target = body?.target;

    if (!TARGETS.has(target)) {
      return NextResponse.json(
        { error: 'target must be "overview", "details" or "details-content"' },
        { status: 400 }
      );
    }

    let sections = null;
    if (target === "details-content") {
      const requested = Array.isArray(body?.sections) ? body.sections : [];
      sections = [...new Set(requested)].filter((s) => CONTENT_SECTIONS.includes(s));
      if (!sections.length) {
        return NextResponse.json(
          { error: `sections must contain at least one of: ${CONTENT_SECTIONS.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Size is read around the purge (VACUUM inside makes the file shrink, so the
    // after value must be sampled once the call resolves). The WAL is flushed
    // first or rows still in it make "before" under-report. null when the file
    // is unavailable (sql.js in-memory or a stat failure).
    await checkpointDb();
    const sizeBefore = getDbFileSize();

    let result;
    if (target === "overview") result = { deleted: (await clearUsageHistory()).deleted };
    else if (target === "details") result = { deleted: (await clearRequestDetails()).deleted };
    else result = { updated: (await clearRequestDetailContent(sections)).updated, sections };

    const sizeAfter = getDbFileSize();

    return NextResponse.json({ success: true, target, ...result, sizeBefore, sizeAfter });
  } catch (error) {
    console.error("[API] Failed to purge usage data:", error);
    return NextResponse.json({ error: "Failed to purge usage data" }, { status: 500 });
  }
}
