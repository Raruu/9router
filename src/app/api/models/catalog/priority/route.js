import { NextResponse } from "next/server";
import { errorResponse, setPriority } from "../_backend.js";

export async function PUT(request) {
  try {
    const body = await request.json();
    await setPriority(body?.priority);
    return NextResponse.json({ success: true, priority: body.priority });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
