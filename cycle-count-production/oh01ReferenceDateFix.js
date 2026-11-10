"use strict";

/*
 * Count "Already Cycle Counted Numbers" by the month/day embedded in OH01
 * batch names. The month is not fixed: values from 1/1 through 12/31 are
 * supported, including numbered batch suffixes such as OH01 11/6-3.
 */
(() => {
  const REFERENCE_NAME = "already cycle counted numbers";

  function normalizeReferenceName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizedAssignmentDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return {
        year: value.getFullYear(),
        month: value.getMonth() + 1,
        day: value.getDate(),
      };
    }

    const text = String(value || "").trim();
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;

    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  function getBatchColumnIndex() {
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

  function isValidMonthDay(year, month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() + 1 === month &&
      date.getDate() === day
    );
  }

  function extractOh01BatchDate(value, fallbackYear) {
    const text = String(value || "").trim().toUpperCase();

    // Accepted for every month:
    // OH01 1/5
    // OH01 2/14-1
    // OH01 07/22-12
    // OH01-10/3-2
    // OH01_12/31
    const match = text.match(
      /^OH01(?:\s|_|-)+(\d{1,2})\s*\/\s*(\d{1,2})(?:-\d+)?(?:\s.*)?$/i
    );
    if (!match) return null;

    const month = Number(match[1]);
    const day = Number(match[2]);
    if (!isValidMonthDay(fallbackYear, month, day)) return null;

    return { year: fallbackYear, month, day };
  }

  function sameCalendarDay(left, right) {
    return Boolean(
      left &&
      right &&
      left.year === right.year &&
      left.month === right.month &&
      left.day === right.day
    );
  }

  function applyOh01ReferenceBatchTotal() {
    if (!Array.isArray(state.rows)) return;

    const reference = getAssignments().find(
      (assignment) => normalizeReferenceName(assignment?.name) === REFERENCE_NAME
    );
    if (!reference) return;

    const wantedDate = normalizedAssignmentDate(reference.startAisle);
    const batchColumn = getBatchColumnIndex();
    if (!wantedDate || batchColumn < 0) return;

    const total = state.rows.reduce((count, row) => {
      const batchDate = extractOh01BatchDate(row?.[batchColumn], wantedDate.year);
      return count + (sameCalendarDay(batchDate, wantedDate) ? 1 : 0);
    }, 0);

    state.employeeTotals[reference.name] = total;
  }

  const previousCalculateProduction = calculateProduction;
  calculateProduction = function calculateProductionWithOh01ReferenceDates() {
    previousCalculateProduction();
    applyOh01ReferenceBatchTotal();
    renderResults();
  };
})();