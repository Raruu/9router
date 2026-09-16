import { NextResponse } from "next/server";
import { supportsProviderModelsListing } from "../[id]/models/route.js";

export const dynamic = "force-dynamic";

// GET /api/providers/models-support?provider=<id> - whether the provider has
// a live /models listing backend (PROVIDER_MODELS_CONFIG). No upstream I/O.
export async function GET(request) {
  const provider = new URL(request.url).searchParams.get("provider") || "";
  return NextResponse.json({ supported: supportsProviderModelsListing(provider) });
}
