"use strict";

/*
 * Final daily reconciliation and ownership loaders.
 * The uploaded report total remains the source of truth, while ownership is
 * recalculated by ownershipPriorityFix.js after Already Counted matching.
 */
(() => {
  if (window.__dailyReportReconciliationInstalled) return;
  window.__dailyReportReconciliationInstalled = true;

  const numeric = (value) => {
    const number = Number(String(value ?? "").replace(/[$,]/g, "").trim());
    return Number.isFinite(number) ? number : 0;
  };

  function officialReportTotal() {
    if (!state.workbook) return 0;
    const candidates = [];

    state.workbook.SheetNames.forEach((sheetName) => {
      const matrix = workbookMatrix(state.workbook, sheetName);
      matrix.forEach((row, rowIndex) => {
        const labels = row.map((cell) => normalizeText(cell));
        const totalCycleColumn = labels.findIndex((label) => label.includes("total cycle count"));
        if (totalCycleColumn >= 0) {
          for (let index = rowIndex + 1; index < matrix.length; index += 1) {
            const nextRow = matrix[index] || [];
            if (!nextRow.some((cell) => normalizeText(cell) === "total")) continue;
            const value = numeric(nextRow[totalCycleColumn]);
            if (value > 0) candidates.push(value);
          }
        }
        if (labels.some((label) => label === "total")) {
          row.forEach((cell) => {
            const value = numeric(cell);
            if (value > 0 && value <= 100000) candidates.push(value);
          });
        }
      });
    });

    return candidates.length ? Math.round(Math.max(...candidates)) : 0;
  }

  function namedTotal() {
    return getAssignments().reduce((sum, assignment) => {
      if (/^(batches?|variance reports?)$/i.test(String(assignment?.name || "").trim())) return sum;
      return sum + (Number(state.employeeTotals?.[assignment.name]) || 0);
    }, 0);
  }

  function varianceTotal() {
    return typeof pcVarianceTotal === "function" ? Number(pcVarianceTotal()) || 0 : 0;
  }

  function batchesTotal() {
    const official = officialReportTotal();
    const unresolvedByReconciliation = official > 0
      ? Math.max(0, official - namedTotal() - varianceTotal())
      : 0;
    const parsedUnowned = Number.isFinite(Number(state.ownershipPriorityBatches))
      ? Math.max(0, Number(state.ownershipPriorityBatches) || 0)
      : 0;

    // Never allow parsed ownership gaps to make counts disappear. Any report
    // count not tied to a confirmed employee or variance owner remains in the
    // Batches review bucket until someone explicitly assigns it.
    return Math.max(parsedUnowned, unresolvedByReconciliation);
  }

  function ensureBatchesCard(total) {
    const cards = $("productionCards");
    if (!cards) return;
    let card = cards.querySelector("[data-unassigned-batches-card]");
    if (total <= 0) {
      card?.remove();
      return;
    }
    if (!card) {
      card = document.createElement("article");
      card.className = "summary-card";
      card.dataset.unassignedBatchesCard = "true";
      cards.appendChild(card);
    }
    card.innerHTML = `
      <div class="summary-card-top">
        <div><strong>Batches</strong><span>Counts without a confirmed worker</span></div>
        <b>${total}</b>
      </div>
      <div class="percent-row"><span>Needs review</span><small>Included once in the report total</small></div>
    `;
  }

  function reconcile() {
    if (!state.workbook) return;
    const official = officialReportTotal();
    if (!official) return;
    const variance = varianceTotal();
    const batches = batchesTotal();

    window.rrGetOfficialReportTotal = officialReportTotal;
    window.rrGetNamedEmployeeTotal = namedTotal;
    window.rrGetBatchesTotal = batchesTotal;
    window.acGetUnassignedBatchTotal = batchesTotal;

    ensureBatchesCard(batches);

    const kpis = Array.from(document.querySelectorAll("#kpiStrip .kpi"));
    if (kpis[0]) {
      const label = kpis[0].querySelector("span");
      const value = kpis[0].querySelector("strong");
      if (label) label.textContent = "Overall Completed Counts";
      if (value) value.textContent = String(official);
    }

    const requiredGoal = numeric(kpis[2]?.querySelector("strong")?.textContent);
    if (kpis[3]) {
      const value = kpis[3].querySelector("strong");
      if (value) value.textContent = requiredGoal > 0
        ? `${((official / requiredGoal) * 100).toFixed(1)}%`
        : "0.0%";
    }

    const summary = $("recordSummary");
    if (summary) {
      summary.textContent = `${official} total production • ${variance} Variance Reports • ${batches} Batches`;
    }

    state.dailyOfficialReportTotal = official;
    state.dailyBatchesTotal = batches;
  }

  const previousRenderResults = renderResults;
  renderResults = function renderResultsWithFinalReconciliation() {
    previousRenderResults();
    window.setTimeout(reconcile, 0);
  };

  ["sourceFile", "alreadyCountedFile", "branchSelect"].forEach((id) => {
    $(id)?.addEventListener("change", () => window.setTimeout(reconcile, 500));
  });
  $("matchAlreadyCountedBtn")?.addEventListener("click", () => window.setTimeout(reconcile, 500));

  function loadOnce(flag, source) {
    if (window[flag]) return;
    window[flag] = true;
    const script = document.createElement("script");
    script.src = `${source}?v=20260727-accuracy-${Date.now()}`;
    document.body.appendChild(script);
  }

  if (!document.getElementById("unassignedCountReviewSection")) {
    const results = document.getElementById("resultsSection");
    results?.insertAdjacentHTML("afterend", `
      <section id="unassignedCountReviewSection" class="card hidden">
        <div class="section-heading">
          <div><h2>Unassigned Count Review</h2><small>Only counts without confirmed initials or aisle ownership appear here.</small></div>
          <span id="unassignedCountReviewSummary" class="status"></span>
        </div>
        <div class="table-wrap">
          <table class="history-table">
            <thead><tr><th>Item</th><th>Bin</th><th>Batch</th><th>Counts</th><th>Count Date</th><th>Assign To</th></tr></thead>
            <tbody id="unassignedCountReviewBody"></tbody>
          </table>
        </div>
      </section>
    `);
  }

  loadOnce("__unassignedCountReviewLoader", "unassignedCountReview.js");
  loadOnce("__ownershipPriorityLoader", "ownershipPriorityFix.js");
  loadOnce("__productionAccuracyGuardLoader", "productionAccuracyGuard.js");
})();