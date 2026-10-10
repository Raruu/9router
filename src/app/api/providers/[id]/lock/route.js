import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/models";
import { toProviderConnectionResponse } from "@/lib/providerConnectionResponse";
import { buildModelLockUpdate, buildClearModelLocksUpdate } from "open-sse/services/accountFallback.js";

// Manual connection lock bounds (account-level: blocks every model for the
// connection via the modelLock___all key).
export const MANUAL_LOCK_MIN_MS = 60 * 1000;
export const MANUAL_LOCK_MAX_MS = 30 * 24 * 60 * 60 * 1000;

function parseDurationMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < MANUAL_LOCK_MIN_MS || n > MANUAL_LOCK_MAX_MS) return null;
  return n;
}

// POST /api/providers/[id]/lock - Manually lock or unlock a connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { action } = body;

    if (action !== "lock" && action !== "unlock") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const existing = await getProviderConnectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    let updated;
    if (action === "lock") {
      const durationMs = parseDurationMs(body.durationMs);
      if (durationMs === null) {
        return NextResponse.json(
          { error: `durationMs must be a whole number between ${MANUAL_LOCK_MIN_MS} and ${MANUAL_LOCK_MAX_MS}` },
          { status: 400 }
        );
      }
      updated = await updateProviderConnection(id, {
        ...buildModelLockUpdate(null, durationMs),
        testStatus: "unavailable",
        lastError: "Manually locked",
        errorCode: 423,
        lastErrorAt: new Date().toISOString(),
      });
    } else {
      // Clear every model lock on the connection and reset its health state.
      updated = await updateProviderConnection(id, {
        ...buildClearModelLocksUpdate(existing),
        testStatus: "active",
        lastError: null,
        errorCode: null,
        lastErrorAt: null,
        backoffLevel: 0,
      });
    }

    return NextResponse.json({ connection: toProviderConnectionResponse(updated) });
  } catch (error) {
    console.log("Error locking connection:", error);
    return NextResponse.json({ error: "Failed to update connection lock" }, { status: 500 });
  }
}