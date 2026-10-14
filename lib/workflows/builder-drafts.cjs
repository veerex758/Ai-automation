const MAX_STEPS = 100;
const STEP_KINDS = new Set(["Trigger", "Action", "Condition"]);
let lastAllocatedId = -1;

function normalizeDraftName(value) {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function isValidDraftSteps(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STEPS) return false;
  const ids = new Set();
  return value.every((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return false;
    const { id, kind, title, detail } = step;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) return false;
    if (!STEP_KINDS.has(kind) || typeof title !== "string" || !title.trim() || typeof detail !== "string") return false;
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
}

function allocateStepIds(existingSteps, count = 1, now = Date.now()) {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_STEPS) return [];
  const used = new Set(
    (Array.isArray(existingSteps) ? existingSteps : [])
      .filter((step) => step && typeof step.id === "number" && Number.isSafeInteger(step.id) && step.id >= 0)
      .map((step) => step.id)
  );
  const ids = [];
  let candidate = Math.max(Number.isSafeInteger(now) && now >= 0 ? now : 0, lastAllocatedId >= Number.MAX_SAFE_INTEGER ? 0 : lastAllocatedId + 1);
  while (ids.length < count) {
    if (!used.has(candidate)) {
      ids.push(candidate);
      used.add(candidate);
      lastAllocatedId = candidate;
    }
    candidate = candidate >= Number.MAX_SAFE_INTEGER ? 0 : candidate + 1;
  }
  return ids;
}

function addCurrentDrafts(drafts, raw) {
  if (!raw) return;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  for (const value of Object.values(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const name = normalizeDraftName(value.name);
    if (!name || !isValidDraftSteps(value.steps)) continue;
    const key = name.toLocaleLowerCase();
    if (key) drafts[key] = { name, steps: value.steps };
  }
}

function addLegacyDraft(drafts, raw) {
  if (!raw) return;
  const legacy = JSON.parse(raw);
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return;
  const name = normalizeDraftName(legacy.name);
  if (!name || !isValidDraftSteps(legacy.steps)) return;
  const key = name.toLocaleLowerCase();
  if (key && !Object.hasOwn(drafts, key)) drafts[key] = { name, steps: legacy.steps };
}

function loadBuilderDrafts(currentRaw, legacyRaw) {
  // A null-prototype map makes user-controlled names such as "__proto__" safe keys.
  const drafts = Object.create(null);
  try {
    addCurrentDrafts(drafts, currentRaw);
  } catch {
    // Corrupt current-format data must not prevent legacy recovery.
  }
  try {
    addLegacyDraft(drafts, legacyRaw);
  } catch {
    // A malformed legacy entry must not block valid current-format drafts.
  }
  return drafts;
}


function isWorkflowSummaryItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return typeof item.id === "number" &&
    typeof item.name === "string" &&
    typeof item.description === "string" &&
    typeof item.category === "string" &&
    ["Active", "Draft", "Paused"].includes(String(item.status)) &&
    typeof item.runs === "string" &&
    typeof item.updated === "string" &&
    typeof item.icon === "string" &&
    typeof item.tone === "string";
}

function persistBuilderDraft(storage, currentDrafts, name, steps) {
  if (!isValidDraftSteps(steps)) {
    throw new TypeError("Cannot persist an invalid workflow draft.");
  }
  const draftName = normalizeDraftName(name) || "Untitled workflow";
  const draftKey = draftName.toLocaleLowerCase();
  const updatedDrafts = Object.assign(Object.create(null),
    currentDrafts && typeof currentDrafts === "object" ? currentDrafts : {});
  updatedDrafts[draftKey] = { name: draftName, steps };

  // Persist the canonical canvas first. Failure here is allowed to throw so the
  // caller never reports a successful save when the source of truth was not saved.
  storage.setItem("aivanta-builder-drafts", JSON.stringify(updatedDrafts));

  // Compatibility-only storage must not invalidate a successful canonical save.
  try {
    storage.setItem("aivanta-builder-draft", JSON.stringify({ name: draftName, steps }));
  } catch {
    // Older builder versions may not receive a compatibility copy.
  }

  let existing = [];
  try {
    const raw = storage.getItem("aivanta-workflows");
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) existing = parsed.filter(isWorkflowSummaryItem);
  } catch {
    // The dashboard summary cache is optional and can be rebuilt from future saves.
  }

  const normalizedName = draftName.toLocaleLowerCase();
  const next = existing.filter(item => item.name.toLocaleLowerCase() !== normalizedName);
  next.unshift({
    id: Date.now(),
    name: draftName,
    description: `${steps.length} steps · Visual workflow draft`,
    category: "Operations",
    status: "Draft",
    runs: "—",
    updated: "Just now",
    icon: "✳",
    tone: "lime"
  });

  let summaryUpdated = true;
  try {
    storage.setItem("aivanta-workflows", JSON.stringify(next));
  } catch {
    summaryUpdated = false;
  }
  return { draftName, drafts: updatedDrafts, summaryUpdated };
}

module.exports = { normalizeDraftName, isValidDraftSteps, allocateStepIds, loadBuilderDrafts, persistBuilderDraft };
