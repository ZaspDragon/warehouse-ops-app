"use strict";
// Daily production journal. Records are scoped by branch and work date.
// The live report must be filtered to the chosen date before saving.
(function () {
  const KEY = "cycleCountProduction.dailyJournal.v1";
  const el = (id) => document.getElementById(id);
  const today = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  };
  function read() {
    try { const data = JSON.parse(localStorage.getItem(KEY) || "{}"); return data && typeof data === "object" && !Array.isArray(data) ? data : {}; }
    catch (e) { return {}; }
  }
  function write(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch (e) { status("Unable to save: browser storage unavailable.", true); return false; }
  }
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const branchId = () => String(state.selectedBranchId || getSelectedBranch()?.id || "default");
  const date = () => el("dailyJournalDate")?.value || today();
  const key = () => JSON.stringify([branchId(), date()]);
  function status(message, error) {
    const node = el("dailyJournalMessage");
    if (node) { node.textContent = message; node.style.color = error ? "#b91c1c" : "#166534"; }
  }
  function currentRecord() { return read()[key()] || null; }
  function roster() {
    const existing = currentRecord();
    const assignments = getAssignments();
    const saved = existing?.people || {};
    const ids = new Set();
    const people = assignments.map((assignment) => {
      ids.add(assignment.id);
      const prior = saved[assignment.id] || {};
      return { id: assignment.id, name: assignment.name, goal: Number(prior.goal ?? assignment.dailyGoal ?? getSelectedBranch()?.dailyGoal ?? 200) || 200, counts: prior.counts ?? null, notes: prior.notes || "" };
    });
    // Retain previously saved people even if they have since left the team.
    Object.entries(saved).forEach(([id, prior]) => { if (!ids.has(id)) people.push({id, name: prior.name || "Former employee",goal:Number(prior.goal)||200,counts:prior.counts??null,notes:prior.notes||""}); });
    return people;
  }
  function render() {
    const body = el("dailyJournalRows");
    if (!body) return;
    const record = currentRecord();
    const people = roster();
    body.innerHTML = people.map((person) => {
      const actual = person.counts === null ? null : Number(person.counts);
      const pct = actual === null ? "—" : (actual / person.goal * 100).toFixed(1) + "%";
      return '<tr><td><strong>' + escape(person.name) + '</strong></td><td>' +
        (actual === null ? "—" : actual) + '</td><td>' + person.goal + '</td><td><strong>' + pct +
        '</strong></td><td><textarea class="daily-note" rows="2" maxlength="2000" data-person="' + escape(person.id) +
        '" aria-label="Notes for ' + escape(person.name) + '" placeholder="Reason for shortfall, training, inventory issues, or other notes">' +
        escape(person.notes) + '</textarea></td></tr>';
    }).join("") || '<tr><td colspan="5">Add employees to the team to start tracking.</td></tr>';
    const summary = el("dailyJournalSummary");
    if (summary) summary.textContent = record?.capturedAt
      ? "Saved production for " + date() + " • updated " + new Date(record.capturedAt).toLocaleString()
      : "No production saved for " + date() + ". Notes can still be saved.";
    const dates = el("dailyJournalSavedDates");
    if (dates) {
      const all = read();
      const available = Object.values(all).filter((entry) => entry && entry.branchId === branchId()).map((entry) => entry.date).filter(Boolean).sort().reverse();
      dates.innerHTML = '<option value="">Select a saved date</option>' + [...new Set(available)].map((d) => '<option value="' + escape(d) + '">' + escape(d) + '</option>').join("");
    }
  }
  function saveNotes(personId, value) {
    const data = read();
    const existing = data[key()] || {branchId:branchId(),date:date(),people:{}};
    if (!existing.people) existing.people = {};
    const match = getAssignments().find((a) => a.id === personId);
    existing.people[personId] = {
      ...(existing.people[personId] || {}),
      name: match?.name || existing.people[personId]?.name || personId,
      goal: existing.people[personId]?.goal || Number(match?.dailyGoal) || 200,
      notes: value.slice(0,2000)
    };
    existing.branchId = branchId();
    existing.date = date();
    data[key()] = existing;
    if (write(data)) status("Notes saved for " + date() + ".");
  }
  function capture() {
    if (!state.workbook) { status("Upload and process the Cycle Count Detail report for this date first.", true); return; }
    if (!window.confirm("Save the currently loaded production totals as " + date() + "? Confirm the report only includes counts for this work date.")) return;
    const data = read();
    const existing = data[key()] || {people:{}};
    const people = {...(existing.people || {})};
    getAssignments().forEach((a) => {
      people[a.id] = {
        name:a.name,
        goal:Number(a.dailyGoal) > 0 ? Number(a.dailyGoal) : Number(getSelectedBranch()?.dailyGoal) || 200,
        counts:Number(state.employeeTotals[a.name] || 0),
        notes:people[a.id]?.notes || ""
      };
    });
    data[key()] = {branchId:branchId(),date:date(),people,capturedAt:new Date().toISOString(),reportName:state.uploadedFileName||""};
    if (write(data)) {render();status("Daily production saved for " + date() + ".");}
  }
  function exportCsv() {
    const record = currentRecord();
    if (!record) { status("There is no daily record for this date.",true); return; }
    const rows = [["Date","Branch","Employee","Counts","Goal","Percentage","Notes"]];
    const branch = getSelectedBranch()?.name || "";
    roster().forEach((p) => rows.push([date(),branch,p.name,p.counts??"",p.goal,p.counts===null?"":(Number(p.counts)/p.goal*100).toFixed(1)+"%",p.notes]));
    const csv=rows.map((row)=>row.map((v)=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");link.href=url;link.download="cycle-production-"+date()+".csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  document.addEventListener("DOMContentLoaded", () => {
    const holder = el("dailyJournal");
    if (!holder) return;
    el("dailyJournalDate").value=today();
    el("dailyJournalDate").addEventListener("change", render);
    el("dailyJournalSavedDates").addEventListener("change", (e) => {if(e.target.value){el("dailyJournalDate").value=e.target.value;render();}});
    el("dailyJournalCapture").addEventListener("click",capture);
    el("dailyJournalExport").addEventListener("click",exportCsv);
    el("dailyJournalRows").addEventListener("change",(e)=>{if(e.target.matches(".daily-note"))saveNotes(e.target.dataset.person,e.target.value);});
    el("dailyJournalRows").addEventListener("focusout",(e)=>{if(e.target.matches(".daily-note"))saveNotes(e.target.dataset.person,e.target.value);});
    el("branchSelect")?.addEventListener("change",()=>setTimeout(render,0));
    render();
  });
})();