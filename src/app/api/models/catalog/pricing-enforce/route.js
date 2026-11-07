import { NextResponse } from "next/server";
import { errorResponse, setEnforcePricing } from "../_backend.js";

export async function PUT(request) {
  try {
    const body = await request.json();
    await setEnforcePricing(body?.pricingEnforce);
    return NextResponse.json({ success: true, pricingEnforce: body.pricingEnforce });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
