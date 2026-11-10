"use strict";

/*
 * Final production classification rules:
 * - DW initials are credited to a production person named "Variance Reports".
 * - Any initials not assigned to an employee are credited to "Batches".
 * - The official report remainder is also credited to "Batches" so the team
 *   total reconciles exactly without double counting.
 */

const pcOriginalApplyCredits = acApplyCreditsToProduction;
const pcOriginalRenderPreview = acRenderPreview;

function pcVarianceTotal() {
  return Number(alreadyCountedState.totalsByInitials?.dw || 0);
}

function pcAssignedEmployeeInitials() {
  return new Set(
    getAssignments()
      .map((assignment) => acGetInitials(assignment))
      .filter((initials) => initials && initials !== "dw")
  );
}

function pcUnassignedInitialsRows() {
  const assigned = pcAssignedEmployeeInitials();
  return Object.entries(alreadyCountedState.totalsByInitials || {})
    .filter(([initials]) => initials !== "dw" && !assigned.has(initials))
    .map(([initials, total]) => ({
      initials,
      total: Number(total) || 0,
    }));
}

function pcExplicitBatchTotal() {
  return pcUnassignedInitialsRows().reduce(
    (sum, entry) => sum + entry.total,
    0
  );
}

function pcMoveDwOutOfEmployeeTotals() {
  const varianceTotal = pcVarianceTotal();

  getAssignments().forEach((assignment) => {
    const initials = acGetInitials(assignment);
    const previousMoved = Number(assignment.__varianceReportsMoved || 0);

    if (previousMoved > 0) {
      state.employeeTotals[assignment.name] =
        Number(state.employeeTotals[assignment.name] || 0) + previousMoved;
      assignment.__varianceReportsMoved = 0;
    }

    if (initials === "dw" && varianceTotal > 0) {
      state.employeeTotals[assignment.name] = Math.max(
        0,
        Number(state.employeeTotals[assignment.name] || 0) - varianceTotal
      );
      assignment.__varianceReportsMoved = varianceTotal;
    }
  });
}

function pcNamedEmployeeTotal() {
  return Object.values(state.employeeTotals).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0
  );
}

function pcBatchesTotal() {
  const officialTotal = rrGetOfficialReportTotal();
  const namedTotal = pcNamedEmployeeTotal();
  const varianceTotal = pcVarianceTotal();
  const explicitBatchTotal = pcExplicitBatchTotal();

  if (officialTotal > 0) {
    return Math.max(
      explicitBatchTotal,
      officialTotal - namedTotal - varianceTotal
    );
  }

  return explicitBatchTotal;
}

rrGetNamedEmployeeTotal = pcNamedEmployeeTotal;
rrGetBatchesTotal = pcBatchesTotal;
acGetUnassignedBatchTotal = pcBatchesTotal;

acRenderUnassignedProductionCard = function renderClassifiedProductionCards() {
  const cards = $("productionCards");
  if (!cards) return;

  cards.querySelector("[data-unassigned-batches-card]")?.remove();
  cards.querySelector("[data-variance-reports-card]")?.remove();

  const varianceTotal = pcVarianceTotal();
  const batchesTotal = pcBatchesTotal();
  const namedTotal = pcNamedEmployeeTotal();
  const officialTotal = rrGetOfficialReportTotal();

  if (varianceTotal > 0) {
    const varianceCard = document.createElement("article");
    varianceCard.className = "summary-card";
    varianceCard.dataset.varianceReportsCard = "true";
    varianceCard.innerHTML = `
      <div class="summary-card-top">
        <div>
          <strong>Variance Reports</strong>
          <span>DW initials</span>
        </div>
        <b>${varianceTotal}</b>
      </div>
      <div class="percent-row">
        <span>Assigned production person</span>
        <small>All DW count credit</small>
      </div>
    `;
    cards.appendChild(varianceCard);
  }

  if (batchesTotal > 0) {
    const breakdown = pcUnassignedInitialsRows()
      .map((entry) => `${entry.initials.toUpperCase()}: ${entry.total}`)
      .join(" • ");
    const batchesCard = document.createElement("article");
    batchesCard.className = "summary-card";
    batchesCard.dataset.unassignedBatchesCard = "true";
    batchesCard.innerHTML = `
      <div class="summary-card-top">
        <div>
          <strong>Batches</strong>
          <span>${escapeHtml(breakdown || "Report counts not assigned to a named employee")}</span>
        </div>
        <b>${batchesTotal}</b>
      </div>
      <div class="percent-row">
        <span>Assigned production person</span>
        <small>All other unassigned counts</small>
      </div>
    `;
    cards.appendChild(batchesCard);
  }

  const summary = $("recordSummary");
  if (summary) {
    const finalTotal = officialTotal > 0
      ? officialTotal
      : namedTotal + varianceTotal + batchesTotal;
    summary.textContent = `${finalTotal} total production • ${varianceTotal} Variance Reports • ${batchesTotal} Batches`;
  }
};

acApplyCreditsToProduction = function applyClassifiedProductionCredits() {
  pcOriginalApplyCredits();
  pcMoveDwOutOfEmployeeTotals();
  rrRemoveMetadataWarnings();

  if (state.workbook) {
    renderResults();
    acRenderUnassignedProductionCard();
  }
};

acRenderPreview = function renderClassifiedPreview() {
  pcOriginalRenderPreview();

  const preview = $("alreadyCountedPreview");
  if (!preview) return;

  const varianceTotal = pcVarianceTotal();
  const batchesTotal = pcBatchesTotal();
  const namedTotal = pcNamedEmployeeTotal();
  const officialTotal = rrGetOfficialReportTotal();

  preview.querySelector("[data-report-reconciliation]")?.remove();
  const panel = document.createElement("div");
  panel.dataset.reportReconciliation = "true";
  panel.className = "already-counted-kpis";
  panel.innerHTML = `
    <div><span>Official report total</span><strong>${officialTotal || "—"}</strong></div>
    <div><span>Named employees</span><strong>${namedTotal}</strong></div>
    <div><span>Variance Reports (DW)</span><strong>${varianceTotal}</strong></div>
    <div><span>Batches</span><strong>${batchesTotal}</strong></div>
  `;
  preview.prepend(panel);

  const summaryTable = preview.querySelector(".already-counted-production-summary tbody");
  if (!summaryTable) return;

  [...summaryTable.querySelectorAll("tr")].forEach((row) => {
    const label = row.cells?.[0]?.textContent || "";
    if (/variance reports|unassigned batches|^batches$/i.test(label.trim())) {
      row.remove();
    }
  });

  if (varianceTotal > 0) {
    summaryTable.insertAdjacentHTML(
      "beforeend",
      `<tr><td><strong>Variance Reports</strong></td><td>DW</td><td>0</td><td><strong>+${varianceTotal}</strong></td><td><strong>${varianceTotal}</strong></td></tr>`
    );
  }

  if (batchesTotal > 0) {
    const initials = pcUnassignedInitialsRows()
      .map((entry) => entry.initials.toUpperCase())
      .join(", ");
    summaryTable.insertAdjacentHTML(
      "beforeend",
      `<tr><td><strong>Batches</strong></td><td>${escapeHtml(initials || "—")}</td><td>0</td><td><strong>+${batchesTotal}</strong></td><td><strong>${batchesTotal}</strong></td></tr>`
    );
  }
};
