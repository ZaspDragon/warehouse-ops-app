
/* =========================
   WAREHOUSE KPI SYSTEM
   SINGLE FILE VERSION
   ========================= */

/* ---------------- STATE ---------------- */

let records = JSON.parse(localStorage.getItem("warehouse")) || [];
let targets = JSON.parse(localStorage.getItem("targets")) || {
  laborProductivity: 25,
  receivingAccuracy: 99,
  pickAccuracy: 98,
  onTimeShipment: 95,
  inventoryAccuracy: 98
};

let activeDept = "receiving";

/* ---------------- INIT ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindDepartments();
  bindEntry();
  render();
});

/* ---------------- NAV ---------------- */

function bindNavigation() {
  document.querySelectorAll(".nav button").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".nav button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".container").forEach(c => c.classList.remove("active"));
      document.getElementById(btn.dataset.view).classList.add("active");

      render();
    };
  });
}

/* ---------------- DEPARTMENTS ---------------- */

function bindDepartments() {
  document.querySelectorAll(".dept").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".dept").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      activeDept = btn.dataset.dept;
      render();
    };
  });
}

/* ---------------- ENTRY ---------------- */

function bindEntry() {
  const saveBtn = document.getElementById("saveBtn");

  if (!saveBtn) return;

  saveBtn.onclick = () => {
    const entry = {
      id: Date.now(),
      date: val("date"),
      employee: val("employee"),
      department: val("department"),
      units: num("units"),
      hours: num("hours"),
      errors: num("errors") || 0,
      shipments: num("shipments") || 0,
      onTime: num("onTime") || 0,
      inventoryCount: num("inventoryCount") || 0
    };

    if (!entry.date || !entry.employee || !entry.department) {
      alert("Missing fields");
      return;
    }

    records.unshift(entry);
    save();
    render();
  };
}

/* ---------------- STORAGE ---------------- */

function save() {
  localStorage.setItem("warehouse", JSON.stringify(records));
}

/* ---------------- RENDER ---------------- */

function render() {
  renderKPI();
  renderTable();
  renderDeptTitle();
}

/* ---------------- KPI ENGINE ---------------- */

function renderKPI() {
  const dept = records.filter(r => r.department === activeDept);

  const units = sum(dept, "units");
  const hours = sum(dept, "hours");
  const errors = sum(dept, "errors");

  const rate = hours ? (units / hours).toFixed(2) : 0;

  const accuracy = units ? (((units - errors) / units) * 100).toFixed(2) : 0;

  const el = document.getElementById("kpiBox");
  if (!el) return;

  el.innerHTML = `
    <div class="card">Units: ${units}</div>
    <div class="card">Hours: ${hours}</div>
    <div class="card">Rate: ${rate}</div>
    <div class="card">Accuracy: ${accuracy}%</div>
  `;
}

/* ---------------- TABLE ---------------- */

function renderTable() {
  const el = document.querySelector("#recordsTable tbody");
  if (!el) return;

  el.innerHTML = records.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${r.employee}</td>
      <td>${r.department}</td>
      <td>${r.units}</td>
      <td>${r.hours}</td>
    </tr>
  `).join("");
}

/* ---------------- TITLE ---------------- */

function renderDeptTitle() {
  const el = document.getElementById("deptTitle");
  if (el) el.innerText = activeDept.toUpperCase();
}

/* ---------------- HELPERS ---------------- */

function val(id) {
  return document.getElementById(id)?.value || "";
}

function num(id) {
  return Number(document.getElementById(id)?.value || 0);
}

function sum(arr, key) {
  return arr.reduce((t, r) => t + Number(r[key] || 0), 0);
}
