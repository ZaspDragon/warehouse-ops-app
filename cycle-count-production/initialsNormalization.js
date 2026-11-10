"use strict";

/*
 * Make Already Cycle Counted initials case-insensitive and letter-only.
 * Examples: "AB", "ab", "A.B.", and "a b" all normalize to "ab".
 */
(() => {
  acNormalizeInitials = function normalizeInitialsLettersOnly(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  };

  const canonicalInitialsByName = Object.freeze({
    carico: "ch",
    ernie: "eh",
    cherish: "cc",
    layne: "lm",
    madison: "mj",
    antoine: "ah",
    greg: "gr",
    denise: "dw",
  });

  const originalGetInitials = acGetInitials;
  acGetInitials = function getCanonicalInitials(assignment) {
    const name = String(assignment?.name ?? "").trim().toLowerCase();
    const canonical = canonicalInitialsByName[name];
    if (canonical) return canonical;
    return acNormalizeInitials(originalGetInitials(assignment));
  };

  function normalizeInitialInputs() {
    document
      .querySelectorAll("#initialsAssignmentGrid input, #employeeInitialsInput")
      .forEach((input) => {
        const normalized = acNormalizeInitials(input.value);
        if (input.value !== normalized) input.value = normalized.toUpperCase();
      });
  }

  document.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (
      input.id !== "employeeInitialsInput" &&
      !input.closest("#initialsAssignmentGrid")
    ) {
      return;
    }

    const normalized = acNormalizeInitials(input.value);
    input.value = normalized.toUpperCase();
  });

  const originalRenderInitialsAssignments = acRenderInitialsAssignments;
  acRenderInitialsAssignments = function renderLetterOnlyInitialsAssignments() {
    originalRenderInitialsAssignments();
    normalizeInitialInputs();
  };

  const originalApplyCredits = acApplyCreditsToProduction;
  acApplyCreditsToProduction = function applyCreditsWithCanonicalInitials() {
    const totals = {};
    (alreadyCountedState.matchedRows || []).forEach((row) => {
      const initials = acNormalizeInitials(row.initials);
      if (!initials) return;
      row.initials = initials;
      totals[initials] = (totals[initials] || 0) + Number(row.locationCount || 0);
    });
    alreadyCountedState.totalsByInitials = totals;
    originalApplyCredits();
  };

  function migrateKnownEmployeeInitials() {
    let changed = false;
    getAssignments().forEach((assignment) => {
      const name = String(assignment?.name ?? "").trim().toLowerCase();
      const canonical = canonicalInitialsByName[name];
      if (!canonical || acNormalizeInitials(assignment.initials) === canonical) return;
      assignment.initials = canonical;
      changed = true;
    });

    if (changed) {
      saveBranches();
      if (typeof acSaveSettings === "function") acSaveSettings();
    }

    acRenderInitialsAssignments();
    if (alreadyCountedState.applied) acApplyCreditsToProduction();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", migrateKnownEmployeeInitials);
  } else {
    migrateKnownEmployeeInitials();
  }

  $("branchSelect")?.addEventListener("change", () => {
    window.setTimeout(migrateKnownEmployeeInitials, 0);
  });
})();
