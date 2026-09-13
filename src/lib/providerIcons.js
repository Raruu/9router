import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

const ICON_DIR = path.join(DATA_DIR, "provider-icons");
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_INPUT_PIXELS = 4_000_000;
const MAX_DIMENSION = 256;
const COMPATIBLE_NODE_ID = /^(?:openai|anthropic)-compatible-[a-z0-9-]+$/;

function assertCompatibleNodeId(id) {
  if (!COMPATIBLE_NODE_ID.test(id || "")) throw new Error("Invalid provider icon id");
}

function iconPath(id) {
  assertCompatibleNodeId(id);
  return path.join(ICON_DIR, `${id}.webp`);
}

export function isCompatibleProviderIconNode(node) {
  return node?.type === "openai-compatible" || node?.type === "anthropic-compatible";
}

export function getProviderIconVersion(node) {
  return Number.isSafeInteger(node?.iconVersion) && node.iconVersion > 0 ? node.iconVersion : null;
}

export const PROVIDER_ICON_LIMITS = { MAX_UPLOAD_BYTES, MAX_INPUT_PIXELS, MAX_DIMENSION };

export async function readProviderIcon(id) {
  try {
    return await fs.readFile(iconPath(id));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteProviderIcon(id) {
  await fs.rm(iconPath(id), { force: true });
}

export async function moveProviderIcon(fromId, toId) {
  const source = iconPath(fromId);
  const target = iconPath(toId);
  try {
    await fs.mkdir(ICON_DIR, { recursive: true });
    await fs.rename(source, target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function convertProviderIcon(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new Error("Choose an image to upload");
  if (input.length > MAX_UPLOAD_BYTES) throw new Error("Icon must be 3 MB or smaller");

  const { default: sharp } = await import("sharp");
  const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning", animated: false });
  const metadata = await image.metadata();
  if (!metadata.format || !["jpeg", "png", "webp", "svg"].includes(metadata.format)) {
    throw new Error("Icon must be a PNG, JPEG, WebP, or SVG image");
  }
  if (metadata.pages && metadata.pages > 1) throw new Error("Animated icons are not supported");

  return image
    .autoOrient()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, preset: "icon", effort: 4 })
    .toBuffer();
}

export async function saveProviderIcon(id, input) {
  const icon = await convertProviderIcon(input);
  const destination = iconPath(id);
  await fs.mkdir(ICON_DIR, { recursive: true });
  const temporary = path.join(ICON_DIR, `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, icon, { mode: 0o600 });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return icon;
}
