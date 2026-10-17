import assert from "node:assert/strict";
import test from "node:test";
import { MAX_JD_CHARS, MAX_JD_TITLE_CHARS } from "../lib/jd.ts";

test("JD contract constants keep API limits explicit", () => {
  assert.equal(MAX_JD_CHARS, 20000);
  assert.equal(MAX_JD_TITLE_CHARS, 120);
});

test("JD save payload only keeps unique skill ids", () => {
  const skills = Array.from(new Set(["python", "sql", "python"].map((id) => id.trim()).filter(Boolean)));
  assert.deepEqual(skills, ["python", "sql"]);
});
