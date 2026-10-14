import test from "node:test";
import assert from "node:assert/strict";
import builderDrafts from "../lib/workflows/builder-drafts.cjs";

const step = (id = 1) => ({ id, kind: "Trigger", title: "Start", detail: "Begin workflow" });
const draft = (name, steps = [step()]) => ({ name, steps });

test("normalizes names consistently and enforces the storage name limit", () => {
  assert.equal(builderDrafts.normalizeDraftName("  Follow-up  "), "Follow-up");
  assert.equal(builderDrafts.normalizeDraftName("x".repeat(90)).length, 80);
  assert.equal(builderDrafts.normalizeDraftName(null), "");
});

test("loads valid current-format drafts and derives safe keys from their names", () => {
  const drafts = builderDrafts.loadBuilderDrafts(JSON.stringify({
    untrustedKey: draft("  __proto__  "),
    anotherKey: draft("Sales follow-up")
  }), null);
  assert.equal(Object.getPrototypeOf(drafts), null);
  assert.equal(Object.hasOwn(drafts, "__proto__"), true);
  assert.equal(drafts["__proto__"].name, "__proto__");
  assert.equal(drafts["sales follow-up"].name, "Sales follow-up");
});

test("recovers a valid legacy draft when current-format storage is malformed", () => {
  const drafts = builderDrafts.loadBuilderDrafts("{not-json", JSON.stringify(draft("Legacy recovery")));
  assert.equal(drafts["legacy recovery"].name, "Legacy recovery");
});

test("ignores malformed legacy storage without losing current-format drafts", () => {
  const drafts = builderDrafts.loadBuilderDrafts(JSON.stringify({ key: draft("Current draft") }), "{not-json");
  assert.equal(drafts["current draft"].name, "Current draft");
});

test("rejects unsafe step data and duplicate IDs", () => {
  assert.equal(builderDrafts.isValidDraftSteps([step(), step()]), false);
  assert.equal(builderDrafts.isValidDraftSteps([{ ...step(), id: -1 }]), false);
  assert.equal(builderDrafts.isValidDraftSteps([{ ...step(), kind: "ExecuteAnything" }]), false);
  assert.equal(builderDrafts.isValidDraftSteps([]), false);
  assert.equal(builderDrafts.isValidDraftSteps(Array.from({ length: 101 }, (_, i) => step(i))), false);
});

test("allocates unique safe IDs when rapid additions share a timestamp", () => {
  const first = builderDrafts.allocateStepIds([step(100), step(101)], 3, 100);
  assert.deepEqual(first, [102, 103, 104]);

  // The allocator deliberately remembers IDs across calls so two UI additions
  // made before React state refreshes cannot receive the same ID.
  const second = builderDrafts.allocateStepIds([], 3, 100);
  assert.equal(second.length, 3);
  assert.equal(new Set(second).size, 3);
  assert.equal(second.some(id => first.includes(id)), false);
});

test("step ID allocator handles invalid timestamps, unsafe boundaries, and invalid counts", () => {
  assert.deepEqual(builderDrafts.allocateStepIds([step(0)], 2, Number.MAX_SAFE_INTEGER), [Number.MAX_SAFE_INTEGER, 1]);
  const invalidTimestampId = builderDrafts.allocateStepIds([], 1, -1);
  assert.equal(invalidTimestampId.length, 1);
  assert.equal(Number.isSafeInteger(invalidTimestampId[0]), true);
  assert.ok(invalidTimestampId[0] >= 0);
  assert.deepEqual(builderDrafts.allocateStepIds([], 101, 10), []);
});

test("current-format draft takes precedence over a legacy draft with the same normalized name", () => {
  const drafts = builderDrafts.loadBuilderDrafts(
    JSON.stringify({ key: draft("Same name", [step(2)]) }),
    JSON.stringify(draft(" same name ", [step(3)]))
  );
  assert.equal(drafts["same name"].steps[0].id, 2);
});

test("separate allocator calls stay unique when React state has not refreshed", () => {
  const first = builderDrafts.allocateStepIds([], 1, 500);
  const second = builderDrafts.allocateStepIds([], 1, 500);
  assert.equal(first[0], 500);
  assert.equal(second[0], 501);
});
