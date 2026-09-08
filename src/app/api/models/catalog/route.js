import { NextResponse } from "next/server";
import { errorResponse, getCatalog } from "./_backend.js";

export async function GET() {
  try {
    return NextResponse.json(await getCatalog());
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
