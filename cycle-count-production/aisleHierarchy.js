"use strict";

/*
 * Warehouse aisle hierarchy support.
 * A single-letter R assignment includes the RA-RG sub-aisles.
 * Multi-letter ranges such as RA-RG are also expanded correctly.
 */
(() => {
  const originalExpandAisleRange = expandAisleRange;

  function normalizeAisle(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function expandAlphabeticRange(start, end) {
    const startMatch = start.match(/^([A-Z]*)([A-Z])$/);
    const endMatch = end.match(/^([A-Z]*)([A-Z])$/);

    if (
      !startMatch ||
      !endMatch ||
      startMatch[1] !== endMatch[1] ||
      startMatch[2] > endMatch[2]
    ) {
      return null;
    }

    const values = [];
    for (
      let code = startMatch[2].charCodeAt(0);
      code <= endMatch[2].charCodeAt(0);
      code += 1
    ) {
      values.push(`${startMatch[1]}${String.fromCharCode(code)}`);
    }

    return values;
  }

  expandAisleRange = function expandWarehouseAisleRange(startValue, endValue) {
    const start = normalizeAisle(startValue);
    const end = normalizeAisle(endValue || startValue);

    if (!start) return [];

    // Treat R as the parent group for R plus RA through RG.
    if (start === "R" && end === "R") {
      return ["R", "RA", "RB", "RC", "RD", "RE", "RF", "RG"];
    }

    const alphabeticRange = expandAlphabeticRange(start, end);
    if (alphabeticRange) {
      return alphabeticRange;
    }

    return originalExpandAisleRange(start, end);
  };

  getAssignedAisles = function getWarehouseAssignedAisles() {
    const assigned = new Set();

    getAssignments()
      .filter(
        (assignment) =>
          String(assignment?.name || "").trim().toLowerCase() !==
          "already cycle counted numbers"
      )
      .forEach((assignment) => {
        expandAisleRange(assignment.startAisle, assignment.endAisle).forEach(
          (aisle) => assigned.add(aisle)
        );
      });

    return Array.from(assigned).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  };
})();
