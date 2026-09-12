import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getProviderNodeById, updateProviderNode } from "@/models";
import { deleteProviderIcon, getProviderIconVersion, isCompatibleProviderIconNode, readProviderIcon, saveProviderIcon } from "@/lib/providerIcons.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getNode(id) {
  const node = await getProviderNodeById(id);
  if (!node || !isCompatibleProviderIconNode(node)) return null;
  return node;
}

function notFound() {
  return NextResponse.json({ error: "Custom provider not found" }, { status: 404 });
}

// GET /api/provider-nodes/[id]/icon - Serve a user-uploaded WebP icon.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const node = await getNode(id);
    if (!node) return notFound();
    const icon = await readProviderIcon(id);
    if (!icon) return notFound();
    const etag = `"${crypto.createHash("sha256").update(icon).digest("hex")}"`;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return new Response(icon, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(icon.length),
        "Cache-Control": "private, max-age=31536000, immutable",
        ETag: etag,
      },
    });
  } catch (error) {
    console.log("Error reading provider icon:", error);
    return NextResponse.json({ error: "Failed to read provider icon" }, { status: 500 });
  }
}

// PUT /api/provider-nodes/[id]/icon - Convert a raster or SVG upload to WebP.
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const node = await getNode(id);
    if (!node) return notFound();
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 3 * 1024 * 1024 + 32 * 1024) {
      return NextResponse.json({ error: "Icon must be 3 MB or smaller" }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("icon");
    if (!file || typeof file.arrayBuffer !== "function") return NextResponse.json({ error: "Choose an image to upload" }, { status: 400 });
    const icon = await saveProviderIcon(id, Buffer.from(await file.arrayBuffer()));
    const updated = await updateProviderNode(id, { iconVersion: Math.max(Date.now(), (getProviderIconVersion(node) || 0) + 1) });
    return NextResponse.json({ iconVersion: getProviderIconVersion(updated), bytes: icon.length });
  } catch (error) {
    const message = error?.message || "Failed to upload provider icon";
    const status = /3 MB/.test(message) ? 413 : /pixel|image|icon/i.test(message) ? 400 : 500;
    console.log("Error saving provider icon:", error);
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE /api/provider-nodes/[id]/icon - Restore the generic compatible icon.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const node = await getNode(id);
    if (!node) return notFound();
    await deleteProviderIcon(id);
    await updateProviderNode(id, { iconVersion: null });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting provider icon:", error);
    return NextResponse.json({ error: "Failed to delete provider icon" }, { status: 500 });
  }
}
