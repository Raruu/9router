import { NextResponse } from "next/server";
import {
  deleteUserEntry,
  errorResponse,
  saveUserEntry,
  updateUserEntry,
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

export async function PUT(request) {
  try {
    const body = await request.json();
    const entry = validateUserEntry(body);
    return NextResponse.json({
      success: true,
      entry: await updateUserEntry(body?.originalIdentity, entry),
    });
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
