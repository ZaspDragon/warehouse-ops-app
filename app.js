const data = {
  dashboardKpis: [
    { title: 'Orders Today', value: '438', sub: 'Picked and packed so far' },
    { title: 'Receiving', value: '126', sub: 'Pallets/loads received' },
    { title: 'Cycle Counts', value: '184', sub: 'Completed this shift' },
    { title: 'Open Issues', value: '9', sub: 'Needs action or review' },
  ],
  inventoryKpis: [
    { title: 'Accuracy', value: '98.4%', sub: 'Last 7 days' },
    { title: 'Short Picks Risk', value: '12', sub: 'Items below primary min' },
    { title: 'Open Variances', value: '7', sub: 'Need recount or audit' },
  ],
  receivingKpis: [
    { title: 'Inbound Loads', value: '18', sub: 'Scheduled today' },
    { title: 'Received', value: '126', sub: 'Pallets processed' },
    { title: 'Dock Utilization', value: '82%', sub: 'Current dock usage' },
  ],
  maintenanceKpis: [
    { title: 'Active Equipment', value: '24', sub: 'Ready for use' },
    { title: 'PM Due', value: '4', sub: 'Preventive maintenance due' },
    { title: 'Out of Service', value: '2', sub: 'Currently unavailable' },
  ],
  tasks: [
    { id: 'T-1042', task: 'Putaway pallet', owner: 'Kris', zone: 'A-10-3', priority: 'High', status: 'Active' },
    { id: 'T-1043', task: 'Replenish primary', owner: 'Henry', zone: 'K05-2', priority: 'High', status: 'Queued' },
    { id: 'T-1044', task: 'Cycle count', owner: 'Dawitt', zone: 'L4-2', priority: 'Medium', status: 'Active' },
    { id: 'T-1045', task: 'Damage review', owner: 'Alicia', zone: 'QC', priority: 'Low', status: 'Pending' },
  ],
  inventory: [
    { item: '607529', desc: 'Valve Assembly', onHand: 42, primary: 8, overstock: 34, bin: 'A-10-3', status: 'Healthy' },
    { item: '581220', desc: 'PVC Fitting', onHand: 11, primary: 1, overstock: 10, bin: 'B-04-1', status: 'Low' },
    { item: '775981', desc: 'Drain Kit', onHand: 0, primary: 0, overstock: 0, bin: 'C-12-2', status: 'Out' },
    { item: '431006', desc: 'Copper Elbow', onHand: 76, primary: 12, overstock: 64, bin: 'F-02-1', status: 'Healthy' },
  ],
  labor: [
    { name: 'Kris', role: 'Lift Driver', department: 'Putaway', productivity: 94, errors: 1, status: 'On Floor' },
    { name: 'Henry', role: 'Lift Driver', department: 'Replenishment', productivity: 88, errors: 2, status: 'On Floor' },
    { name: 'Dawitt', role: 'Inventory', department: 'Cycle Count', productivity: 91, errors: 0, status: 'Counting' },
    { name: 'Yussif', role: 'Lift Driver', department: 'Putaway', productivity: 79, errors: 3, status: 'Downtime' },
    { name: 'Alicia', role: 'Receiving Lead', department: 'Receiving', productivity: 97, errors: 0, status: 'Supervising' },
  ],
  quality: [
    { date: '2026-04-02', type: 'Near Miss', area: 'Receiving', severity: 'Medium', owner: 'Alicia' },
    { date: '2026-04-02', type: 'Inventory Variance', area: 'Aisle K', severity: 'High', owner: 'Henry' },
    { date: '2026-04-01', type: 'Damaged Product', area: 'Aisle A', severity: 'Low', owner: 'Kris' },
  ],
  reports: [
    ['Daily Supervisor Report', 'Labor, issues, wins, and shift handoff'],
    ['Inventory Variance Report', 'Count errors, adjustments, and root causes'],
    ['Receiving Throughput Report', 'Loads, pallets, dock time, and damages'],
    ['Employee Productivity Report', 'Output, downtime, and error trends'],
    ['Safety Incident Log', 'Near misses, damage, and corrective actions'],
    ['Equipment Status Report', 'Forklift uptime, PM, and battery health'],
  ]
};

const els = {
  navBtns: document.querySelectorAll('.nav-btn'),
  tabs: document.querySelectorAll('.tab-content'),
  subtabBtns: document.querySelectorAll('.subtab-btn'),
  subtabs: document.querySelectorAll('.subtab-content'),
  dashboardKpis: document.getElementById('dashboardKpis'),
  inventoryKpis: document.getElementById('inventoryKpis'),
  receivingKpis: document.getElementById('receivingKpis'),
  maintenanceKpis: document.getElementById('maintenanceKpis'),
  dashboardTasks: document.getElementById('dashboardTasks'),
  operationsTable: document.getElementById('operationsTable'),
  inventoryTable: document.getElementById('inventoryTable'),
  laborTable: document.getElementById('laborTable'),
  leaderboardGrid: document.getElementById('leaderboardGrid'),
  qualityTable: document.getElementById('qualityTable'),
  reportsGrid: document.getElementById('reportsGrid'),
  searchInput: document.getElementById('searchInput'),
  noteInput: document.getElementById('noteInput'),
  saveNoteBtn: document.getElementById('saveNoteBtn'),
  notesList: document.getElementById('notesList'),
};

const noteKey = 'warehouseos_notes';
const defaultNotes = [
  'Primary replenishment is running behind in A and K aisles.',
  'Cycle count variance found on item 581220.'
];

function badgeClass(value) {
  const v = (value || '').toLowerCase();
  if (['healthy', 'on floor', 'supervising'].includes(v)) return 'green';
  if (['low', 'medium', 'queued', 'counting'].includes(v)) return 'amber';
  if (['out', 'downtime', 'high'].includes(v)) return 'red';
  return 'blue';
}

function kpiCard(item) {
  return `
    <div class="kpi">
      <h4>${item.title}</h4>
      <strong>${item.value}</strong>
      <p>${item.sub}</p>
    </div>
  `;
}

function renderKpis() {
  els.dashboardKpis.innerHTML = data.dashboardKpis.map(kpiCard).join('');
  els.inventoryKpis.innerHTML = data.inventoryKpis.map(kpiCard).join('');
  els.receivingKpis.innerHTML = data.receivingKpis.map(kpiCard).join('');
  els.maintenanceKpis.innerHTML = data.maintenanceKpis.map(kpiCard).join('');
}

function taskRow(t, includeId = false) {
  return `<tr>
    ${includeId ? `<td>${t.id}</td>` : ''}
    <td>${t.task}</td>
    <td>${t.owner}</td>
    <td>${t.zone}</td>
    <td><span class="badge ${badgeClass(t.priority)}">${t.priority}</span></td>
    <td><span class="badge ${badgeClass(t.status)}">${t.status}</span></td>
  </tr>`;
}

function renderTasks(filtered = data.tasks) {
  els.dashboardTasks.innerHTML = filtered.map(t => taskRow(t)).join('');
  els.operationsTable.innerHTML = filtered.map(t => taskRow(t, true)).join('');
}

function renderInventory(filtered = data.inventory) {
  els.inventoryTable.innerHTML = filtered.map(i => `
    <tr>
      <td>${i.item}</td>
      <td>${i.desc}</td>
      <td>${i.onHand}</td>
      <td>${i.primary}</td>
      <td>${i.overstock}</td>
      <td>${i.bin}</td>
      <td><span class="badge ${badgeClass(i.status)}">${i.status}</span></td>
    </tr>
  `).join('');
}

function renderLabor(filtered = data.labor) {
  els.laborTable.innerHTML = filtered.map(emp => `
    <tr>
      <td>${emp.name}</td>
      <td>${emp.role}</td>
      <td>${emp.department}</td>
      <td>
        <div class="progress-wrap">
          <div class="progress-mini"><span style="width:${emp.productivity}%"></span></div>
          <strong>${emp.productivity}%</strong>
        </div>
      </td>
      <td>${emp.errors}</td>
      <td><span class="badge ${badgeClass(emp.status)}">${emp.status}</span></td>
    </tr>
  `).join('');

  const ranked = [...filtered].sort((a, b) => b.productivity - a.productivity);
  els.leaderboardGrid.innerHTML = ranked.map((emp, idx) => `
    <div class="leader-card">
      <div class="rank">Rank #${idx + 1}</div>
      <h3>${emp.name}</h3>
      <p>${emp.department}</p>
      <strong>${emp.productivity}%</strong>
      <p>Errors: ${emp.errors}</p>
    </div>
  `).join('');
}

function renderQuality() {
  els.qualityTable.innerHTML = data.quality.map(q => `
    <tr>
      <td>${q.date}</td>
      <td>${q.type}</td>
      <td>${q.area}</td>
      <td><span class="badge ${badgeClass(q.severity)}">${q.severity}</span></td>
      <td>${q.owner}</td>
    </tr>
  `).join('');
}

function renderReports() {
  els.reportsGrid.innerHTML = data.reports.map(([title, desc]) => `
    <div class="report-card">
      <h3>${title}</h3>
      <p>${desc}</p>
      <button class="primary-btn block-btn">Generate</button>
    </div>
  `).join('');
}

function getNotes() {
  try {
    return JSON.parse(localStorage.getItem(noteKey)) || defaultNotes;
  } catch {
    return defaultNotes;
  }
}

function saveNotes(notes) {
  localStorage.setItem(noteKey, JSON.stringify(notes));
}

function renderNotes() {
  const notes = getNotes();
  els.notesList.innerHTML = notes.map(note => `<div class="note-card">${note}</div>`).join('');
}

function wireNotes() {
  els.saveNoteBtn.addEventListener('click', () => {
    const value = els.noteInput.value.trim();
    if (!value) return;
    const notes = [value, ...getNotes()];
    saveNotes(notes);
    els.noteInput.value = '';
    renderNotes();
  });
}

function wireTabs() {
  els.navBtns.forEach(btn => btn.addEventListener('click', () => {
    els.navBtns.forEach(b => b.classList.remove('active'));
    els.tabs.forEach(tab => tab.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  }));

  els.subtabBtns.forEach(btn => btn.addEventListener('click', () => {
    els.subtabBtns.forEach(b => b.classList.remove('active'));
    els.subtabs.forEach(tab => tab.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.subtab).classList.add('active');
  }));
}

function wireSearch() {
  els.searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderTasks();
      renderInventory();
      renderLabor();
      return;
    }
    renderTasks(data.tasks.filter(t => `${t.id} ${t.task} ${t.owner} ${t.zone} ${t.priority} ${t.status}`.toLowerCase().includes(q)));
    renderInventory(data.inventory.filter(i => `${i.item} ${i.desc} ${i.bin} ${i.status}`.toLowerCase().includes(q)));
    renderLabor(data.labor.filter(emp => `${emp.name} ${emp.role} ${emp.department} ${emp.status}`.toLowerCase().includes(q)));
  });
}

function init() {
  renderKpis();
  renderTasks();
  renderInventory();
  renderLabor();
  renderQuality();
  renderReports();
  renderNotes();
  wireNotes();
  wireTabs();
  wireSearch();
}

init();
