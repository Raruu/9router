import { NextResponse } from "next/server";
import {
  deleteUserEntry,
  errorResponse,
  saveUserEntry,
  validateUserEntry,
} from "../_backend.js";

export async function POST(request) {
  try {
    const entry = validateUserEntry(await request.json());
    return NextResponse.json({ success: true, entry: await saveUserEntry(entry) });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request) {
  try {
    const identity = await request.json();
    await deleteUserEntry(identity);
    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
