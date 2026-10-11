import { NextResponse } from "next/server";
import {
  getThinkingClassifierById,
  getThinkingClassifierByName,
  updateThinkingClassifier,
  deleteThinkingClassifier,
} from "@/lib/db/index.js";
import { normalizeClassifierInput } from "../route.js";

// GET /api/thinking-classifiers/[id]
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const classifier = await getThinkingClassifierById(id);
    if (!classifier) {
      return NextResponse.json({ error: "Classifier not found" }, { status: 404 });
    }
    return NextResponse.json({ classifier });
  } catch (error) {
    console.log("Error fetching thinking classifier:", error);
    return NextResponse.json({ error: "Failed to fetch thinking classifier" }, { status: 500 });
  }
}

// PUT /api/thinking-classifiers/[id] - full replace of the editable fields
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getThinkingClassifierById(id);
    if (!existing) {
      return NextResponse.json({ error: "Classifier not found" }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    // Keep the stored name when the payload omits it (toggle-active updates).
    const normalized = normalizeClassifierInput({ ...body, name: body.name ?? existing.name });
    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    const duplicate = await getThinkingClassifierByName(normalized.value.name);
    if (duplicate && duplicate.id !== id) {
      return NextResponse.json({ error: `Classifier "${normalized.value.name}" already exists` }, { status: 409 });
    }
    const classifier = await updateThinkingClassifier(id, normalized.value);
    return NextResponse.json({ classifier });
  } catch (error) {
    console.log("Error updating thinking classifier:", error);
    return NextResponse.json({ error: "Failed to update thinking classifier" }, { status: 500 });
  }
}

// DELETE /api/thinking-classifiers/[id]
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteThinkingClassifier(id);
    if (!deleted) {
      return NextResponse.json({ error: "Classifier not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting thinking classifier:", error);
    return NextResponse.json({ error: "Failed to delete thinking classifier" }, { status: 500 });
  }
}
