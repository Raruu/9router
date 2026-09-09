import { NextResponse } from "next/server";
import {
  CatalogBackendError,
  clearOpenRouter,
  deleteOpenRouterEntry,
  errorResponse,
  replaceOpenRouter,
  validateOpenRouterResponse,
} from "../_backend.js";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const FETCH_TIMEOUT_MS = 30_000;

export async function POST() {
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new CatalogBackendError(`OpenRouter returned HTTP ${response.status}`, 502);
    }
    const models = validateOpenRouterResponse(await response.json());
    const fetchedAt = new Date().toISOString();
    const result = await replaceOpenRouter(models, fetchedAt);
    return NextResponse.json({ success: true, count: result.count, sourceCount: models.length, fetchedAt });
  } catch (error) {
    const normalized = error?.name === "TimeoutError"
      ? new CatalogBackendError("OpenRouter request timed out", 504)
      : error;
    const { status, body } = errorResponse(normalized);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request) {
  try {
    const pattern = new URL(request.url).searchParams.get("pattern");
    if (pattern) await deleteOpenRouterEntry({ pattern });
    else await clearOpenRouter();
    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
