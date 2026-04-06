import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  limit,
  serverTimestamp,
  onSnapshot,
  orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* -------------------------------
   FIREBASE
-------------------------------- */
const firebaseConfig = {
  apiKey: 'AIzaSyAAJgxXqBqKgvWnNIIBaG72iwiZ3PFykoU',
  authDomain: 'put-away-log-cw.firebaseapp.com',
  projectId: 'put-away-log-cw',
  storageBucket: 'put-away-log-cw.firebasestorage.app',
  messagingSenderId: '23183103971',
  appId: '1:23183103971:web:75f097b4270cd38874f2d6',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* -------------------------------
   LOCAL STORAGE APP DATA
-------------------------------- */
const STORAGE_KEYS = {
  tasks: 'warehouse_tasks_v4',
  notes: 'warehouse_notes_v4',
  inventory: 'warehouse_inventory_v4',
  counts: 'warehouse_counts_v4',
  trucks: 'warehouse_trucks_v4',
  coaching: 'warehouse_coaching_v4',
  quality: 'warehouse_quality_v4',
};

const defaultTasks = [
  { id: 'T-1042', task: 'Putaway pallet', owner: 'Kris', zone: 'A-10-3', priority: 'High', status: 'Active', createdAt: new Date(Date.now() - 35 * 60000).toISOString() },
  { id: 'T-1043', task: 'Replenish primary', owner: 'Henry', zone: 'K05-2', priority: 'High', status: 'Queued', createdAt: new Date(Date.now() - 15 * 60000).toISOString() },
  { id: 'T-1044', task: 'Cycle count', owner: 'Dawitt', zone: 'L4-2', priority: 'Medium', status: 'Active', createdAt: new Date(Date.now() - 8 * 60000).toISOString() },
  { id: 'T-1045', task: 'Damage review', owner: 'Yussif', zone: 'QC', priority: 'Low', status: 'Pending', createdAt: new Date(Date.now() - 52 * 60000).toISOString() },
];

const defaultInventory = [
  { item: '607529', desc: 'Valve Assembly', onHand: 42, primary: 8, overstock: 34, bin: 'A-10-3', status: 'Healthy' },
  { item: '581220', desc: 'PVC Fitting', onHand: 11, primary: 1, overstock: 10, bin: 'B-04-1', status: 'Low' },
  { item: '775981', desc: 'Drain Kit', onHand: 0, primary: 0, overstock: 0, bin: 'C-12-2', status: 'Out' },
  { item: '431006', desc: 'Copper Elbow', onHand: 76, primary: 12, overstock: 64, bin: 'F-02-1', status: 'Healthy' },
];

const defaultNotes = [
  'Primary replenishment is running behind in A and K aisles.',
  'Cycle count variance found on item 581220.',
];

const defaultLaborData = [
  { name: 'Kris', role: 'Lift Driver', department: 'Putaway', productivity: 94, errors: 1, status: 'On Floor' },
  { name: 'Henry', role: 'Lift Driver', department: 'Replenishment', productivity: 88, errors: 2, status: 'On Floor' },
  { name: 'Dawitt', role: 'Inventory', department: 'Cycle Count', productivity: 91, errors: 0, status: 'Counting' },
  { name: 'Yussif', role: 'Lift Driver', department: 'Putaway', productivity: 72, errors: 3, status: 'Downtime' },
];

const defaultQualityData = [
  { date: '2026-04-02', type: 'Near Miss', area: 'Receiving', severity: 'Medium', owner: 'Alicia', notes: 'Forklift traffic too close to dock.' },
  { date: '2026-04-02', type: 'Inventory Variance', area: 'Aisle K', severity: 'High', owner: 'Henry', notes: 'Mismatch between physical and system quantity.' },
  { date: '2026-04-01', type: 'Damaged Product', area: 'Aisle A', severity: 'Low', owner: 'Kris', notes: 'Crushed corner on inbound case.' },
];

let tasks = loadStorage(STORAGE_KEYS.tasks, defaultTasks);
let notes = loadStorage(STORAGE_KEYS.notes, defaultNotes);
let inventory = loadStorage(STORAGE_KEYS.inventory, defaultInventory);
let counts = loadStorage(STORAGE_KEYS.counts, []);
let trucks = loadStorage(STORAGE_KEYS.trucks, []);
let coachingEntries = loadStorage(STORAGE_KEYS.coaching, []);
let qualityData = loadStorage(STORAGE_KEYS.quality, defaultQualityData);
const laborData = defaultLaborData;

let inventoryFiltersOpen = false;
let inventoryFilterState = { status: 'all', bin: '' };

/* -------------------------------
   FIRESTORE PUTAWAY / USERS DATA
-------------------------------- */
let currentUserProfile = null;
let activeEmployees = [];
let putawayLogs = [];
let lastPutawayUploadCount = 0;
let unsubs = [];

/* -------------------------------
   DOM
-------------------------------- */
const views = {
  dashboard: document.getElementById('dashboardView'),
  operations: document.getElementById('operationsView'),
  inventory: document.getElementById('inventoryView'),
  receiving: document.getElementById('receivingView'),
  putaway: document.getElementById('putawayView'),
  labor: document.getElementById('laborView'),
  quality: document.getElementById('qualityView'),
  reports: document.getElementById('reportsView'),
};

const loginCard = document.getElementById('loginCard');
const appView = document.getElementById('appView');
const sessionBox = document.getElementById('sessionBox');
const sessionEmail = document.getElementById('sessionEmail');
const sessionRole = document.getElementById('sessionRole');
const signOutBtn = document.getElementById('signOutBtn');
const adminSection = document.getElementById('adminSection');

const loginForm = document.getElementById('loginForm');
const loginMsg = document.getElementById('loginMsg');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

const putAwayForm = document.getElementById('putAwayForm');
const workerName = document.getElementById('workerName');
const workDate = document.getElementById('workDate');
const lineItemsBody = document.getElementById('lineItemsBody');
const formMsg = document.getElementById('formMsg');
const usedLines = document.getElementById('usedLines');
const totalQty = document.getElementById('totalQty');
const clearBtn = document.getElementById('clearBtn');

const logsTableBody = document.getElementById('logsTableBody');
const searchInput = document.getElementById('searchInput');
const filterDate = document.getElementById('filterDate');
const exportBtn = document.getElementById('exportBtn');

const employeeForm = document.getElementById('employeeForm');
const employeeName = document.getElementById('employeeName');
const employeeMsg = document.getElementById('employeeMsg');
const employeeList = document.getElementById('employeeList');

/* -------------------------------
   INIT
-------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupButtons();
  setToday();
  buildLineRows();
  updateTotals();
  renderAll();

  setInterval(() => {
    renderReceivingTable();
    renderReceivingStats();
    renderTasks();
    renderDashboardStats();
  }, 1000);
});

/* -------------------------------
   STORAGE HELPERS
-------------------------------- */
function loadStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* -------------------------------
   NAV
-------------------------------- */
function setupNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.dataset.view;
      Object.values(views).forEach((v) => v.classList.remove('active'));
      if (views[target]) views[target].classList.add('active');
    });
  });
}

/* -------------------------------
   BUTTONS / EVENTS
-------------------------------- */
function setupButtons() {
  document.getElementById('newActionBtn')?.addEventListener('click', openNewActionModal);
  document.getElementById('createTaskBtn')?.addEventListener('click', openCreateTaskModal);
  document.getElementById('filtersBtn')?.addEventListener('click', toggleInventoryFilters);
  document.getElementById('newCountBtn')?.addEventListener('click', openNewCountModal);
  document.getElementById('addTruckBtn')?.addEventListener('click', openAddTruckModal);
  document.getElementById('addIncidentBtn')?.addEventListener('click', openAddIncidentModal);
  document.getElementById('uploadPutawayBtn')?.addEventListener('click', openPutawayUploadModal);
  document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);

  document.getElementById('saveDashboardNoteBtn')?.addEventListener('click', () => {
    const input = document.getElementById('dashboardNoteInput');
    const value = input.value.trim();
    if (!value) return showToast('Enter a note first.');
    notes.unshift(value);
    saveStorage(STORAGE_KEYS.notes, notes);
    input.value = '';
    renderNotes();
    showToast('Note saved.');
  });

  document.getElementById('applyInventoryFiltersBtn')?.addEventListener('click', () => {
    inventoryFilterState.status = document.getElementById('statusFilter').value;
    inventoryFilterState.bin = document.getElementById('binFilter').value.trim();
    renderInventory();
    showToast('Filters applied.');
  });

  document.getElementById('clearInventoryFiltersBtn')?.addEventListener('click', () => {
    inventoryFilterState = { status: 'all', bin: '' };
    document.getElementById('statusFilter').value = 'all';
    document.getElementById('binFilter').value = '';
    renderInventory();
    showToast('Filters cleared.');
  });

  document.getElementById('saveCoachingBtn')?.addEventListener('click', saveCoachingEntry);

  document.querySelectorAll('.generate-report-btn').forEach((btn) => {
    btn.addEventListener('click', () => generateReport(btn.dataset.report));
  });

  document.getElementById('modalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  document.getElementById('globalSearch')?.addEventListener('input', renderAll);

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMessage(loginMsg, 'Signing in...');
    try {
      await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
      setMessage(loginMsg, 'Signed in.', 'success');
    } catch (err) {
      setMessage(loginMsg, err.message, 'error');
    }
  });

  signOutBtn?.addEventListener('click', async () => {
    await signOut(auth);
  });

  clearBtn?.addEventListener('click', clearPutawayForm);
  searchInput?.addEventListener('input', renderPutawayLogTable);
  filterDate?.addEventListener('input', renderPutawayLogTable);
  exportBtn?.addEventListener('click', () => downloadPutawayCSV(putawayLogs));

  putAwayForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveManualPutaway();
  });

  employeeForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveEmployee();
  });
}

/* -------------------------------
   AUTH / FIRESTORE
-------------------------------- */
async function loadUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) {
    throw new Error('No user profile found in Firestore users collection.');
  }

  const data = snap.data();
  if (data.active !== true) {
    throw new Error('Your account has been turned off.');
  }

  return { id: snap.id, ...data };
}

function watchEmployees() {
  const q = query(collection(db, 'employees'), where('active', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      activeEmployees = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      renderEmployeeDropdown();
      renderEmployeeList();
    },
    (error) => {
      console.error('watchEmployees error:', error);
      setMessage(employeeMsg, error.message, 'error');
    }
  );
}

function watchPutawayLogs() {
  const q = query(collection(db, 'putAwayLogs'), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snapshot) => {
      putawayLogs = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
        };
      });

      renderPutawayLogTable();
      renderPutawayLogs();
      renderReceivingStats();
    },
    (error) => {
      console.error('watchPutawayLogs error:', error);
      setMessage(formMsg, error.message, 'error');
    }
  );
}

onAuthStateChanged(auth, async (user) => {
  unsubs.forEach((fn) => fn());
  unsubs = [];

  if (!user) {
    currentUserProfile = null;
    loginCard.classList.remove('hidden');
    appView.classList.add('hidden');
    sessionBox.classList.add('hidden');
    adminSection?.classList.add('hidden');
    setMessage(loginMsg);
    return;
  }

  try {
    currentUserProfile = await loadUserProfile(user.uid);

    loginCard.classList.add('hidden');
    appView.classList.remove('hidden');
    sessionBox.classList.remove('hidden');

    sessionEmail.textContent = user.email;
    sessionRole.textContent = currentUserProfile.role || 'worker';

    adminSection?.classList.toggle(
      'hidden',
      !['admin', 'lead'].includes(currentUserProfile.role)
    );

    unsubs.push(watchEmployees());
    unsubs.push(watchPutawayLogs());
  } catch (err) {
    console.error('AUTH STATE ERROR:', err);
    setMessage(loginMsg, err.message, 'error');
    await signOut(auth);
  }
});

/* -------------------------------
   PUTAWAY HELPERS
-------------------------------- */
function setToday() {
  if (workDate) workDate.value = new Date().toISOString().slice(0, 10);
}

function setMessage(el, text = '', type = '') {
  if (!el) return;
  el.textContent = text;
  el.className = 'msg';
  if (type) el.classList.add(type);
}

function buildLineRows() {
  if (!lineItemsBody) return;
  lineItemsBody.innerHTML = '';
  for (let i = 1; i <= 8; i += 1) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i}</td>
      <td><input type="text" class="item-input" data-row="${i}" placeholder="Item #" /></td>
      <td><input type="number" class="qty-input" data-row="${i}" min="0" step="1" placeholder="0" /></td>
      <td><input type="text" class="location-input" data-row="${i}" placeholder="A-10-1" /></td>
      <td><input type="text" class="notes-input" data-row="${i}" placeholder="Notes" /></td>
    `;
    lineItemsBody.appendChild(tr);
  }
  bindTotalListeners();
}

function getLineInputs() {
  return [...lineItemsBody.querySelectorAll('tr')].map((row, idx) => ({
    rowNumber: idx + 1,
    itemNumber: row.querySelector('.item-input').value.trim(),
    quantity: row.querySelector('.qty-input').value.trim(),
    location: row.querySelector('.location-input').value.trim().toUpperCase(),
    notes: row.querySelector('.notes-input').value.trim(),
  }));
}

function bindTotalListeners() {
  lineItemsBody.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateTotals);
  });
}

function updateTotals() {
  const lines = getLineInputs();
  const used = lines.filter((l) => l.itemNumber || l.quantity || l.location || l.notes);
  const qtySum = used.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  if (usedLines) usedLines.textContent = String(used.length);
  if (totalQty) totalQty.textContent = String(qtySum);
}

function clearPutawayForm() {
  putAwayForm?.reset();
  setToday();
  buildLineRows();
  updateTotals();
  setMessage(formMsg);
}

function renderEmployeeDropdown() {
  if (!workerName) return;
  const current = workerName.value;
  workerName.innerHTML = '<option value="">Select worker</option>';

  activeEmployees.forEach((emp) => {
    const opt = document.createElement('option');
    opt.value = emp.name;
    opt.textContent = emp.name;
    workerName.appendChild(opt);
  });

  if ([...workerName.options].some((o) => o.value === current)) {
    workerName.value = current;
  }
}

function renderEmployeeList() {
  if (!employeeList) return;

  employeeList.innerHTML = '';

  if (!activeEmployees.length) {
    employeeList.innerHTML = '<div class="empty">No active workers yet.</div>';
    return;
  }

  activeEmployees.forEach((emp) => {
    const row = document.createElement('div');
    row.className = 'employee-row';
    row.innerHTML = `
      <div>
        <div class="name">${escapeHtml(emp.name)}</div>
        <div class="meta">Active worker dropdown option</div>
      </div>
      <button class="secondary-btn" type="button">Remove</button>
    `;

    row.querySelector('button').addEventListener('click', async () => {
      try {
        await updateDoc(doc(db, 'employees', emp.id), {
          active: false,
          updatedAt: serverTimestamp(),
        });
        setMessage(employeeMsg, 'Worker removed from dropdown.', 'success');
      } catch (err) {
        setMessage(employeeMsg, err.message, 'error');
      }
    });

    employeeList.appendChild(row);
  });
}

async function saveEmployee() {
  if (!currentUserProfile || !['admin', 'lead'].includes(currentUserProfile.role)) {
    setMessage(employeeMsg, 'You do not have permission for that.', 'error');
    return;
  }

  const newName = employeeName.value.trim();
  if (!newName) {
    setMessage(employeeMsg, 'Enter a worker name.', 'error');
    return;
  }

  try {
    await addDoc(collection(db, 'employees'), {
      name: newName,
      active: true,
      createdAt: serverTimestamp(),
      createdByUid: auth.currentUser.uid,
      createdByEmail: auth.currentUser.email,
    });

    employeeName.value = '';
    setMessage(employeeMsg, 'Worker added to dropdown.', 'success');
  } catch (err) {
    setMessage(employeeMsg, err.message, 'error');
  }
}

async function saveManualPutaway() {
  setMessage(formMsg);

  const lines = getLineInputs()
    .filter((l) => l.itemNumber || l.quantity || l.location || l.notes)
    .map((l) => ({
      ...l,
      quantity: Number(l.quantity) || 0,
    }));

  if (!workerName.value) {
    setMessage(formMsg, 'Pick a worker name.', 'error');
    return;
  }

  if (!workDate.value) {
    setMessage(formMsg, 'Choose a date.', 'error');
    return;
  }

  if (!lines.length) {
    setMessage(formMsg, 'Enter at least one line.', 'error');
    return;
  }

  const badLine = lines.find((l) => !l.itemNumber || !l.location || !l.quantity);
  if (badLine) {
    setMessage(formMsg, 'Each used line needs item number, quantity, and location.', 'error');
    return;
  }

  try {
    await addDoc(collection(db, 'putAwayLogs'), {
      entryType: 'manual',
      workerName: workerName.value,
      workDate: workDate.value,
      lines,
      submittedByUid: auth.currentUser.uid,
      submittedByEmail: auth.currentUser.email,
      createdAt: serverTimestamp(),
    });

    setMessage(formMsg, 'Put away log submitted.', 'success');
    clearPutawayForm();
    showToast('Put away log submitted.');
  } catch (err) {
    setMessage(formMsg, err.message, 'error');
  }
}

function renderPutawayLogTable() {
  if (!logsTableBody) return;

  const search = (searchInput?.value || '').trim().toLowerCase();
  const dateValue = filterDate?.value || '';

  const filtered = putawayLogs.filter((log) => {
    const haystack = [
      log.workerName || '',
      log.workDate || '',
      ...(log.lines || []).map((l) => `${l.itemNumber} ${l.location} ${l.notes}`),
    ].join(' ').toLowerCase();

    const matchesSearch = !search || haystack.includes(search);
    const matchesDate = !dateValue || log.workDate === dateValue;
    return matchesSearch && matchesDate;
  });

  logsTableBody.innerHTML = '';

  if (!filtered.length) {
    logsTableBody.innerHTML = '<tr><td colspan="5" class="empty">No matching logs.</td></tr>';
    return;
  }

  filtered.forEach((log) => {
    const total = (log.lines || []).reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
    const preview = (log.lines || [])
      .slice(0, 2)
      .map((l) => `${l.itemNumber || '-'} / ${l.location || '-'}`)
      .join(' • ');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(log.workDate || '-')}</td>
      <td>${escapeHtml(log.workerName || '-')}</td>
      <td>${(log.lines || []).length}</td>
      <td>${total}</td>
      <td>${escapeHtml(preview || '-')}</td>
    `;
    logsTableBody.appendChild(tr);
  });
}

function renderPutawayLogs() {
  const body = document.getElementById('putawayTable');
  if (!body) return;

  const search = getSearchValue();
  body.innerHTML = '';

  const flatRows = [];
  putawayLogs.forEach((log) => {
    (log.lines || []).forEach((line) => {
      flatRows.push({
        date: log.workDate || (log.createdAtMs ? new Date(log.createdAtMs).toISOString() : new Date().toISOString()),
        logNumber: line.itemNumber || '',
        location: line.location || '',
        rawLine: line.notes || '',
        source: log.entryType || 'manual',
      });
    });
  });

  const filtered = flatRows.filter((entry) =>
    `${entry.date} ${entry.logNumber} ${entry.location} ${entry.rawLine} ${entry.source}`.toLowerCase().includes(search)
  );

  filtered.forEach((entry) => {
    body.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${escapeHtml(formatDateTime(entry.date))}</td>
        <td>${escapeHtml(entry.logNumber)}</td>
        <td>${escapeHtml(entry.location)}</td>
        <td>${escapeHtml(entry.rawLine)}</td>
        <td>${badge(entry.source)}</td>
      </tr>
    `);
  });

  document.getElementById('putawayLogTotal').textContent = flatRows.length;
  const uniqueLocations = new Set(flatRows.map((x) => x.location).filter(Boolean));
  document.getElementById('putawayLocationTotal').textContent = uniqueLocations.size;
  document.getElementById('putawayLastUploadCount').textContent = lastPutawayUploadCount;
}

function downloadPutawayCSV(rows) {
  const header = ['date', 'worker', 'line', 'itemNumber', 'quantity', 'location', 'notes', 'source'];
  const csv = [header.join(',')];

  rows.forEach((row) => {
    (row.lines || []).forEach((line) => {
      csv.push([
        row.workDate || '',
        row.workerName || '',
        line.rowNumber || '',
        line.itemNumber || '',
        line.quantity || '',
        line.location || '',
        line.notes || '',
        row.entryType || 'manual',
      ].map(csvEscape).join(','));
    });
  });

  const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `put-away-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/* -------------------------------
   WAREHOUSE OPS RENDERING
-------------------------------- */
function renderAll() {
  renderTasks();
  renderNotes();
  renderInventory();
  renderReceivingTable();
  renderReceivingStats();
  renderPutawayLogs();
  renderLabor();
  renderQuality();
  renderCoaching();
  renderDashboardStats();
  renderPutawayLogTable();
}

function renderDashboardStats() {
  document.getElementById('dashboardTruckCount').textContent = trucks.length;
  document.getElementById('dashboardCountCount').textContent = counts.length;
  document.getElementById('dashboardTaskCount').textContent = tasks.filter((t) => t.status !== 'Done').length;

  document.getElementById('tasksBehind').textContent = tasks.filter((t) =>
    t.status !== 'Done' && (t.status === 'Queued' || t.status === 'Pending' || isTaskAtRisk(t))
  ).length;

  document.getElementById('lowInventory').textContent = inventory.filter((i) =>
    i.status === 'Low' || i.status === 'Out'
  ).length;

  document.getElementById('activeTrucks').textContent = trucks.filter((t) => t.status === 'Active').length;
  document.getElementById('laborIssues').textContent = laborData.filter((l) => l.productivity < 75).length;
}

function getSearchValue() {
  return (document.getElementById('globalSearch')?.value || '').trim().toLowerCase();
}

function renderTasks() {
  const search = getSearchValue();
  const filtered = tasks.filter((t) =>
    `${t.id} ${t.task} ${t.owner} ${t.zone} ${t.priority} ${t.status}`.toLowerCase().includes(search)
  );

  const operationsBody = document.getElementById('operationsTaskTable');
  const dashboardBody = document.getElementById('dashboardTaskTable');
  operationsBody.innerHTML = '';
  dashboardBody.innerHTML = '';

  filtered.forEach((task) => {
    const ageText = getTaskAge(task);
    const risk = isTaskAtRisk(task)
      ? '<span class="badge red">At Risk</span>'
      : '<span class="badge green">OK</span>';

    operationsBody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${task.id}</td>
        <td>${escapeHtml(task.task)}</td>
        <td>${escapeHtml(task.owner)}</td>
        <td>${escapeHtml(task.zone)}</td>
        <td>${badge(task.priority)}</td>
        <td>${badge(task.status)}</td>
        <td>${ageText}</td>
        <td>${risk}</td>
        <td>
          <div class="action-row">
            <button class="small-btn" onclick="toggleTaskStatus('${task.id}')">Advance</button>
            <button class="small-btn" onclick="deleteTask('${task.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `);

    dashboardBody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${task.id}</td>
        <td>${escapeHtml(task.task)}</td>
        <td>${escapeHtml(task.owner)}</td>
        <td>${escapeHtml(task.zone)}</td>
        <td>${badge(task.priority)}</td>
        <td>${badge(task.status)}</td>
      </tr>
    `);
  });
}

function renderNotes() {
  const list = document.getElementById('dashboardNotesList');
  list.innerHTML = '';
  notes.forEach((note) => {
    list.insertAdjacentHTML('beforeend', `<div class="note-box">${escapeHtml(note)}</div>`);
  });
}

function getFilteredInventory() {
  const search = getSearchValue();
  return inventory.filter((item) => {
    const matchesSearch = `${item.item} ${item.desc} ${item.bin} ${item.status}`.toLowerCase().includes(search);
    const matchesStatus = inventoryFilterState.status === 'all' || item.status === inventoryFilterState.status;
    const matchesBin = !inventoryFilterState.bin || item.bin.toLowerCase().includes(inventoryFilterState.bin.toLowerCase());
    return matchesSearch && matchesStatus && matchesBin;
  });
}

function renderInventory() {
  const body = document.getElementById('inventoryTable');
  body.innerHTML = '';

  const filtered = getFilteredInventory();
  filtered.forEach((item) => {
    body.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${escapeHtml(item.item)}</td>
        <td>${escapeHtml(item.desc)}</td>
        <td>${item.onHand}</td>
        <td>${item.primary}</td>
        <td>${item.overstock}</td>
        <td>${escapeHtml(item.bin)}</td>
        <td>${badge(item.status)}</td>
      </tr>
    `);
  });

  document.getElementById('inventoryTotalCount').textContent = filtered.length;
  document.getElementById('inventoryLowCount').textContent = filtered.filter((i) => i.status === 'Low' || i.status === 'Out').length;
}

function renderReceivingTable() {
  const body = document.getElementById('receivingTable');
  const search = getSearchValue();
  body.innerHTML = '';

  const filtered = trucks.filter((truck) =>
    `${truck.truckNumber} ${truck.carrier} ${truck.dockDoor} ${truck.status}`.toLowerCase().includes(search)
  );

  filtered.forEach((truck) => {
    const timerText = getTruckElapsedTime(truck);
    const delay = isTruckDelayed(truck)
      ? '<span class="badge red">Delayed</span>'
      : '<span class="badge green">On Time</span>';

    body.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${escapeHtml(truck.truckNumber)}</td>
        <td>${escapeHtml(truck.carrier)}</td>
        <td>${escapeHtml(truck.dockDoor)}</td>
        <td>${truck.containers}</td>
        <td>${truck.osds}</td>
        <td>${formatDateTime(truck.startTime)}</td>
        <td>${timerText}</td>
        <td>${badge(truck.status)}</td>
        <td>${delay}</td>
        <td>
          <div class="action-row">
            ${truck.status === 'Active'
              ? `<button class="small-btn" onclick="stopTruckTimer('${truck.id}')">Stop Timer</button>`
              : `<button class="small-btn" onclick="restartTruckTimer('${truck.id}')">Restart</button>`}
            <button class="small-btn" onclick="editTruck('${truck.id}')">Edit</button>
            <button class="small-btn" onclick="deleteTruck('${truck.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `);
  });
}

function renderReceivingStats() {
  document.getElementById('receivingTruckTotal').textContent = trucks.length;

  const totalOsds = trucks.reduce((sum, t) => sum + Number(t.osds || 0), 0);
  document.getElementById('receivingOsdTotal').textContent = totalOsds;

  const totalContainers = trucks.reduce((sum, t) => sum + Number(t.containers || 0), 0);
  document.getElementById('receivingContainerTotal').textContent = totalContainers;

  const activeTimers = trucks.filter((t) => t.status === 'Active').length;
  document.getElementById('receivingActiveTimers').textContent = activeTimers;

  const completed = trucks.filter((t) => t.totalElapsedSeconds && t.status !== 'Active');
  const avg = completed.length
    ? Math.floor(completed.reduce((sum, t) => sum + t.totalElapsedSeconds, 0) / completed.length)
    : 0;

  document.getElementById('receivingAverageDockTime').textContent = secondsToClock(avg);
}

function renderLabor() {
  const body = document.getElementById('laborTable');
  const search = getSearchValue();
  body.innerHTML = '';

  laborData
    .filter((emp) => `${emp.name} ${emp.role} ${emp.department} ${emp.status}`.toLowerCase().includes(search))
    .forEach((emp) => {
      body.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${escapeHtml(emp.name)}</td>
          <td>${escapeHtml(emp.role)}</td>
          <td>${escapeHtml(emp.department)}</td>
          <td>${emp.productivity}%</td>
          <td><span class="badge ${getLaborStatusClass(emp.productivity)}">${getLaborGoalLabel(emp.productivity)}</span></td>
          <td>${emp.errors}</td>
          <td>${badge(emp.status)}</td>
        </tr>
      `);
    });
}

function renderQuality() {
  const body = document.getElementById('qualityTable');
  const search = getSearchValue();
  body.innerHTML = '';

  const filtered = qualityData.filter((item) =>
    `${item.date} ${item.type} ${item.area} ${item.severity} ${item.owner} ${item.notes}`.toLowerCase().includes(search)
  );

  filtered.forEach((item) => {
    body.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${escapeHtml(item.date)}</td>
        <td>${escapeHtml(item.type)}</td>
        <td>${escapeHtml(item.area)}</td>
        <td>${badge(item.severity)}</td>
        <td>${escapeHtml(item.owner)}</td>
        <td>${escapeHtml(item.notes || '')}</td>
      </tr>
    `);
  });

  document.getElementById('qualityTotalCount').textContent = qualityData.length;
  document.getElementById('qualityHighCount').textContent = qualityData.filter((i) => i.severity === 'High').length;
  document.getElementById('qualityTopArea').textContent = getTopIssueArea();
}

function renderCoaching() {
  const list = document.getElementById('coachingList');
  list.innerHTML = '';

  coachingEntries.forEach((entry) => {
    list.insertAdjacentHTML('beforeend', `
      <div class="coach-box">
        <strong>${escapeHtml(entry.employee)}</strong> — ${escapeHtml(entry.topic)}
        <div class="coach-text">${escapeHtml(entry.notes)}</div>
        <div class="coach-date">${formatDateTime(entry.createdAt)}</div>
      </div>
    `);
  });
}

/* -------------------------------
   MODALS / ACTIONS
-------------------------------- */
function toggleInventoryFilters() {
  inventoryFiltersOpen = !inventoryFiltersOpen;
  document.getElementById('inventoryFiltersPanel').classList.toggle('hidden', !inventoryFiltersOpen);
}

function openNewActionModal() {
  openModal('New Action', `
    <div class="form-grid">
      <div>
        <label>Action Type</label>
        <select id="newActionType">
          <option value="task">Task</option>
          <option value="note">Supervisor Note</option>
          <option value="issue">Issue</option>
        </select>
      </div>
      <div>
        <label>Owner</label>
        <input id="newActionOwner" type="text" placeholder="Kris" />
      </div>
      <div class="full-span">
        <label>Description</label>
        <textarea id="newActionDescription" placeholder="What needs to happen?"></textarea>
      </div>
      <div>
        <label>Zone / Area</label>
        <input id="newActionZone" type="text" placeholder="A-10-3 or Receiving" />
      </div>
      <div>
        <label>Priority</label>
        <select id="newActionPriority">
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveNewAction()">Save Action</button>
    </div>
  `);
}

function saveNewAction() {
  const type = document.getElementById('newActionType').value;
  const owner = document.getElementById('newActionOwner').value.trim() || 'Unassigned';
  const desc = document.getElementById('newActionDescription').value.trim();
  const zone = document.getElementById('newActionZone').value.trim() || 'General';
  const priority = document.getElementById('newActionPriority').value;

  if (!desc) return showToast('Enter a description first.');

  if (type === 'task' || type === 'issue') {
    tasks.unshift({
      id: `T-${Math.floor(1000 + Math.random() * 9000)}`,
      task: desc,
      owner,
      zone,
      priority,
      status: type === 'issue' ? 'Pending' : 'Active',
      createdAt: new Date().toISOString(),
    });
    saveStorage(STORAGE_KEYS.tasks, tasks);
    renderTasks();
    renderDashboardStats();
  } else {
    notes.unshift(`${owner}: ${desc}`);
    saveStorage(STORAGE_KEYS.notes, notes);
    renderNotes();
  }

  closeModal();
  showToast('Action saved.');
}

function openCreateTaskModal() {
  openModal('Create Task', `
    <div class="form-grid">
      <div>
        <label>Task</label>
        <input id="taskNameInput" type="text" placeholder="Replenish primary" />
      </div>
      <div>
        <label>Owner</label>
        <input id="taskOwnerInput" type="text" placeholder="Henry" />
      </div>
      <div>
        <label>Zone</label>
        <input id="taskZoneInput" type="text" placeholder="K05-2" />
      </div>
      <div>
        <label>Priority</label>
        <select id="taskPriorityInput">
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveTask()">Save Task</button>
    </div>
  `);
}

function saveTask() {
  const taskName = document.getElementById('taskNameInput').value.trim();
  const owner = document.getElementById('taskOwnerInput').value.trim() || 'Unassigned';
  const zone = document.getElementById('taskZoneInput').value.trim() || 'General';
  const priority = document.getElementById('taskPriorityInput').value;

  if (!taskName) return showToast('Task name is required.');

  tasks.unshift({
    id: `T-${Math.floor(1000 + Math.random() * 9000)}`,
    task: taskName,
    owner,
    zone,
    priority,
    status: 'Active',
    createdAt: new Date().toISOString(),
  });

  saveStorage(STORAGE_KEYS.tasks, tasks);
  renderTasks();
  renderDashboardStats();
  closeModal();
  showToast('Task created.');
}

function toggleTaskStatus(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  const flow = ['Queued', 'Active', 'Pending', 'Done'];
  const currentIndex = flow.indexOf(task.status);
  task.status = flow[(currentIndex + 1) % flow.length];

  saveStorage(STORAGE_KEYS.tasks, tasks);
  renderTasks();
  renderDashboardStats();
  showToast('Task status updated.');
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  saveStorage(STORAGE_KEYS.tasks, tasks);
  renderTasks();
  renderDashboardStats();
  showToast('Task deleted.');
}

function openNewCountModal() {
  openModal('New Inventory Count', `
    <div class="form-grid">
      <div>
        <label>Item Number</label>
        <input id="countItemInput" type="text" placeholder="607529" />
      </div>
      <div>
        <label>Bin</label>
        <input id="countBinInput" type="text" placeholder="A-10-3" />
      </div>
      <div>
        <label>Counted Quantity</label>
        <input id="countQtyInput" type="number" placeholder="12" />
      </div>
      <div>
        <label>Description</label>
        <input id="countDescInput" type="text" placeholder="Valve Assembly" />
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveCount()">Save Count</button>
    </div>
  `);
}

function saveCount() {
  const item = document.getElementById('countItemInput').value.trim();
  const bin = document.getElementById('countBinInput').value.trim();
  const qty = Number(document.getElementById('countQtyInput').value);
  const desc = document.getElementById('countDescInput').value.trim() || 'Manual Count';

  if (!item || !bin || Number.isNaN(qty)) return showToast('Fill in item, bin, and quantity.');

  counts.unshift({ item, bin, qty, desc, createdAt: new Date().toISOString() });

  const existing = inventory.find((i) => i.item === item && i.bin === bin);
  if (existing) {
    existing.onHand = qty;
    existing.primary = Math.min(existing.primary, qty);
    existing.overstock = Math.max(qty - existing.primary, 0);
    existing.status = qty === 0 ? 'Out' : qty <= 5 ? 'Low' : 'Healthy';
  } else {
    inventory.unshift({
      item,
      desc,
      onHand: qty,
      primary: Math.min(qty, 5),
      overstock: Math.max(qty - Math.min(qty, 5), 0),
      bin,
      status: qty === 0 ? 'Out' : qty <= 5 ? 'Low' : 'Healthy',
    });
  }

  saveStorage(STORAGE_KEYS.counts, counts);
  saveStorage(STORAGE_KEYS.inventory, inventory);
  renderInventory();
  renderDashboardStats();
  closeModal();
  showToast('Count saved.');
}

function openAddTruckModal() {
  openModal('Add Receiving Truck', `
    <div class="form-grid">
      <div>
        <label>Truck Number</label>
        <input id="truckNumberInput" type="text" placeholder="TRK-104" />
      </div>
      <div>
        <label>Carrier</label>
        <input id="truckCarrierInput" type="text" placeholder="FedEx Freight" />
      </div>
      <div>
        <label>Dock Door</label>
        <input id="truckDockInput" type="text" placeholder="Door 4" />
      </div>
      <div>
        <label>Containers</label>
        <input id="truckContainersInput" type="number" placeholder="2" />
      </div>
      <div>
        <label>OSDs</label>
        <input id="truckOsdInput" type="number" placeholder="1" />
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveTruck()">Save Truck & Start Timer</button>
    </div>
  `);
}

function saveTruck() {
  const truckNumber = document.getElementById('truckNumberInput').value.trim();
  const carrier = document.getElementById('truckCarrierInput').value.trim() || 'Unknown Carrier';
  const dockDoor = document.getElementById('truckDockInput').value.trim() || 'Unassigned';
  const containers = Number(document.getElementById('truckContainersInput').value || 0);
  const osds = Number(document.getElementById('truckOsdInput').value || 0);

  if (!truckNumber) return showToast('Truck number is required.');

  trucks.unshift({
    id: cryptoRandomId(),
    truckNumber,
    carrier,
    dockDoor,
    containers,
    osds,
    startTime: new Date().toISOString(),
    endTime: null,
    status: 'Active',
    totalElapsedSeconds: 0,
  });

  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  renderDashboardStats();
  closeModal();
  showToast('Truck added and timer started.');
}

function stopTruckTimer(id) {
  const truck = trucks.find((t) => t.id === id);
  if (!truck || truck.status !== 'Active') return;

  const now = new Date();
  const elapsed = Math.floor((now - new Date(truck.startTime)) / 1000);
  truck.endTime = now.toISOString();
  truck.totalElapsedSeconds = elapsed;
  truck.status = 'Completed';

  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  renderDashboardStats();
  showToast('Truck timer stopped.');
}

function restartTruckTimer(id) {
  const truck = trucks.find((t) => t.id === id);
  if (!truck) return;

  truck.startTime = new Date().toISOString();
  truck.endTime = null;
  truck.totalElapsedSeconds = 0;
  truck.status = 'Active';

  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  renderDashboardStats();
  showToast('Truck timer restarted.');
}

function editTruck(id) {
  const truck = trucks.find((t) => t.id === id);
  if (!truck) return;

  openModal('Edit Truck', `
    <div class="form-grid">
      <div>
        <label>Truck Number</label>
        <input id="editTruckNumberInput" type="text" value="${escapeAttribute(truck.truckNumber)}" />
      </div>
      <div>
        <label>Carrier</label>
        <input id="editTruckCarrierInput" type="text" value="${escapeAttribute(truck.carrier)}" />
      </div>
      <div>
        <label>Dock Door</label>
        <input id="editTruckDockInput" type="text" value="${escapeAttribute(truck.dockDoor)}" />
      </div>
      <div>
        <label>Containers</label>
        <input id="editTruckContainersInput" type="number" value="${truck.containers}" />
      </div>
      <div>
        <label>OSDs</label>
        <input id="editTruckOsdInput" type="number" value="${truck.osds}" />
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveTruckEdit('${truck.id}')">Save Changes</button>
    </div>
  `);
}

function saveTruckEdit(id) {
  const truck = trucks.find((t) => t.id === id);
  if (!truck) return;

  truck.truckNumber = document.getElementById('editTruckNumberInput').value.trim();
  truck.carrier = document.getElementById('editTruckCarrierInput').value.trim();
  truck.dockDoor = document.getElementById('editTruckDockInput').value.trim();
  truck.containers = Number(document.getElementById('editTruckContainersInput').value || 0);
  truck.osds = Number(document.getElementById('editTruckOsdInput').value || 0);

  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  closeModal();
  showToast('Truck updated.');
}

function deleteTruck(id) {
  trucks = trucks.filter((t) => t.id !== id);
  saveStorage(STORAGE_KEYS.trucks, trucks);
  renderReceivingTable();
  renderReceivingStats();
  renderDashboardStats();
  showToast('Truck deleted.');
}

function openPutawayUploadModal() {
  openModal('Upload Put Away Log Image', `
    <div class="form-grid">
      <div class="full-span">
        <label>Select image</label>
        <input id="putawayImageInput" type="file" accept="image/*" />
      </div>
      <div class="full-span">
        <label>Preview OCR text</label>
        <textarea id="putawayOcrPreview" placeholder="OCR text will appear here after reading image..."></textarea>
      </div>
    </div>
    <div class="mt-16 action-row">
      <button class="primary-btn" onclick="processPutawayImage()">Read Image</button>
      <button class="secondary-btn" onclick="savePutawayFromPreview()">Save From Text</button>
    </div>
  `);
}

async function processPutawayImage() {
  const fileInput = document.getElementById('putawayImageInput');
  if (!fileInput?.files?.[0]) return showToast('Choose an image first.');
  if (typeof Tesseract === 'undefined') return showToast('OCR library did not load.');

  showToast('Reading put away log image...');

  try {
    const file = fileInput.files[0];
    const result = await Tesseract.recognize(file, 'eng');
    const text = result.data.text || '';
    document.getElementById('putawayOcrPreview').value = text;
    showToast('Image read. Review text and save.');
  } catch (err) {
    console.error(err);
    showToast('Could not read image.');
  }
}

async function savePutawayFromPreview() {
  const text = document.getElementById('putawayOcrPreview').value.trim();
  if (!text) return showToast('No OCR text to save.');

  const parsed = parsePutawayLogText(text);
  if (!parsed.length) return showToast('No put away entries found.');

  const today = new Date().toISOString().slice(0, 10);

  try {
    for (const entry of parsed) {
      await addDoc(collection(db, 'putAwayLogs'), {
        entryType: 'ocr',
        workerName: 'OCR Upload',
        workDate: today,
        lines: [
          {
            rowNumber: 1,
            itemNumber: entry.logNumber,
            quantity: 0,
            location: entry.location,
            notes: entry.rawLine,
          },
        ],
        submittedByUid: auth.currentUser?.uid || '',
        submittedByEmail: auth.currentUser?.email || '',
        createdAt: serverTimestamp(),
      });
    }

    lastPutawayUploadCount = parsed.length;
    closeModal();
    showToast(`Saved ${parsed.length} put away entries.`);
  } catch (err) {
    console.error(err);
    showToast('Could not save OCR results.');
  }
}

function parsePutawayLogText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results = [];
  for (const line of lines) {
    const locationMatch = line.match(/\b[A-Z]{1,2}-?\d{1,2}-\d\b|\b[A-Z]\d{1,2}-\d\b|\b[A-Z]{1,2}\d{1,2}-\d\b/i);
    const logMatch = line.match(/\b\d{5,8}\b/);

    if (locationMatch && logMatch) {
      results.push({
        logNumber: logMatch[0],
        location: locationMatch[0].toUpperCase(),
        rawLine: line,
      });
    }
  }

  return dedupePutawayEntries(results);
}

function dedupePutawayEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.logNumber}|${entry.location}|${entry.rawLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function openAddIncidentModal() {
  openModal('Add Quality / Safety Incident', `
    <div class="form-grid">
      <div>
        <label>Date</label>
        <input id="incidentDateInput" type="date" />
      </div>
      <div>
        <label>Type</label>
        <select id="incidentTypeInput">
          <option value="Near Miss">Near Miss</option>
          <option value="Damaged Product">Damaged Product</option>
          <option value="Inventory Variance">Inventory Variance</option>
          <option value="Safety Violation">Safety Violation</option>
          <option value="Product Damage">Product Damage</option>
          <option value="OSD Issue">OSD Issue</option>
          <option value="Equipment Damage">Equipment Damage</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div>
        <label>Area</label>
        <input id="incidentAreaInput" type="text" placeholder="Receiving, Aisle K, Dock 4..." />
      </div>
      <div>
        <label>Severity</label>
        <select id="incidentSeverityInput">
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
        </select>
      </div>
      <div>
        <label>Owner</label>
        <input id="incidentOwnerInput" type="text" placeholder="Henry" />
      </div>
      <div class="full-span">
        <label>Notes</label>
        <textarea id="incidentNotesInput" placeholder="What happened?"></textarea>
      </div>
    </div>
    <div class="mt-16">
      <button class="primary-btn full" onclick="saveIncident()">Save Incident</button>
    </div>
  `);

  setTimeout(() => {
    const today = new Date().toISOString().split('T')[0];
    const input = document.getElementById('incidentDateInput');
    if (input) input.value = today;
  }, 0);
}

function saveIncident() {
  const date = document.getElementById('incidentDateInput').value;
  const type = document.getElementById('incidentTypeInput').value;
  const area = document.getElementById('incidentAreaInput').value.trim();
  const severity = document.getElementById('incidentSeverityInput').value;
  const owner = document.getElementById('incidentOwnerInput').value.trim();
  const notesText = document.getElementById('incidentNotesInput').value.trim();

  if (!date || !area || !owner) return showToast('Fill in date, area, and owner.');

  qualityData.unshift({ date, type, area, severity, owner, notes: notesText });
  saveStorage(STORAGE_KEYS.quality, qualityData);
  renderQuality();
  closeModal();
  showToast('Incident added.');
}

function saveCoachingEntry() {
  const employee = document.getElementById('coachEmployee').value.trim();
  const topic = document.getElementById('coachTopic').value.trim();
  const notesText = document.getElementById('coachNotes').value.trim();

  if (!employee || !topic || !notesText) return showToast('Fill in all coaching fields.');

  coachingEntries.unshift({
    employee,
    topic,
    notes: notesText,
    createdAt: new Date().toISOString(),
  });

  saveStorage(STORAGE_KEYS.coaching, coachingEntries);
  document.getElementById('coachEmployee').value = '';
  document.getElementById('coachTopic').value = '';
  document.getElementById('coachNotes').value = '';

  renderCoaching();
  showToast('Coaching entry saved.');
}

function generateReport(type) {
  let content = '';

  if (type === 'supervisor') {
    content += 'DAILY SUPERVISOR REPORT\n\n';
    content += `Open Tasks: ${tasks.filter((t) => t.status !== 'Done').length}\n`;
    content += `Tasks Behind: ${tasks.filter((t) => t.status !== 'Done' && (t.status === 'Queued' || t.status === 'Pending' || isTaskAtRisk(t))).length}\n`;
    content += `Trucks: ${trucks.length}\n`;
    content += `Low Inventory: ${inventory.filter((i) => i.status === 'Low' || i.status === 'Out').length}\n`;
    content += `Incidents: ${qualityData.length}\n`;
    content += `Put Away Logs: ${putawayLogs.length}\n\n`;

    content += 'TASKS:\n';
    tasks.forEach((t) => {
      content += `${t.id} | ${t.task} | ${t.owner} | ${t.zone} | ${t.priority} | ${t.status}\n`;
    });

    content += '\nNOTES:\n';
    notes.forEach((n) => {
      content += `- ${n}\n`;
    });

    content += '\nCOACHING:\n';
    coachingEntries.forEach((c) => {
      content += `${c.employee} | ${c.topic} | ${c.notes}\n`;
    });
  }

  if (type === 'receiving') {
    content += 'RECEIVING REPORT\n\n';
    trucks.forEach((t) => {
      content += `Truck ${t.truckNumber} | Carrier: ${t.carrier} | Door: ${t.dockDoor} | Containers: ${t.containers} | OSDs: ${t.osds} | Status: ${t.status} | Dock Time: ${getTruckElapsedTime(t)}\n`;
    });

    content += '\nPUT AWAY LOGS:\n';
    putawayLogs.forEach((log) => {
      (log.lines || []).forEach((line) => {
        content += `${log.workDate} | ${log.workerName} | ${line.itemNumber} | Qty: ${line.quantity} | ${line.location} | ${line.notes}\n`;
      });
    });
  }

  if (type === 'inventory') {
    content += 'INVENTORY REPORT\n\n';
    getFilteredInventory().forEach((i) => {
      content += `${i.item} | ${i.desc} | On Hand: ${i.onHand} | Primary: ${i.primary} | Overstock: ${i.overstock} | Bin: ${i.bin} | ${i.status}\n`;
    });

    content += '\nCOUNT HISTORY:\n';
    counts.forEach((c) => {
      content += `${c.item} | ${c.desc} | Qty: ${c.qty} | Bin: ${c.bin} | ${formatDateTime(c.createdAt)}\n`;
    });
  }

  downloadTextFile(`${type}-report.txt`, content);
  showToast('Report downloaded.');
}

/* -------------------------------
   UI HELPERS
-------------------------------- */
function openModal(title, html) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2200);
}

function getTaskAge(task) {
  if (!task.createdAt) return '-';
  const diffMs = Date.now() - new Date(task.createdAt).getTime();
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  return hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
}

function isTaskAtRisk(task) {
  if (!task.createdAt || task.status === 'Done') return false;
  return (Date.now() - new Date(task.createdAt)) / 60000 > 30;
}

function isTruckDelayed(truck) {
  if (truck.status !== 'Active') return false;
  return (Date.now() - new Date(truck.startTime)) / 60000 > 60;
}

function getTruckElapsedTime(truck) {
  if (truck.status === 'Active') {
    const elapsed = Math.floor((new Date() - new Date(truck.startTime)) / 1000);
    return secondsToClock(elapsed);
  }
  return secondsToClock(truck.totalElapsedSeconds || 0);
}

function getLaborStatusClass(productivity) {
  if (productivity >= 90) return 'green';
  if (productivity >= 75) return 'yellow';
  return 'red';
}

function getLaborGoalLabel(productivity) {
  if (productivity >= 90) return 'Above Goal';
  if (productivity >= 75) return 'Near Goal';
  return 'Below Goal';
}

function getTopIssueArea() {
  if (!qualityData.length) return 'None';
  const counter = {};
  qualityData.forEach((i) => {
    counter[i.area] = (counter[i.area] || 0) + 1;
  });

  let topArea = 'None';
  let topCount = 0;
  Object.entries(counter).forEach(([area, count]) => {
    if (count > topCount) {
      topArea = area;
      topCount = count;
    }
  });

  return topArea;
}

function badge(value) {
  const v = String(value).toLowerCase();
  let cls = 'gray';

  if (['active', 'healthy', 'on floor', 'done', 'completed', 'on time', 'above goal', 'ok', 'manual'].includes(v)) cls = 'green';
  if (['queued', 'medium', 'counting', 'ocr'].includes(v)) cls = 'blue';
  if (['pending', 'low', 'near goal'].includes(v)) cls = 'yellow';
  if (['high', 'out', 'downtime', 'below goal', 'delayed', 'at risk'].includes(v)) cls = 'red';

  return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
}

function secondsToClock(seconds) {
  const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString();
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function cryptoRandomId() {
  return 'id-' + Math.random().toString(36).slice(2, 11);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

/* -------------------------------
   WINDOW EXPORTS
-------------------------------- */
window.saveNewAction = saveNewAction;
window.saveTask = saveTask;
window.toggleTaskStatus = toggleTaskStatus;
window.deleteTask = deleteTask;
window.saveCount = saveCount;
window.saveTruck = saveTruck;
window.stopTruckTimer = stopTruckTimer;
window.restartTruckTimer = restartTruckTimer;
window.editTruck = editTruck;
window.saveTruckEdit = saveTruckEdit;
window.deleteTruck = deleteTruck;
window.saveIncident = saveIncident;
window.processPutawayImage = processPutawayImage;
window.savePutawayFromPreview = savePutawayFromPreview;
