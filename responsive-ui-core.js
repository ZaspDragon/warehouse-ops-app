(function () {
  const HISTORY_TYPES = {
    putaway: "Put Away Log",
    cycle: "Cycle Count",
    picking: "Order Picking",
    receiving: "Receiving"
  };

  document.addEventListener("DOMContentLoaded", () => {
    installResponsiveShell();
    installTableLabels();
    installReceivingHistoryTab();
    installAdminDetailsPanel();
    watchTableChanges();
    syncResponsiveTitle();
  });

  function installResponsiveShell() {
    if (document.getElementById("mobileMenuBtn")) return;

    const topbar = document.querySelector(".topbar");
    const titleBlock = topbar?.querySelector("div:first-child");
    const tabs = document.querySelector(".tabs");
    if (!topbar || !titleBlock || !tabs) return;

    topbar.insertAdjacentHTML(
      "afterbegin",
      `<button id="mobileMenuBtn" class="mobile-menu-btn" aria-expanded="false" aria-controls="appNavigation" aria-label="Open navigation">Menu</button>`
    );
    titleBlock.insertAdjacentHTML("beforeend", `<p id="currentPageTitle" class="current-page-title">Put Away Log</p>`);
    tabs.id = "appNavigation";
    tabs.setAttribute("aria-label", "Main navigation");
    tabs.insertAdjacentHTML("beforebegin", `<div id="navScrim" class="nav-scrim" hidden></div>`);

    document.getElementById("mobileMenuBtn")?.addEventListener("click", toggleNav);
    document.getElementById("navScrim")?.addEventListener("click", closeNav);
    tabs.addEventListener("click", (event) => {
      if (event.target.closest(".tab")) {
        closeNav();
        setTimeout(syncResponsiveTitle, 0);
      }
    });
  }

  function toggleNav() {
    const open = !document.body.classList.contains("nav-open");
    document.body.classList.toggle("nav-open", open);
    document.getElementById("mobileMenuBtn")?.setAttribute("aria-expanded", String(open));
    const scrim = document.getElementById("navScrim");
    if (scrim) scrim.hidden = !open;
  }

  function closeNav() {
    document.body.classList.remove("nav-open");
    document.getElementById("mobileMenuBtn")?.setAttribute("aria-expanded", "false");
    const scrim = document.getElementById("navScrim");
    if (scrim) scrim.hidden = true;
  }

  function syncResponsiveTitle() {
    const active = document.querySelector(".tab.active");
    const title = active?.textContent?.trim() || "Warehouse Logs";
    const current = document.getElementById("currentPageTitle");
    if (current) current.textContent = title;
  }

  function installTableLabels(root = document) {
    root.querySelectorAll("table").forEach((table) => {
      const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      table.querySelectorAll("tbody tr").forEach((row) => {
        [...row.children].forEach((cell, index) => {
          if (headers[index] && !cell.getAttribute("data-label")) {
            cell.setAttribute("data-label", headers[index]);
          }
        });
      });
    });
  }

  function watchTableChanges() {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes.length)) {
        installTableLabels();
      }
    });
    document.querySelectorAll("tbody").forEach((body) => {
      observer.observe(body, { childList: true, subtree: true });
    });
  }

  function installReceivingHistoryTab() {
    const historyTabs = document.querySelector(".history-tabs");
    if (!historyTabs || document.querySelector('[data-history-tab="receiving"]')) return;

    historyTabs.insertAdjacentHTML("beforeend", `<button class="history-tab" data-history-tab="receiving">Receiving</button>`);
    document.getElementById("pickingHistoryPanel")?.insertAdjacentHTML(
      "afterend",
      `
      <section id="receivingHistoryPanel" class="history-panel">
        <div class="history-toolbar">
          <label>Start Date
            <input id="receivingHistoryStart" type="date" />
          </label>
          <label>End Date
            <input id="receivingHistoryEnd" type="date" />
          </label>
          <label>Search
            <input id="receivingHistorySearch" placeholder="Item, worker, note, or status" />
          </label>
          <div class="actions">
            <button id="receivingHistoryFilterBtn" class="primary">Search / Filter</button>
            <button id="receivingHistoryClearBtn">Clear Filter</button>
            <button id="receivingHistoryExportBtn">Export Receiving History CSV</button>
          </div>
        </div>

        <div class="table-wrap small history-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date Completed</th>
                <th>Worker</th>
                <th>Lines</th>
                <th>Total Qty</th>
                <th>Status</th>
                <th>Preview / Details</th>
              </tr>
            </thead>
            <tbody id="receivingHistoryBody"></tbody>
          </table>
        </div>
      </section>
    `
    );

    historyTabs.addEventListener("click", (event) => {
      const button = event.target.closest(".history-tab");
      if (!button) return;
      switchResponsiveHistoryTab(button.dataset.historyTab);
    });

    document.getElementById("receivingHistoryFilterBtn")?.addEventListener("click", renderReceivingHistory);
    document.getElementById("receivingHistoryClearBtn")?.addEventListener("click", clearReceivingHistory);
    document.getElementById("receivingHistoryExportBtn")?.addEventListener("click", exportReceivingHistory);
    renderReceivingHistory();
  }

  function switchResponsiveHistoryTab(type) {
    if (!type) return;
    document.querySelectorAll(".history-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.historyTab === type);
    });
    document.querySelectorAll(".history-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `${type}HistoryPanel`);
    });
    if (type === "receiving") renderReceivingHistory();
  }

  function getReceivingRecords() {
    const appState = typeof state !== "undefined" ? state : {};
    const fromState = Array.isArray(appState.receivingLines) ? appState.receivingLines : [];
    const fromDemo = readDemoReceivingRecords();
    const putawayAsReceiving = Array.isArray(appState.putawayLogs) ? appState.putawayLogs.filter((log) => log.receivedAt || log.receivedTime) : [];
    return [...fromState, ...fromDemo, ...putawayAsReceiving].map(normalizeReceivingRecord);
  }

  function readDemoReceivingRecords() {
    try {
      const raw = localStorage.getItem("warehouseOpsDemoStateV1");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.receivingLines) ? parsed.receivingLines : [];
    } catch {
      return [];
    }
  }

  function normalizeReceivingRecord(record) {
    const lines = Array.isArray(record.lines) ? record.lines : [];
    const totalQty = lines.reduce((sum, line) => sum + Number(line.qty || line.quantity || 0), 0);
    return {
      completedDate: normalizeDate(record.completedDate || record.date || record.createdAt || record.receivedAt || record.receivedTime),
      worker: record.worker || record.createdByEmail || record.createdBy || "",
      lines,
      totalQty,
      status: record.status || "Submitted",
      preview: lines.slice(0, 3).map((line) => `${line.item || line.itemNumber || ""} x${line.qty || line.quantity || 0}`).filter(Boolean).join("; ")
    };
  }

  function renderReceivingHistory() {
    const body = document.getElementById("receivingHistoryBody");
    if (!body) return;

    const start = document.getElementById("receivingHistoryStart")?.value || "";
    const end = document.getElementById("receivingHistoryEnd")?.value || "";
    const search = (document.getElementById("receivingHistorySearch")?.value || "").toLowerCase();
    const rows = getReceivingRecords()
      .filter((record) => {
        if (start && record.completedDate < start) return false;
        if (end && record.completedDate > end) return false;
        if (search && !JSON.stringify(record).toLowerCase().includes(search)) return false;
        return true;
      })
      .sort((a, b) => String(b.completedDate).localeCompare(String(a.completedDate)));

    body.innerHTML = rows.length
      ? rows.map((record) => `
        <tr>
          <td>${escapeHtml(record.completedDate)}</td>
          <td>${escapeHtml(record.worker)}</td>
          <td>${record.lines.length}</td>
          <td>${record.totalQty}</td>
          <td><span class="status-badge status-submitted">${escapeHtml(record.status)}</span></td>
          <td>${escapeHtml(record.preview || "No line preview")}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="6">No Receiving records found for this date range.</td></tr>`;

    installTableLabels(document.getElementById("receivingHistoryPanel"));
  }

  function clearReceivingHistory() {
    ["receivingHistoryStart", "receivingHistoryEnd", "receivingHistorySearch"].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = "";
    });
    renderReceivingHistory();
  }

  function exportReceivingHistory() {
    const rows = getReceivingRecords();
    const csvRows = [["Date Completed", "Worker", "Lines", "Total Qty", "Status", "Preview"], ...rows.map((record) => [
      record.completedDate,
      record.worker,
      record.lines.length,
      record.totalQty,
      record.status,
      record.preview
    ])];
    const csv = csvRows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `receiving-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function installAdminDetailsPanel() {
    const putawayCard = document.querySelector("#putawayTab > .card:first-child");
    if (!putawayCard || document.getElementById("adminDetailsPanel")) return;
    const grid = putawayCard.querySelector(".grid");
    const stats = putawayCard.querySelector(".stats");
    if (!grid || !stats) return;

    const detailFields = [];
    grid.querySelectorAll("label").forEach((label) => {
      if (/Received Time|Received At|Put Away Completed Time|Dock-to-Stock/i.test(label.textContent)) {
        label.classList.add("admin-detail-field");
        detailFields.push(label);
      }
    });
    stats.classList.add("admin-detail-field");

    if (!detailFields.length) return;

    const details = document.createElement("details");
    details.id = "adminDetailsPanel";
    details.className = "admin-details-panel";
    details.open = true;
    details.innerHTML = `<summary>Admin Details</summary><div class="admin-details-content"></div>`;
    const content = details.querySelector(".admin-details-content");
    detailFields.forEach((field) => content.appendChild(field));
    content.appendChild(stats);
    grid.insertAdjacentElement("afterend", details);
  }

  function normalizeDate(value) {
    if (!value) return "";
    const text = String(value);
    const iso = text.match(/\d{4}-\d{2}-\d{2}/);
    if (iso) return iso[0];
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }
})();
