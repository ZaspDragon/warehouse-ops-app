"use strict";

/*
 * Final branch support rendering and official report reconciliation.
 * This file runs after every other production wrapper, so the displayed total,
 * Batches card, saved totals, and goal percentage always use the report's
 * official Total / Times Counted value.
 */
(() => {
  function branchCode() {
    return String(getSelectedBranch()?.name || "Branch").trim().toUpperCase();
  }

  function numeric(value) {
    const number = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : 0;
  }

  function officialReportTotal() {
    if (!state.workbook) return 0;
    let result = 0;

    state.workbook.SheetNames.forEach((sheetName) => {
      workbookMatrix(state.workbook, sheetName).forEach((row) => {
        const hasTotal = row.some((cell) => normalizeText(cell) === "total");
        if (!hasTotal) return;

        row.forEach((cell) => {
          const number = numeric(cell);
          if (number > result && number <= 100000) result = number;
        });
      });
    });

    return Math.round(result);
  }

  function namedEmployeeTotal() {
    return Object.values(state.employeeTotals || {}).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0
    );
  }

  function varianceTotal() {
    return typeof pcVarianceTotal === "function"
      ? Number(pcVarianceTotal()) || 0
      : 0;
  }

  function batchesTotal() {
    const official = officialReportTotal();
    const remainder = official - namedEmployeeTotal() - varianceTotal();
    return official > 0 ? Math.max(0, remainder) : 0;
  }

  // Replace every public getter used by the older wrappers.
  if (typeof rrGetOfficialReportTotal === "function") {
    rrGetOfficialReportTotal = officialReportTotal;
  }
  if (typeof rrGetBatchesTotal !== "undefined") {
    rrGetBatchesTotal = batchesTotal;
  }
  if (typeof acGetUnassignedBatchTotal !== "undefined") {
    acGetUnassignedBatchTotal = batchesTotal;
  }

  function ensureBatchesCard(total) {
    const cards = $("productionCards");
    if (!cards) return null;

    let card = cards.querySelector("[data-unassigned-batches-card]");
    if (!card && total > 0) {
      card = document.createElement("article");
      card.className = "summary-card";
      card.dataset.unassignedBatchesCard = "true";
      card.innerHTML = `
        <div class="summary-card-top">
          <div>
            <strong>Batches</strong>
            <span></span>
          </div>
          <b></b>
        </div>
        <div class="percent-row"></div>
      `;
      cards.appendChild(card);
    }
    return card;
  }

  function applyOfficialReconciliation() {
    if (!state.workbook) return;

    const official = officialReportTotal();
    if (!official) return;

    const named = namedEmployeeTotal();
    const variances = varianceTotal();
    const batches = Math.max(0, official - named - variances);
    const code = branchCode();

    const card = ensureBatchesCard(batches);
    if (card) {
      card.dataset.supportTotal = "true";
      const description = card.querySelector(".summary-card-top span");
      const totalElement = card.querySelector(".summary-card-top b");
      const row = card.querySelector(".percent-row");
      if (description) {
        description.textContent = `${code} report remainder included in overall completion`;
      }
      if (totalElement) totalElement.textContent = String(batches);
      card.querySelector(".meter")?.remove();
      if (row) {
        row.innerHTML =
          `<span>Support total</span><small>${batches} added to overall completion • no individual 200-count goal</small>`;
      }
    }

    const varianceCard = document.querySelector(
      "#productionCards [data-variance-reports-card]"
    );
    if (varianceCard) {
      varianceCard.dataset.supportTotal = "true";
      varianceCard.querySelector(".meter")?.remove();
    }

    const kpis = Array.from(document.querySelectorAll("#kpiStrip .kpi"));
    if (kpis[0]) {
      const label = kpis[0].querySelector("span");
      const value = kpis[0].querySelector("strong");
      if (label) label.textContent = "Overall Completed Counts";
      if (value) value.textContent = String(official);
    }

    const requiredGoal = numeric(kpis[2]?.querySelector("strong")?.textContent);
    if (kpis[3] && requiredGoal > 0) {
      const value = kpis[3].querySelector("strong");
      if (value) value.textContent = `${((official / requiredGoal) * 100).toFixed(1)}%`;
    }

    const summary = $("recordSummary");
    if (summary) {
      summary.textContent =
        `${official} total production • ${variances} Variance Reports • ${batches} Batches`;
    }

    const input = $("officialReportTotal");
    if (input) input.value = String(official);

    state.officialReportTotal = official;
    state.reconciledBatchesTotal = batches;
  }

  const previousRenderResults = renderResults;
  renderResults = function renderResultsWithOfficialReconciliation() {
    previousRenderResults();
    window.setTimeout(applyOfficialReconciliation, 0);
  };

  const previousSelectBranch = selectBranch;
  selectBranch = function selectBranchWithOfficialReconciliation(branchId) {
    const selected = previousSelectBranch(branchId);
    if (selected) window.setTimeout(applyOfficialReconciliation, 0);
    return selected;
  };

  ["sourceFile", "alreadyCountedFile"].forEach((id) => {
    $(id)?.addEventListener("change", () => {
      window.setTimeout(applyOfficialReconciliation, 600);
    });
  });

  $("matchAlreadyCountedBtn")?.addEventListener("click", () => {
    window.setTimeout(applyOfficialReconciliation, 200);
  });

  const observer = new MutationObserver(() => {
    if (!state.workbook) return;
    window.clearTimeout(window.__officialReconcileTimer);
    window.__officialReconcileTimer = window.setTimeout(
      applyOfficialReconciliation,
      25
    );
  });

  const results = $("resultsSection");
  if (results) {
    observer.observe(results, { childList: true, subtree: true });
  }
})();
