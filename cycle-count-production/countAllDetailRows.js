"use strict";

/*
 * Count every real Cycle Count Detail row.
 * Standard aisle batches continue to credit the assigned employee.
 * Any real detail row whose batch cannot be mapped to an employee is credited
 * to the production person named "Batches" instead of being discarded.
 */

const cadrOriginalCalculateProduction = calculateProduction;

function cadrGetDetailColumns() {
  if (!state.workbook) return null;

  const sheetSelect = $("sourceSheet");
  if (!sheetSelect) return null;

  const matrix = workbookMatrix(state.workbook, sheetSelect.value);
  const headers = matrix[state.headerIndex] || [];

  return {
    countDate: detectColumn(headers, ["count date"]),
    bin: detectColumn(headers, ["bin #", "bin"]),
    batch: detectColumn(headers, ["batch"]),
    timesCounted: detectColumn(headers, ["times counted"]),
  };
}

function cadrNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function cadrIsRealDetailRow(row, columns) {
  if (!columns) return false;

  const countDate = String(row[columns.countDate] ?? "").trim();
  const bin = String(row[columns.bin] ?? "").trim();
  const batch = String(row[columns.batch] ?? "").trim();
  const timesCounted = cadrNumber(row[columns.timesCounted]);

  if (!countDate || /^count date$/i.test(countDate)) return false;
  if (!bin || /^bin\s*#?$/i.test(bin)) return false;
  if (!batch || /^batch$/i.test(batch)) return false;
  if (timesCounted <= 0) return false;

  return true;
}

calculateProduction = function calculateAllCycleCountDetailRows() {
  cadrOriginalCalculateProduction();

  const columns = cadrGetDetailColumns();
  if (!columns) return;

  let batchesDetailTotal = 0;
  const batchesRows = [];

  state.uncreditedRows = state.uncreditedRows.filter((entry) => {
    const offset = entry.row - state.headerIndex - 2;
    const sourceRow = state.rows[offset];

    if (!sourceRow || !cadrIsRealDetailRow(sourceRow, columns)) {
      return true;
    }

    const batch = String(sourceRow[columns.batch] ?? "").trim();
    const aisle = parseCreatedBatch(batch);
    const assignedAisles = getAssignedAisles();

    // Valid aisle batches that are not assigned also belong to Batches.
    if (!aisle || !assignedAisles.includes(aisle)) {
      const count = Math.max(1, Math.round(cadrNumber(sourceRow[columns.timesCounted])));
      batchesDetailTotal += count;
      batchesRows.push({
        row: entry.row,
        batch,
        bin: String(sourceRow[columns.bin] ?? "").trim(),
        count,
      });
      return false;
    }

    return true;
  });

  state.batchesDetailTotal = batchesDetailTotal;
  state.batchesDetailRows = batchesRows;

  renderResults();

  if (typeof acRenderUnassignedProductionCard === "function") {
    acRenderUnassignedProductionCard();
  }

  const reviewDetails = $("reviewDetails");
  const reviewCount = $("reviewCount");
  if (reviewCount) reviewCount.textContent = String(state.uncreditedRows.length);
  if (reviewDetails && state.uncreditedRows.length === 0) {
    reviewDetails.classList.add("hidden");
  }
};
