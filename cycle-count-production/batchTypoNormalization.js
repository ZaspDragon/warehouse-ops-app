"use strict";

/*
 * Normalize common OH01 batch-code typing/OCR mistakes before any production
 * validation, date matching, branch detection, or initials redistribution.
 */
(() => {
  const OH01_ALIASES = /^(?:OHOI|OHO1|OH0I|0H01)(?=$|[\s_\/-])/i;

  function normalizeOh01Batch(value) {
    const text = String(value ?? "").trim();
    if (!text) return text;
    return text.replace(OH01_ALIASES, "OH01");
  }

  function getSelectedBatchColumn() {
    const selected = $("batchColumn")?.value;
    if (selected !== undefined && selected !== null && selected !== "") {
      return Number(selected);
    }

    if (!state.workbook) return -1;
    const sheetName = $("sourceSheet")?.value;
    if (!sheetName) return -1;
    const matrix = workbookMatrix(state.workbook, sheetName);
    return detectColumn(matrix[state.headerIndex] || [], [
      "batch",
      "created count batch",
      "created-count batch",
      "count batch",
    ]);
  }

  function normalizeLoadedBatchRows() {
    if (!Array.isArray(state.rows)) return 0;
    const batchColumn = getSelectedBatchColumn();
    if (batchColumn < 0) return 0;

    let corrected = 0;
    state.rows.forEach((row) => {
      if (!Array.isArray(row)) return;
      const original = row[batchColumn];
      const normalized = normalizeOh01Batch(original);
      if (normalized !== String(original ?? "").trim()) {
        row[batchColumn] = normalized;
        corrected += 1;
      }
    });
    return corrected;
  }

  const originalCalculateProduction = calculateProduction;
  calculateProduction = function calculateProductionWithBatchTypoCorrection() {
    const corrected = normalizeLoadedBatchRows();
    originalCalculateProduction();

    if (corrected > 0) {
      const status = $("sourceStatus");
      if (status) {
        status.textContent = `${corrected} OH01 batch code typo${corrected === 1 ? "" : "s"} corrected automatically`;
        status.classList.add("success");
      }
    }
  };
})();
