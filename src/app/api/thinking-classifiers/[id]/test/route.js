import { NextResponse } from "next/server";
import { getThinkingClassifierById } from "@/lib/db/index.js";
import { classifyWithProfile } from "@/sse/services/thinkingClassifier.js";

// POST /api/thinking-classifiers/[id]/test
// Run the profile against a sample prompt and return the raw System One answers
// plus the level it resolves to — the management page's Test box. Never touches
// routing state (classifyWithProfile is fail-open and does not lock accounts).
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const classifier = await getThinkingClassifierById(id);
    if (!classifier) {
      return NextResponse.json({ error: "Classifier not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "Test text is required" }, { status: 400 });
    }

    const result = await classifyWithProfile({
      profile: classifier,
      body: { messages: [{ role: "user", content: text }] },
    });

    return NextResponse.json({
      level: result.level,
      answers: result.answers,
      latencyMs: result.latencyMs,
      error: result.error,
    });
  } catch (error) {
    console.log("Error testing thinking classifier:", error);
    return NextResponse.json({ error: "Failed to test thinking classifier" }, { status: 500 });
  }
}
