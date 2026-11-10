"use strict";

/*
 * Read only the Already Cycle Counted worksheet that matches the detected
 * Cycle Count Detail report date. Counts from Thursday must never carry into
 * Friday (or from any prior workday into the current report day).
 */

function acGetReportCountDate(workbook) {
  if (!workbook) return null;
  const dates = [];

  workbook.SheetNames.forEach((sheetName) => {
    workbookMatrix(workbook, sheetName).forEach((row) => {
      row.forEach((cell) => {
        if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
          dates.push(cell);
          return;
        }
        if (typeof cell !== "string") return;
        const text = cell.trim();
        if (!/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) return;
        const parsed = new Date(text);
        if (!Number.isNaN(parsed.getTime())) dates.push(parsed);
      });
    });
  });

  if (!dates.length) return null;
  const counts = new Map();
  dates.forEach((date) => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const selectedKey = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
  if (!selectedKey) return null;
  const [year, month, day] = selectedKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function acGetWeekdaySheetName(workbook, date) {
  if (!workbook || !date) return null;
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  return workbook.SheetNames.find(
    (sheetName) => sheetName.trim().toLowerCase() === weekday.toLowerCase()
  ) || null;
}

function acReadEveryDailyRow(workbook, sheetName) {
  const matrix = workbookMatrix(workbook, sheetName);
  const rows = [];
  let itemColumn = -1;
  let initialsColumn = -1;

  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];

    if (itemColumn < 0 || initialsColumn < 0) {
      const detectedItem = detectColumn(row, ["item number", "item num", "item"]);
      const detectedInitials = detectColumn(row, ["initials", "initial"]);
      if (detectedItem >= 0 && detectedInitials >= 0) {
        itemColumn = detectedItem;
        initialsColumn = detectedInitials;
        continue;
      }
    }

    if (itemColumn < 0 || initialsColumn < 0) continue;

    const itemNumber = acNormalizeItem(row[itemColumn]);
    const initials = acNormalizeInitials(row[initialsColumn]);
    if (!itemNumber || !/^\d+$/.test(itemNumber) || !initials) continue;

    rows.push({
      itemNumber,
      initials,
      sheetName,
      rowNumber: rowIndex + 1,
    });
  }

  return rows;
}

acFindAlreadyCountedRows = function findAlreadyCountedRowsForReportDay(workbook) {
  const reportDate = acGetReportCountDate(state.workbook);
  const reportSheet = acGetWeekdaySheetName(workbook, reportDate);

  if (!reportSheet) {
    alreadyCountedState.selectedDay = null;
    alreadyCountedState.selectedSheets = [];
    alreadyCountedState.reportDate = reportDate;
    alreadyCountedState.dailySourceRowCount = 0;
    alreadyCountedState.dailyUniqueRowCount = 0;
    acSetStatus(
      reportDate
        ? `No ${reportDate.toLocaleDateString("en-US", { weekday: "long" })} worksheet was found in the Already Cycle Counted file.`
        : "The report date could not be detected from Count Date values.",
      true
    );
    return [];
  }

  const sourceRows = acReadEveryDailyRow(workbook, reportSheet);
  const seen = new Set();
  const rows = sourceRows.filter((row) => {
    const key = `${row.itemNumber}|${row.initials}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  alreadyCountedState.selectedDay = reportSheet;
  alreadyCountedState.selectedSheets = [reportSheet];
  alreadyCountedState.reportDate = reportDate;
  alreadyCountedState.dailySourceRowCount = sourceRows.length;
  alreadyCountedState.dailyUniqueRowCount = rows.length;
  return rows;
};

const acMatchFilesBeforeDailyStatus = acMatchFiles;
acMatchFiles = function matchReportDayOnly() {
  acMatchFilesBeforeDailyStatus();

  if (alreadyCountedState.applied && alreadyCountedState.selectedDay) {
    const locationTotal = alreadyCountedState.matchedRows.reduce(
      (sum, row) => sum + Number(row.locationCount || 0),
      0
    );
    const reportDateText = alreadyCountedState.reportDate
      ? alreadyCountedState.reportDate.toLocaleDateString("en-US")
      : "detected report date";
    acSetStatus(
      `${alreadyCountedState.selectedDay} only (${reportDateText}) • ` +
      `${alreadyCountedState.dailySourceRowCount || 0} source rows read • ` +
      `${alreadyCountedState.dailyUniqueRowCount || 0} unique item/initial entries • ` +
      `${alreadyCountedState.matchedRows.length} items matched • ${locationTotal} cycle counts credited`,
      false
    );
  }
};
