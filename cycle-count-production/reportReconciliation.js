"use strict";

/*
 * Reconciles the app's named employee production to the official total shown
 * in Cycle Count Detail. Any remaining counts are assigned to a production
 * person named "Batches" so the team total matches the report exactly.
 */

const rrOriginalUnassignedInitials = acGetUnassignedInitialsTotals;
const rrOriginalApplyCredits = acApplyCreditsToProduction;
const rrOriginalRenderPreview = acRenderPreview;

function rrNumber(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function rrDetectOfficialReportTotal() {
  if (!state.workbook) return 0;

  const strongCandidates = [];
  const weakCandidates = [];

  state.workbook.SheetNames.forEach((sheetName) => {
    const matrix = workbookMatrix(state.workbook, sheetName);

    matrix.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        const label = normalizeText(cell);
        const isStrongLabel =
          label.includes("total cycle count") ||
          label.includes("total count") ||
          label.includes("counts completed") ||
          label.includes("grand total");
        const isWeakLabel = label === "total" || label.includes("report total");

        if (!isStrongLabel && !isWeakLabel) return;

        const nearby = [];
        for (let offset = -2; offset <= 5; offset += 1) {
          nearby.push(row[columnIndex + offset]);
          nearby.push(matrix[rowIndex + 1]?.[columnIndex + offset]);
        }

        nearby.forEach((value) => {
          const number = rrNumber(value);
          if (number === null || number <= 0 || number > 100000) return;
          (isStrongLabel ? strongCandidates : weakCandidates).push(number);
        });
      });
    });
  });

  const candidates = strongCandidates.length ? strongCandidates : weakCandidates;
  return candidates.length ? Math.max(...candidates) : 0;
}

function rrGetOfficialReportTotal() {
  const inputValue = rrNumber($("officialReportTotal")?.value);
  if (inputValue && inputValue > 0) return Math.round(inputValue);
  return Math.round(rrDetectOfficialReportTotal());
}

function rrGetNamedEmployeeTotal() {
  return Object.values(state.employeeTotals).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0
  );
}

function rrGetBatchesTotal() {
  const officialTotal = rrGetOfficialReportTotal();
  const namedTotal = rrGetNamedEmployeeTotal();

  if (officialTotal > 0) {
    return Math.max(0, officialTotal - namedTotal);
  }

  return rrOriginalUnassignedInitials().reduce(
    (sum, entry) => sum + (Number(entry.total) || 0),
    0
  );
}

function rrRemoveMetadataWarnings() {
  state.uncreditedRows = state.uncreditedRows.filter((item) => {
    const value = String(item.batch ?? "").trim();
    if (/^batch$/i.test(value)) return false;
    if (/^OH\d+\s+\d{1,2}\/\d{1,2}(?:-\d+)?$/i.test(value)) return false;
    return true;
  });
}

function rrInstallOfficialTotalInput() {
  if ($("officialReportTotal")) return;

  const controls = document.querySelector(".already-counted-controls");
  if (!controls) return;

  const label = document.createElement("label");
  label.innerHTML = `
    <span>Official report total</span>
    <input id="officialReportTotal" type="number" min="0" step="1" placeholder="Auto-detect from report" />
  `;
  controls.prepend(label);

  const detected = rrDetectOfficialReportTotal();
  if (detected > 0) $("officialReportTotal").value = String(Math.round(detected));

  $("officialReportTotal").addEventListener("input", () => {
    if (alreadyCountedState.applied) {
      acApplyCreditsToProduction();
      acRenderPreview();
    }
  });
}

acGetUnassignedBatchTotal = rrGetBatchesTotal;

acRenderUnassignedProductionCard = function renderBatchesProductionCard() {
  const cards = $("productionCards");
  if (!cards) return;

  cards.querySelector("[data-unassigned-batches-card]")?.remove();

  const batchesTotal = rrGetBatchesTotal();
  if (batchesTotal <= 0) return;

  const officialTotal = rrGetOfficialReportTotal();
  const namedTotal = rrGetNamedEmployeeTotal();
  const card = document.createElement("article");
  card.className = "summary-card";
  card.dataset.unassignedBatchesCard = "true";
  card.innerHTML = `
    <div class="summary-card-top">
      <div>
        <strong>Batches</strong>
        <span>Report remainder not credited to a named employee</span>
      </div>
      <b>${batchesTotal}</b>
    </div>
    <div class="percent-row">
      <span>Assigned production person</span>
      <small>${officialTotal > 0 ? `${namedTotal} named + ${batchesTotal} Batches = ${officialTotal}` : "Included in team production"}</small>
    </div>
  `;
  cards.appendChild(card);

  const summary = $("recordSummary");
  if (summary) {
    const finalTotal = officialTotal > 0 ? officialTotal : namedTotal + batchesTotal;
    summary.textContent = `${finalTotal} total production • ${batchesTotal} assigned to Batches`;
  }
};

acApplyCreditsToProduction = function reconcileCreditsToOfficialTotal() {
  rrOriginalApplyCredits();
  rrRemoveMetadataWarnings();
  if (state.workbook) {
    renderResults();
    acRenderUnassignedProductionCard();
  }
};

acRenderPreview = function renderReconciledPreview() {
  rrOriginalRenderPreview();

  const preview = $("alreadyCountedPreview");
  if (!preview) return;

  preview.querySelector("[data-report-reconciliation]")?.remove();

  const officialTotal = rrGetOfficialReportTotal();
  const namedTotal = rrGetNamedEmployeeTotal();
  const batchesTotal = rrGetBatchesTotal();
  const panel = document.createElement("div");
  panel.dataset.reportReconciliation = "true";
  panel.className = "already-counted-kpis";
  panel.innerHTML = `
    <div><span>Official report total</span><strong>${officialTotal || "—"}</strong></div>
    <div><span>Named employees</span><strong>${namedTotal}</strong></div>
    <div><span>Batches</span><strong>${batchesTotal}</strong></div>
    <div><span>Reconciled team total</span><strong>${officialTotal || namedTotal + batchesTotal}</strong></div>
  `;
  preview.prepend(panel);

  const summaryTable = preview.querySelector(".already-counted-production-summary tbody");
  if (summaryTable) {
    const oldBatchesRow = [...summaryTable.querySelectorAll("tr")].find(
      (row) => /unassigned batches|batches/i.test(row.cells?.[0]?.textContent || "")
    );
    oldBatchesRow?.remove();

    if (batchesTotal > 0) {
      summaryTable.insertAdjacentHTML(
        "beforeend",
        `<tr><td><strong>Batches</strong></td><td>—</td><td>0</td><td><strong>+${batchesTotal}</strong></td><td><strong>${batchesTotal}</strong></td></tr>`
      );
    }
  }
};

function rrInitialize() {
  rrInstallOfficialTotalInput();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", rrInitialize);
} else {
  rrInitialize();
}
