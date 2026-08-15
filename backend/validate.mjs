export const SUPPORTED_FORMATS = new Set(["text", "html"]);
export const MAX_CHARS = 5000;

export function validate(payload) {
  const errors = [];
  if (typeof payload.q !== "string" || payload.q.trim().length === 0) {
    errors.push("q (text to translate) is required and must be a non-empty string");
  } else if (payload.q.length > MAX_CHARS) {
    errors.push(`q exceeds maximum of ${MAX_CHARS} characters`);
  }
  if (typeof payload.source !== "string" || payload.source.trim().length === 0) {
    errors.push("source language code is required");
  }
  if (typeof payload.target !== "string" || payload.target.trim().length === 0) {
    errors.push("target language code is required");
  }
  if (payload.format !== undefined && !SUPPORTED_FORMATS.has(payload.format)) {
    errors.push(`format must be one of: ${[...SUPPORTED_FORMATS].join(", ")}`);
  }
  return errors;
}
