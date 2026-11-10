"use strict";

(() => {
  if (window.__cycleCountOfficialTotalFixLoaded) return;
  window.__cycleCountOfficialTotalFixLoaded = true;

  function numberValue(value) {
    const number = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : 0;
  }

  function explicitOfficialTotal() {
    if (!state.workbook) return 0;
    let total = 0;

    state.workbook.SheetNames.forEach((sheetName) => {
      const matrix = workbookMatrix(state.workbook, sheetName);
      matrix.forEach((row) => {
        if (normalizeText(row?.[0]) !== "total") return;

        // In Cycle Count Detail, the official Times Counted total is on the
        // top-level Total row. Use the largest valid number on that row.
        row.forEach((value) => {
          const number = numberValue(value);
          if (number > total && number <= 100000) total = number;
        });
      });
    });

    return Math.round(total);
  }

  const previousDetector = rrDetectOfficialReportTotal;
  rrDetectOfficialReportTotal = function detectOfficialTotalFromTotalRow() {
    return explicitOfficialTotal() || previousDetector();
  };

  // Never allow an older auto-filled input value to override the workbook's
  // actual Total row. This was why the app remained at 833 instead of 1,128.
  const previousGetter = rrGetOfficialReportTotal;
  rrGetOfficialReportTotal = function getCurrentOfficialReportTotal() {
    const workbookTotal = explicitOfficialTotal();
    if (workbookTotal > 0) return workbookTotal;
    return previousGetter();
  };

  function synchronizeOfficialTotal() {
    const total = explicitOfficialTotal();
    const input = $("officialReportTotal");
    if (input && total > 0) input.value = String(total);
    return total;
  }

  const previousApplyCredits = acApplyCreditsToProduction;
  acApplyCreditsToProduction = function applyCreditsWithTrueReportTotal() {
    synchronizeOfficialTotal();
    previousApplyCredits();

    if (state.workbook) {
      renderResults();
      if (typeof acRenderUnassignedProductionCard === "function") {
        acRenderUnassignedProductionCard();
      }
    }
  };

  // Recalculate after a Cycle Count Detail file is loaded, even before the
  // Already Cycle Counted match button is pressed.
  const sourceFile = $("sourceFile");
  sourceFile?.addEventListener("change", () => {
    window.setTimeout(() => {
      const total = synchronizeOfficialTotal();
      if (!total || !state.workbook) return;
      renderResults();
      if (typeof acRenderUnassignedProductionCard === "function") {
        acRenderUnassignedProductionCard();
      }
    }, 250);
  });
})();
