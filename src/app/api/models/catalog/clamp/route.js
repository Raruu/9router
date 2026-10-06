import { NextResponse } from "next/server";
import { errorResponse, setClampMaxOutput } from "../_backend.js";

export async function PUT(request) {
  try {
    const body = await request.json();
    await setClampMaxOutput(body?.clampMaxOutput);
    return NextResponse.json({ success: true, clampMaxOutput: body.clampMaxOutput });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
