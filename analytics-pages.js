(() => {
  const page = document.body.dataset.analyticsPage;
  const storageKey = page === "adjustments" ? "warehouseOS_adjustments_v1" : "warehouseOS_cycleTiming_v1";
  const $ = (id) => document.getElementById(id);
  let records = readSaved();
  let duplicateUploadRows = 0;

  function readSaved() {
    try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; }
  }

  function saveRecords() {
    localStorage.setItem(storageKey, JSON.stringify(records));
  }

  function text(value) { return String(value ?? "").trim(); }
  function esc(value) { return text(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
  function number(value) {
    const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function dateKey(value) {
    if (!value) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    if (typeof value === "number" && value > 20000 && window.XLSX?.SSF?.parse_date_code) {
      const d = XLSX.SSF.parse_date_code(value);
      return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : "";
    }
    const direct = text(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (direct) return `${direct[1]}-${direct[2].padStart(2, "0")}-${direct[3].padStart(2, "0")}`;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : dateKey(parsed);
  }
  function timeParts(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return { seconds: value.getHours() * 3600 + value.getMinutes() * 60 + value.getSeconds(), label: value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) };
    if (typeof value === "number") {
      const seconds = Math.round((value % 1) * 86400) % 86400;
      return { seconds, label: secondsLabel(seconds) };
    }
    const match = text(value).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!match) return { seconds: 0, label: text(value) };
    let hour = Number(match[1]);
    const suffix = (match[4] || "").toUpperCase();
    if (suffix === "PM" && hour < 12) hour += 12;
    if (suffix === "AM" && hour === 12) hour = 0;
    const seconds = hour * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
    return { seconds, label: secondsLabel(seconds) };
  }
  function secondsLabel(seconds) {
    const date = new Date(2000, 0, 1, 0, 0, Number(seconds) || 0);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function duration(minutes) {
    if (!Number.isFinite(minutes)) return "-";
    const rounded = Math.round(minutes);
    return rounded >= 60 ? `${Math.floor(rounded / 60)}h ${rounded % 60}m` : `${rounded}m`;
  }
  function keyName(value) { return text(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function findHeader(rows, required) {
    return rows.findIndex((row) => required.every((wanted) => row.some((cell) => keyName(cell) === wanted)));
  }
  function rowObject(headers, row) {
    const out = {};
    headers.forEach((header, index) => { if (keyName(header)) out[keyName(header)] = row[index]; });
    return out;
  }
  function setMessage(message, error = false) {
    $("analyticsMessage").textContent = message;
    $("analyticsMessage").style.color = error ? "#b42318" : "";
  }

  async function readWorkbook(file) {
    if (!window.XLSX) throw new Error("Excel reader did not load. Refresh the page and try again.");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    return workbook.SheetNames.flatMap((name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: "" }));
  }

  function parseAdjustments(rows) {
    const headerIndex = findHeader(rows, ["docdate", "item", "qty", "user"]);
    if (headerIndex < 0) throw new Error("Could not find the adjustment report headings (Doc Date, Item #, Qty, User).");
    const headers = rows[headerIndex];
    return rows.slice(headerIndex + 1).map((row) => rowObject(headers, row)).filter((row) => dateKey(row.docdate) && text(row.item)).map((row) => {
      const qty = number(row.qty);
      const item = text(row.item).replace(/\.0$/, "");
      const doc = text(row.doc).replace(/\.0$/, "");
      const record = { date: dateKey(row.docdate), doc, item, description: text(row.description), reason: text(row.reason), uom: text(row.uom), qty, cost: number(row.cost), gainLoss: number(row.gainloss), user: text(row.user), direction: qty >= 0 ? "Added" : "Removed" };
      record.id = [record.date, doc, item, qty, record.user, record.reason].join("|").toLowerCase();
      return record;
    });
  }

  function parseCycleTiming(rows) {
    const output = [];
    let status = "";
    let headers = null;
    rows.forEach((row) => {
      const first = keyName(row[0]);
      if (first === "posted" || first === "unposted") { status = first.toUpperCase(); headers = null; return; }
      if (row.some((cell) => keyName(cell) === "stockcountid") && row.some((cell) => keyName(cell) === "countstarttime")) { headers = row; return; }
      if (!headers || !status) return;
      const source = rowObject(headers, row);
      const countId = text(source.stockcountid);
      const date = dateKey(source.countstartdate || source.docdate);
      const time = timeParts(source.countstarttime);
      if (!countId || !date || !time.label) return;
      const record = { countId, date, startTime: time.label, seconds: time.seconds, status, docDate: dateKey(source.docdate) };
      record.id = [date, time.seconds, countId, status].join("|").toLowerCase();
      output.push(record);
    });
    if (!output.length) throw new Error("Could not find posted or unposted cycle-count rows in this report.");
    return output;
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setMessage(`Reading ${file.name}…`);
      const incoming = page === "adjustments" ? parseAdjustments(await readWorkbook(file)) : parseCycleTiming(await readWorkbook(file));
      const ids = new Set(records.map((record) => record.id));
      const additions = incoming.filter((record) => !ids.has(record.id));
      duplicateUploadRows = incoming.length - additions.length;
      records = [...records, ...additions];
      saveRecords();
      render();
      setMessage(`${additions.length} new row${additions.length === 1 ? "" : "s"} imported. ${duplicateUploadRows} duplicate upload row${duplicateUploadRows === 1 ? "" : "s"} skipped.`);
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Upload failed.", true);
    } finally { event.target.value = ""; }
  }

  function inRange(record) {
    const start = $("filterStart").value;
    const end = $("filterEnd").value;
    const search = $("filterSearch").value.trim().toLowerCase();
    if (start && record.date < start) return false;
    if (end && record.date > end) return false;
    if (page === "adjustments" && $("filterDirection").value && record.direction !== $("filterDirection").value) return false;
    if (page === "cycleTiming" && $("filterStatus").value && record.status !== $("filterStatus").value) return false;
    return !search || Object.values(record).some((value) => text(value).toLowerCase().includes(search));
  }

  function adjustmentRows() {
    const occurrences = new Map();
    records.forEach((record) => {
      const uniqueEvent = `${record.date}|${record.doc}`;
      if (!occurrences.has(record.item)) occurrences.set(record.item, new Set());
      occurrences.get(record.item).add(uniqueEvent);
    });
    return records.filter(inRange).map((record) => ({ ...record, repeat: (occurrences.get(record.item)?.size || 0) > 1 })).sort((a, b) => `${b.date}|${b.doc}`.localeCompare(`${a.date}|${a.doc}`));
  }

  function timedCycleRows() {
    const filtered = records.filter(inRange).sort((a, b) => `${a.date}|${String(a.seconds).padStart(5, "0")}`.localeCompare(`${b.date}|${String(b.seconds).padStart(5, "0")}`));
    let previous = null;
    return filtered.map((record) => {
      const sameDay = previous?.date === record.date;
      const gapMinutes = sameDay ? (record.seconds - previous.seconds) / 60 : null;
      const row = { ...record, previousCount: sameDay ? previous.countId : "First count", gapMinutes };
      previous = record;
      return row;
    });
  }

  function renderAdjustments() {
    const rows = adjustmentRows();
    const added = rows.filter((row) => row.qty > 0).reduce((sum, row) => sum + row.qty, 0);
    const removed = Math.abs(rows.filter((row) => row.qty < 0).reduce((sum, row) => sum + row.qty, 0));
    const gains = rows.filter((row) => row.gainLoss > 0).reduce((sum, row) => sum + row.gainLoss, 0);
    const losses = Math.abs(rows.filter((row) => row.gainLoss < 0).reduce((sum, row) => sum + row.gainLoss, 0));
    const currency = (value) => value.toLocaleString(undefined, { style: "currency", currency: "USD" });
    $("adjustmentCount").textContent = rows.length.toLocaleString();
    $("addedQty").textContent = added.toLocaleString();
    $("removedQty").textContent = removed.toLocaleString();
    $("netQty").textContent = (added - removed).toLocaleString();
    $("duplicateCount").textContent = duplicateUploadRows.toLocaleString();
    $("repeatCount").textContent = new Set(rows.filter((row) => row.repeat).map((row) => row.item)).size.toLocaleString();
    $("bottomAddedQty").textContent = added.toLocaleString();
    $("bottomRemovedQty").textContent = removed.toLocaleString();
    $("bottomNetQty").textContent = (added - removed).toLocaleString();
    $("bottomGainValue").textContent = currency(gains);
    $("bottomLossValue").textContent = currency(losses);
    $("bottomNetValue").textContent = currency(gains - losses);

    const repeatedItems = [...rows.reduce((groups, row) => {
      const group = groups.get(row.item) || {
        item: row.item,
        description: row.description,
        count: 0,
        added: 0,
        removed: 0,
        users: new Set(),
        dates: new Set()
      };
      group.count += 1;
      if (row.qty >= 0) group.added += row.qty;
      else group.removed += Math.abs(row.qty);
      if (row.user) group.users.add(row.user);
      if (row.date) group.dates.add(row.date);
      groups.set(row.item, group);
      return groups;
    }, new Map()).values()]
      .filter((group) => group.count > 1)
      .sort((a, b) => b.count - a.count || a.item.localeCompare(b.item));

    $("bottomRepeatItemCount").textContent = repeatedItems.length.toLocaleString();
    $("repeatedItemsBody").innerHTML = repeatedItems.length
      ? repeatedItems.map((group) => `<tr><td>${esc(group.item)}</td><td>${esc(group.description)}</td><td class="numeric">${group.count.toLocaleString()}</td><td class="numeric">${group.added.toLocaleString()}</td><td class="numeric">${group.removed.toLocaleString()}</td><td class="numeric">${(group.added - group.removed).toLocaleString()}</td><td>${esc([...group.users].join(", "))}</td><td>${esc([...group.dates].sort().join(", "))}</td></tr>`).join("")
      : '<tr><td colspan="8">No repeated item numbers in the current results.</td></tr>';
    $("analyticsBody").innerHTML = rows.length ? rows.map((row) => `<tr><td>${esc(row.date)}</td><td>${esc(row.item)}</td><td>${esc(row.description)}</td><td class="numeric">${row.qty.toLocaleString()}</td><td><span class="badge badge-${row.direction.toLowerCase()}">${row.direction}</span></td><td>${esc(row.reason)}</td><td>${esc(row.user)}</td><td>${esc(row.doc)}</td><td class="numeric">${row.gainLoss.toLocaleString(undefined, { style: "currency", currency: "USD" })}</td><td>${row.repeat ? '<span class="badge badge-repeat">Yes</span>' : "No"}</td></tr>`).join("") : '<tr><td colspan="10">No adjustments match these filters.</td></tr>';
    return rows;
  }

  function renderCycleTiming() {
    const rows = timedCycleRows();
    const gaps = rows.map((row) => row.gapMinutes).filter(Number.isFinite);
    const threshold = Math.max(1, number($("gapThreshold").value) || 30);
    $("countTotal").textContent = rows.length.toLocaleString();
    $("postedTotal").textContent = rows.filter((row) => row.status === "POSTED").length.toLocaleString();
    $("unpostedTotal").textContent = rows.filter((row) => row.status === "UNPOSTED").length.toLocaleString();
    $("averageGap").textContent = gaps.length ? duration(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) : "-";
    $("longestGap").textContent = gaps.length ? duration(Math.max(...gaps)) : "-";
    $("overThreshold").textContent = gaps.filter((gap) => gap > threshold).length.toLocaleString();
    $("analyticsBody").innerHTML = rows.length ? rows.map((row) => { const long = Number.isFinite(row.gapMinutes) && row.gapMinutes > threshold; return `<tr><td>${esc(row.date)}</td><td>${esc(row.startTime)}</td><td>${esc(row.countId)}</td><td><span class="badge badge-${row.status.toLowerCase()}">${row.status}</span></td><td>${esc(row.previousCount)}</td><td>${duration(row.gapMinutes)}</td><td>${long ? '<span class="badge badge-long">Long gap</span>' : "-"}</td></tr>`; }).join("") : '<tr><td colspan="7">No cycle counts match these filters.</td></tr>';
    return rows;
  }

  function csvCell(value) { return `"${text(value).replace(/"/g, '""')}"`; }
  function exportCsv() {
    const rows = page === "adjustments" ? adjustmentRows() : timedCycleRows();
    if (!rows.length) return setMessage("There is no filtered data to export.", true);
    const headers = page === "adjustments" ? ["Date", "Item #", "Description", "Qty", "Direction", "Reason", "User", "Document #", "Gain/Loss", "Adjusted Again"] : ["Date", "Start Time", "Count ID", "Status", "Previous Count", "Minutes Since Previous"];
    const values = page === "adjustments" ? rows.map((row) => [row.date, row.item, row.description, row.qty, row.direction, row.reason, row.user, row.doc, row.gainLoss, row.repeat ? "Yes" : "No"]) : rows.map((row) => [row.date, row.startTime, row.countId, row.status, row.previousCount, Number.isFinite(row.gapMinutes) ? row.gapMinutes.toFixed(2) : ""]);
    const blob = new Blob([[headers, ...values].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${page === "adjustments" ? "inventory-adjustments" : "cycle-count-timing"}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function render() { return page === "adjustments" ? renderAdjustments() : renderCycleTiming(); }
  $("analyticsFile").addEventListener("change", importFile);
  $("exportAnalytics").addEventListener("click", exportCsv);
  $("clearAnalyticsData").addEventListener("click", () => {
    if (!confirm("Clear all saved uploads from this browser?")) return;
    records = []; duplicateUploadRows = 0; localStorage.removeItem(storageKey); render(); setMessage("Saved uploads cleared.");
  });
  ["filterStart", "filterEnd", "filterSearch", "filterDirection", "filterStatus", "gapThreshold"].forEach((id) => $(id)?.addEventListener(id === "filterSearch" ? "input" : "change", render));
  render();
})();
