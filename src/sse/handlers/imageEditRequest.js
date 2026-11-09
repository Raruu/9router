// /v1/images/edits request parsing.
//
// The standard edit contract is multipart/form-data: `image` (file), `prompt`,
// and an edit-capable `model`; optional `mask`, `n`, `size`, `quality`,
// `background`, `input_fidelity`, and `response_format`. The upstream is the
// provider's /images/edits endpoint, which on async gateways answers with the
// same image job as generations.
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

export const IMAGE_EDIT_MAX_FILES = 10;
export const IMAGE_EDIT_MAX_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const STRING_FIELDS = ["size", "quality", "background", "input_fidelity", "output_format", "response_format"];

const isFile = (value) => typeof File !== "undefined" && value instanceof File;

// Accept a data-URL string where the spec wants a file (some clients inline the
// source image). Bare http(s) URLs are rejected here: forwarding them would make
// the upstream fetch an arbitrary URL on our behalf.
function fileFromDataUrl(value) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(value || "").trim());
  if (!match) return null;
  try {
    return new File([Buffer.from(match[2], "base64")], "image", { type: match[1].toLowerCase() });
  } catch {
    return null;
  }
}

function asFile(value) {
  if (isFile(value) && value.size > 0) return value;
  if (typeof value === "string" && value.trim()) return fileFromDataUrl(value);
  return null;
}

function validateFile(file, label) {
  if (!ALLOWED_IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
    return `Unsupported ${label} type: ${file.type || "unknown"} (use PNG, JPEG, WebP or GIF)`;
  }
  if (file.size > IMAGE_EDIT_MAX_FILE_BYTES) {
    return `${label} is too large (${Math.round(file.size / 1024 / 1024)}MB; max ${IMAGE_EDIT_MAX_FILE_BYTES / 1024 / 1024}MB)`;
  }
  return null;
}

/**
 * Parse a /v1/images/edits request into the body shape the image adapters use.
 * Returns { body } or { error, status }.
 */
export async function parseImageEditRequestBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return {
      error: "Image edits require multipart/form-data with an `image` file (use /v1/images/generations for JSON text-to-image)",
      status: HTTP_STATUS.BAD_REQUEST,
    };
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return { error: "Invalid multipart/form-data body", status: HTTP_STATUS.BAD_REQUEST };
  }

  const images = [];
  for (const key of ["image", "image[]", "images", "images[]"]) {
    for (const value of form.getAll(key)) {
      const file = asFile(value);
      if (!file) continue;
      const problem = validateFile(file, "image");
      if (problem) return { error: problem, status: HTTP_STATUS.BAD_REQUEST };
      images.push(file);
    }
  }
  if (images.length === 0) {
    return { error: "Missing required field: image", status: HTTP_STATUS.BAD_REQUEST };
  }
  if (images.length > IMAGE_EDIT_MAX_FILES) {
    return {
      error: `Too many images: ${images.length} (max ${IMAGE_EDIT_MAX_FILES})`,
      status: HTTP_STATUS.BAD_REQUEST,
    };
  }

  let mask = null;
  const rawMask = form.get("mask");
  if (rawMask != null) {
    mask = asFile(rawMask);
    if (!mask) return { error: "Invalid mask: expected an image file", status: HTTP_STATUS.BAD_REQUEST };
    const problem = validateFile(mask, "mask");
    if (problem) return { error: problem, status: HTTP_STATUS.BAD_REQUEST };
  }

  const readString = (name) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };

  const body = {
    model: readString("model"),
    prompt: readString("prompt"),
    image: images[0],
    images,
    mask,
  };
  const n = Number(readString("n"));
  if (Number.isSafeInteger(n) && n > 0 && n <= IMAGE_EDIT_MAX_FILES) body.n = n;
  for (const field of STRING_FIELDS) {
    const value = readString(field);
    if (value) body[field] = value;
  }

  return { body };
}
