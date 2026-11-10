"use strict";

/*
 * Cycle Count Detail repeats the item number on detail lines where the Batch
 * field may be blank or unavailable. Those numeric values are item references,
 * not malformed employee batch codes. Ownership reconciliation already counts
 * each unique item/bin once and sends rows without a present confirmed owner to
 * Batches. Keep those rows out of the misleading invalid-format review list.
 */
(() => {
  if (window.__numericItemReviewFixInstalled) return;
  window.__numericItemReviewFixInstalled = true;

  function isNumericItemReference(entry) {
    const value = String(entry?.batch ?? "").trim();
    return /^\d{4,}$/.test(value) && /invalid batch format/i.test(String(entry?.reason || ""));
  }

  function cleanNumericItemWarnings() {
    if (!Array.isArray(state?.uncreditedRows)) return;
    state.uncreditedRows = state.uncreditedRows.filter((entry) => !isNumericItemReference(entry));
  }

  const previousRenderResults = renderResults;
  renderResults = function renderResultsWithoutNumericItemWarnings() {
    cleanNumericItemWarnings();
    previousRenderResults();
  };

  const previousCalculateProduction = calculateProduction;
  calculateProduction = function calculateProductionWithoutNumericItemWarnings() {
    previousCalculateProduction();
    cleanNumericItemWarnings();
    if (state.workbook) previousRenderResults();
    if (typeof window.recalculateCycleCountOwnership === "function") {
      window.setTimeout(window.recalculateCycleCountOwnership, 0);
    }
  };

  ["sourceFile", "alreadyCountedFile", "matchAlreadyCountedBtn"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      window.setTimeout(() => {
        cleanNumericItemWarnings();
        if (state.workbook) renderResults();
      }, 300);
    });
  });

  // Load the final checker after every older wrapper has initialized. This
  // intentionally uses a new file and cache-busting URL so an old browser copy
  // cannot keep showing the obsolete 34-batch calculation.
  window.setTimeout(() => {
    if (document.querySelector('script[data-accuracy-v2="true"]')) return;
    const script = document.createElement("script");
    script.dataset.accuracyV2 = "true";
    script.src = `productionAccuracyGuardV2.js?v=20260727-final-${Date.now()}`;
    document.body.appendChild(script);
  }, 1000);
})();