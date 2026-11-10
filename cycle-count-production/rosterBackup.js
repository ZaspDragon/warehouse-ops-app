"use strict";
/* Portable team roster backup. No employee data is uploaded to a server. */
(() => {
  const KEY = "cycleCountProduction.branches.v1";
  const BACKUP = "cycleCountProduction.branches.backup.v1";
  const SELECTED = "cycleCountProduction.currentBranch.v1";
  const exportButton = document.getElementById("exportRosterBtn");
  const importButton = document.getElementById("importRosterBtn");
  const fileInput = document.getElementById("importRosterFile");
  const message = document.getElementById("teamMessage");

  function notify(text, error = false) {
    if (!message) return;
    message.textContent = text;
    message.classList.remove("hidden");
    message.classList.toggle("error", error);
  }
  function isValidRoster(branches) {
    return Array.isArray(branches) && branches.length > 0 &&
      branches.length <= 100 && branches.every(branch =>
        branch && typeof branch === "object" &&
        typeof branch.name === "string" &&
        Array.isArray(branch.assignments) &&
        branch.assignments.length <= 300 &&
        branch.assignments.every(member =>
          member && typeof member.name === "string" &&
          member.name.trim().length > 0 &&
          member.name.length <= 200 &&
          typeof member.startAisle === "string" &&
          typeof member.endAisle === "string"
        )
      );
  }
  exportButton?.addEventListener("click", () => {
    try {
      if (!isValidRoster(state.branches)) throw Error("No valid team roster to export.");
      const payload = {
        format: "cycle-count-roster",
        version: 1,
        exportedAt: new Date().toISOString(),
        selectedBranchId: state.selectedBranchId,
        branches: state.branches
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"}));
      const a = document.createElement("a");
      a.href = url;
      a.download = "cycle-count-team-roster-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Roster backup downloaded. Keep it somewhere safe; it includes employee names.");
    } catch (error) { notify(error.message || "Unable to export roster.", true); }
  });
  importButton?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      if (file.size > 2000000) throw Error("Roster file is too large.");
      const payload = JSON.parse(await file.text());
      if (payload.format !== "cycle-count-roster" || payload.version !== 1 ||
          !isValidRoster(payload.branches)) throw Error("This is not a valid Cycle Count roster backup.");
      if (!confirm("Restore this roster? This replaces the employee and branch setup on this browser. Saved production results will remain unchanged.")) return;
      const normalized = payload.branches.map(normalizeBranch).filter(Boolean);
      if (!isValidRoster(normalized)) throw Error("Some roster entries could not be restored.");
      const existing = localStorage.getItem(KEY);
      if (existing) localStorage.setItem("cycleCountProduction.branches.preImport.v1", existing);
      localStorage.setItem(KEY, JSON.stringify(normalized));
      localStorage.setItem(BACKUP, JSON.stringify(normalized));
      const selected = normalized.some(b => b.id === payload.selectedBranchId) ?
        payload.selectedBranchId : normalized[0].id;
      localStorage.setItem(SELECTED, selected);
      state.branches = normalized;
      state.selectedBranchId = selected;
      updateUIFromSelectedBranch();
      notify("Roster restored and saved on this browser.");
    } catch (error) { notify(error.message || "Unable to import roster.", true); }
  });
})();
