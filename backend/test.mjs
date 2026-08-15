import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "./validate.mjs";

test("valid payload passes", () => {
  assert.deepEqual(validate({ q: "hello", source: "en", target: "es" }), []);
});

test("missing q is rejected", () => {
  const errors = validate({ source: "en", target: "es" });
  assert.ok(errors.some((e) => e.includes("q")));
});

test("empty source is rejected", () => {
  const errors = validate({ q: "hi", source: " ", target: "es" });
  assert.ok(errors.some((e) => e.includes("source")));
});

test("empty target is rejected", () => {
  const errors = validate({ q: "hi", source: "en", target: "" });
  assert.ok(errors.some((e) => e.includes("target")));
});

test("unsupported format is rejected", () => {
  const errors = validate({ q: "hi", source: "en", target: "es", format: "xml" });
  assert.ok(errors.some((e) => e.includes("format")));
});

test("oversized q is rejected", () => {
  const errors = validate({ q: "x".repeat(5001), source: "en", target: "es" });
  assert.ok(errors.some((e) => e.includes("5000")));
});
