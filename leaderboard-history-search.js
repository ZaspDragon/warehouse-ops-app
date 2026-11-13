(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const cleanDate = value => {
    if (!value) return "";
    if (typeof localDateKey === "function") return localDateKey(value);
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return "";
  };
  function sourceGroups() {
    const records = typeof state !== "undefined" && Array.isArray(state.putawayLogs) ? state.putawayLogs : [];
    if (typeof buildPutawayDailyGroups !== "function") return {groups:[],count:records.length};
    return {groups:buildPutawayDailyGroups(records),count:records.length};
  }
  function findRows(groups, name, selectedDate) {
    const matches = new Map();
    let undated = 0, otherDates = 0;
    for (const group of groups) {
      for (const line of group.lines || []) {
        if (line.active === false) continue;
        const employee = String(line.employeeName || line.worker || group.employeeName || group.worker || "Unknown").trim() || "Unknown";
        if (name && !employee.toLocaleLowerCase().includes(name)) continue;
        const date = cleanDate(line.workDate || line.submittedDate || line.submittedAt ||
          group.workDate || group.date || group.createdAt);
        if (!date) {undated++;continue;}
        if (selectedDate && date !== selectedDate) {otherDates++;continue;}
        const key = employee.toLocaleLowerCase() + "|" + date;
        let row = matches.get(key);
        if (!row) {
          row = {employee,date,count:0,qty:0,items:new Map()};
          matches.set(key,row);
        }
        const item = String(line.itemNumber || line.item || line.sku || "Unknown").trim() || "Unknown";
        const n = Number(line.quantity ?? line.qty ?? 0), qty = Number.isFinite(n) ? n : 0;
        row.count++;
        row.qty+=qty;
        row.items.set(item,(row.items.get(item)||0)+qty);
      }
    }
    return {
      results:[...matches.values()].sort((a,b) => b.date.localeCompare(a.date) || b.count-a.count || a.employee.localeCompare(b.employee)),
      undated,otherDates
    };
  }
  function showSearch(data,loaded) {
    const body = $("leaderboardHistorySearchResults");
    const status = $("leaderboardHistorySearchStatus");
    const {results,undated,otherDates} = data;
    body.innerHTML = results.length
      ? results.map(r => `<tr><td>${escape(r.employee)}</td><td>${escape(r.date)}</td><td>${r.count}</td><td>${r.qty.toLocaleString()}</td><td>${escape([...r.items].map(([item,qty])=>item+" ("+qty+")").join(", "))}</td></tr>`).join("")
      : '<tr><td colspan="5">No matching saved putaway lines in the loaded history.</td></tr>';
    const counted = results.reduce((sum,row)=>sum+row.count,0);
    status.textContent = `${results.length} employee/date result(s) · ${counted} saved lines · ${loaded} loaded source record(s).`+
      (otherDates ? ` ${otherDates} matching line(s) have different saved dates.` : "")+
      (undated ? ` ${undated} matching line(s) have no usable date and need review.` : "")+
      (!loaded ? " Check sign-in or whether History is accessible to this account." : "");
  }
  async function search() {
    const button = $("leaderboardHistorySearchBtn");
    if (!button) return;
    const name = $("leaderboardHistoryName").value.trim().toLocaleLowerCase();
    const date = $("leaderboardHistoryDate").value;
    button.disabled = true;
    $("leaderboardHistorySearchStatus").textContent = "Refreshing saved putaway history…";
    try {
      if (typeof state !== "undefined" && !state.isDemoMode && typeof window.loadHistory === "function") {
        await window.loadHistory();
      }
      const {groups,count} = sourceGroups();
      showSearch(findRows(groups,name,date),count);
    } catch(err) {
      $("leaderboardHistorySearchStatus").textContent = "Could not refresh history: " + String(err?.message || err) +
        ". No records were changed.";
    } finally {button.disabled = false;}
  }
  function useSelectedDate() {
    const start = $("leaderboardStartDate")?.value || "";
    const end = $("leaderboardEndDate")?.value || "";
    $("leaderboardHistoryDate").value = start === end ? start : (end || start);
  }
  $("leaderboardHistorySearchBtn")?.addEventListener("click",search);
  $("leaderboardHistoryResetBtn")?.addEventListener("click", () => {useSelectedDate();search();});
  $("leaderboardHistoryName")?.addEventListener("keydown",event => {
    if (event.key === "Enter") {event.preventDefault();search();}
  });
  $("leaderboardHistoryDate")?.addEventListener("keydown",event => {
    if (event.key === "Enter") {event.preventDefault();search();}
  });
  useSelectedDate();
})();