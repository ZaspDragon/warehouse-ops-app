"use strict";

/*
 * Company branch setup and branch-aware batch counting.
 *
 * Every listed branch uses the same Cycle Count Detail upload workflow.
 * Branches keep separate employees, aisle assignments, goals, and saved data.
 */

const COMPANY_BRANCH_CODES = [
  "ALB", "ALM", "ATL", "AZP", "CHS", "CLT", "CO11", "FLM", "FLO",
  "GA12", "ILC", "INI", "KYL", "MDB", "MID", "MN11", "MOK", "MOS",
  "NVL", "OH01", "OHC", "PA11", "RAL", "TAMPA", "TAMPA-DC", "TNM",
  "TNM-DC", "TNN", "TXA", "TXD", "TXH", "TXH-DC", "TXH-SO", "TXS",
  "VAR"
];

function ensureCompanyBranches() {
  if (!Array.isArray(state.branches)) return;

  const existingNames = new Set(
    state.branches.map((branch) => String(branch?.name || "").trim().toUpperCase())
  );

  COMPANY_BRANCH_CODES.forEach((branchCode) => {
    if (existingNames.has(branchCode)) return;

    const isOh01 = branchCode === "OH01";
    state.branches.push({
      id: createId("branch"),
      name: branchCode,
      expectedInventoryFilename: "Cycle Count Detail.xlsx",
      assignments: isOh01
        ? DEFAULT_ASSIGNMENTS.map((assignment) => ({
            ...assignment,
            id: createId("employee")
          }))
        : [],
      dailyGoal: DAILY_GOAL,
      createdAt: new Date().toISOString()
    });
  });

  state.branches.sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );

  saveBranches();
  renderBranchDropdown();
}

function selectedCompanyBranchCode() {
  return String(getSelectedBranch()?.name || "").trim().toUpperCase();
}

function detectCompanyBatchBranch(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text || /^BATCH$/i.test(text)) return null;

  return [...COMPANY_BRANCH_CODES]
    .sort((a, b) => b.length - a.length)
    .find((code) => {
      const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^${escaped}(?:$|[\\s_/-])`).test(text);
    }) || null;
}

function selectedBranchIsBatch(value) {
  const selectedCode = selectedCompanyBranchCode();
  return Boolean(selectedCode && detectCompanyBatchBranch(value) === selectedCode);
}

function selectedBranchDetailRowTotal() {
  const batchSelect = $("batchColumn");
  if (!batchSelect || batchSelect.value === "" || !Array.isArray(state.rows)) {
    return 0;
  }

  const columnIndex = Number(batchSelect.value);
  return state.rows.reduce((total, row) => {
    const batch = String(row?.[columnIndex] ?? "").trim();
    if (/^batch$/i.test(batch)) return total;
    return total + (selectedBranchIsBatch(batch) ? 1 : 0);
  }, 0);
}

function selectedBranchMatchedLocationTotal() {
  return (alreadyCountedState.matchedRows || []).reduce(
    (sum, row) => sum + (Number(row.locationCount) || 0),
    0
  );
}

function selectedBranchUnmatchedRowTotal() {
  return Math.max(
    0,
    selectedBranchDetailRowTotal() - selectedBranchMatchedLocationTotal()
  );
}

ensureCompanyBranches();

const companyOriginalRemoveMetadataWarnings = rrRemoveMetadataWarnings;

pcBatchesTotal = function correctedCompanyBranchBatchesTotal() {
  const officialTotal = rrGetOfficialReportTotal();
  const namedTotal = pcNamedEmployeeTotal();
  const varianceTotal = pcVarianceTotal();
  const unassignedInitialsTotal = pcExplicitBatchTotal();
  const unmatchedBranchTotal = selectedBranchUnmatchedRowTotal();
  const directlyIdentifiedBatches =
    unassignedInitialsTotal + unmatchedBranchTotal;

  if (officialTotal > 0) {
    return Math.max(
      directlyIdentifiedBatches,
      officialTotal - namedTotal - varianceTotal
    );
  }

  return directlyIdentifiedBatches;
};

rrGetBatchesTotal = pcBatchesTotal;
acGetUnassignedBatchTotal = pcBatchesTotal;

rrRemoveMetadataWarnings = function keepOnlyOtherBranchRows() {
  companyOriginalRemoveMetadataWarnings();
  state.uncreditedRows = state.uncreditedRows.filter((item) => {
    const batch = String(item?.batch ?? "").trim();
    if (/^batch$/i.test(batch)) return false;
    return !selectedBranchIsBatch(batch);
  });
};

const companyOriginalRenderCards = acRenderUnassignedProductionCard;
acRenderUnassignedProductionCard = function renderCompanyBranchBatchesCard() {
  companyOriginalRenderCards();

  const card = $("productionCards")?.querySelector(
    "[data-unassigned-batches-card]"
  );
  if (!card) return;

  const branchCode = selectedCompanyBranchCode() || "Branch";
  const description = card.querySelector(".summary-card-top span");
  if (description) {
    description.textContent =
      `Unassigned ${branchCode} initials: ${pcExplicitBatchTotal()} • ` +
      `Unmatched ${branchCode} rows: ${selectedBranchUnmatchedRowTotal()}`;
  }
};
