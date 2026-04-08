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
   ROLE ACCESS
-------------------------------- */
const ROLE_ALLOWED_VIEWS = {
  admin: ['dashboard', 'operations', 'inventory', 'receiving', 'putaway', 'picking', 'labor', 'quality', 'reports'],
  lead: ['dashboard', 'operations', 'inventory', 'receiving', 'putaway', 'picking', 'labor', 'quality', 'reports'],
  stocker: ['putaway'],
  cycle_counter: ['inventory'],
  picker: ['picking'],
};

const ROLE_HOME_VIEW = {
  admin: 'dashboard',
  lead: 'dashboard',
  stocker: 'putaway',
  cycle_counter: 'inventory',
  picker: 'picking',
};

function getAllowedViews(role) {
  return ROLE_ALLOWED_VIEWS[role] || [];
}

function getHomeView(role) {
  return ROLE_HOME_VIEW[role] || 'putaway';
}

function roleCanAccess(role, view) {
  return getAllowedViews(role).includes(view);
}

/* -------------------------------
   LOCAL STORAGE APP DATA
-------------------------------- */
const STORAGE_KEYS = {
  tasks: 'warehouse_tasks_v6',
  notes: 'warehouse_notes_v6',
  inventory: 'warehouse_inventory_v6',
  counts: 'warehouse_counts_v6',
  trucks: 'warehouse_trucks_v6',
  coaching: 'warehouse_coaching_v6',
  quality: 'warehouse_quality_v6',
  picking: 'warehouse_picking_v1',
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
let pickingRows = loadStorage(STORAGE_KEYS.picking, []);
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
   CYCLE COUNT LOCAL STATE
-------------------------------- */
const CC_STORAGE_KEY = 'cycleCountPro_embedded_v2';
const CC_DOWNTIME_LIMIT_MINUTES = 25;
const ccDefaultState = {
  currentSessionId: null,
  sessions: {},
};
let ccState = loadLocalJson(CC_STORAGE_KEY, ccDefaultState);

/* -------------------------------
   DOM
-------------------------------- */
const appShell = document.querySelector('.app-shell');
const sidebar = document.getElementById('sidebar');

const views = {
  dashboard: document.getElementById('dashboardView'),
  operations: document.getElementById('operationsView'),
  inventory: document.getElementById('inventoryView'),
  receiving: document.getElementById('receivingView'),
  putaway: document.getElementById('putawayView'),
  picking: document.getElementById('pickingView'),
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
const topbarSubtitle = document.getElementById('topbarSubtitle');
const newActionBtn = document.getElementById('newActionBtn');
const globalSearch = document.getElementById('globalSearch');

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
   CYCLE COUNT DOM
-------------------------------- */
const ccEls = {
  counterName: document.getElementById('ccCounterName'),
  stockCountId: document.getElementById('ccStockCountId'),
  status: document.getElementById('ccStatus'),
  countDate: document.getElementById('ccCountDate'),
  startTime: document.getElementById('ccStartTime'),
  upload: document.getElementById('ccUpload'),
  sessionBadge: document.getElementById('ccSessionBadge'),
  worksheetBody: document.getElementById('ccWorksheetBody'),
  downtimeLog: document.getElementById('ccDowntimeLog'),
  savedSessions: document.getElementById('ccSavedSessions'),
  totalRows: document.getElementById('ccTotalRows'),
  doneRows: document.getElementById('ccDoneRows'),
  varianceRows: document.getElementById('ccVarianceRows'),
  activityEvents: document.getElementById('ccActivityEvents'),
  downtimeEvents: document.getElementById('ccDowntimeEvents'),
  rowTemplate: document.getElementById('ccRowTemplate'),
};

/* -------------------------------
   PICKING DOM
-------------------------------- */
const pickEls = {
  pickerName: document.getElementById('pickerName'),
  pickerDate: document.getElementById('pickerDate'),
  pickUpload: document.getElementById('pickUpload'),
  clearBtn: document.getElementById('clearPickListBtn'),
  exportBtn: document.getElementById('exportPickCsvBtn'),
  tableBody: document.getElementById('pickTableBody'),
  totalLines: document.getElementById('pickTotalLines'),
  doneLines: document.getElementById('pickDoneLines'),
  shortLines: document.getElementById('pickShortLines'),
};

/* -------------------------------
   INIT
-------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupButtons();
  setToday();
  setPickerToday();
  buildLineRows(25);
  updateTotals();
  initCycleCount();
  initPicking();
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

function loadLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return deepClone(fallback);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : deepClone(fallback);
  } catch {
    return deepClone(fallback);
  }
}

function saveLocalJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* -------------------------------
   NAV / ROLE ACCESS
-------------------------------- */
function setupNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!currentUserProfile) return;

      const target = btn.dataset.view;
      if (!roleCanAccess(currentUserProfile.role, target)) {
        showToast('You do not have access to that section.');
        return;
      }

      activateView(target);
    });
  });
}

function activateView(viewName) {
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === viewName);
  });

  Object.entries(views).forEach(([name, viewEl]) => {
    viewEl.classList.toggle('active', name === viewName);
  });
}

function applyRoleAccess(role) {
  const allowedViews = getAllowedViews(role);
  const homeView = getHomeView(role);

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    const allowed = allowedViews.includes(btn.dataset.view);
    btn.classList.toggle('hidden', !allowed);
    btn.disabled = !allowed;
  });

  Object.entries(views).forEach(([name, viewEl]) => {
    const allowed = allowedViews.includes(name);
    viewEl.classList.toggle('hidden', !allowed);
    viewEl.classList.toggle('active', allowed && name === homeView);
  });

  if (['stocker', 'cycle_counter', 'picker'].includes(role)) {
    sidebar.classList.add('hidden');
    appShell.classList.add('compact-role');
    newActionBtn.classList.add('hidden');
    globalSearch.classList.add('hidden');

    if (role === 'stocker') topbarSubtitle.textContent = 'Put away entry only.';
    else if (role === 'cycle_counter') topbarSubtitle.textContent = 'Inventory and cycle count only.';
    else topbarSubtitle.textContent = 'Picking only.';
  } else {
    sidebar.classList.remove('hidden');
    appShell.classList.remove('compact-role');
    newActionBtn.classList.remove('hidden');
    globalSearch.classList.remove('hidden');
    topbarSubtitle.textContent = 'Run tasks, receiving, labor, counts, safety, reports, and put away logs in one place.';
  }

  activateView(homeView);
}

function hideAllAppViews() {
  Object.values(views).forEach((viewEl) => {
    viewEl.classList.remove('active');
    viewEl.classList.add('hidden');
  });
}

/* -------------------------------
   BUTTONS / EVENTS
-------------------------------- */
function setupButtons() {
  newActionBtn?.addEventListener('click', openNewActionModal);
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

  globalSearch?.addEventListener('input', renderAll);

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

      renderEmployeeDropdowns();
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
    sidebar.classList.remove('hidden');
    appShell.classList.remove('compact-role');
    newActionBtn.classList.remove('hidden');
    globalSearch.classList.remove('hidden');
    hideAllAppViews();
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

    applyRoleAccess(currentUserProfile.role || '');

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

function setPickerToday() {
  if (pickEls.pickerDate) pickEls.pickerDate.value = new Date().toISOString().slice(0, 10);
}

function setMessage(el, text = '', type = '') {
  if (!el) return;
  el.textContent = text;
  el.className = 'msg';
  if (type) el.classList.add(type);
}

function buildLineRows(rowCount = 25) {
  if (!lineItemsBody) return;
  lineItemsBody.innerHTML = '';

  for (let i = 1; i <= rowCount; i += 1) {
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
  buildLineRows(25);
  updateTotals();
  setMessage(formMsg);
}

function renderEmployeeDropdowns() {
  renderSelectOptions(workerName, 'Select worker');
  renderSelectOptions(ccEls.counterName, 'Select counter');
  renderSelectOptions(pickEls.pickerName, 'Select picker');
}

function renderSelectOptions(selectEl, defaultText) {
  if (!selectEl) return;
  const current = selectEl.value;
  selectEl.innerHTML = `<option value="">${defaultText}</option>`;

  activeEmployees.forEach((emp) => {
    const opt = document.createElement('option');
    opt.value = emp.name;
    opt.textContent = emp.name;
    selectEl.appendChild(opt);
  });

  if ([...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
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

  downloadTextFile(csv.join('\n'), `put-away-logs-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
}

/* -------------------------------
   MAIN RENDERING
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
  renderPicking();
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
  return (globalSearch?.value || '').trim().toLowerCase();
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
            <button class="small-btn task-advance-btn" data-id="${task.id}">Advance</button>
            <button class="small-btn task-delete-btn" data-id="${task.id}">Delete</button>
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

  document.querySelectorAll('.task-advance-btn').forEach((btn) => {
    btn.addEventListener('click', () => toggleTaskStatus(btn.dataset.id));
  });

  document.querySelectorAll('.task-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteTask(btn.dataset.id));
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
              ? `<button class="small-btn truck-stop-btn" data-id="${truck.id}">Stop Timer</button>`
              : `<button class="small-btn truck-restart-btn" data-id="${truck.id}">Restart</button>`}
            <button class="small-btn truck-edit-btn" data-id="${truck.id}">Edit</button>
            <button class="small-btn truck-delete-btn" data-id="${truck.id}">Delete</button>
          </div>
        </td>
      </tr>
    `);
  });

  document.querySelectorAll('.truck-stop-btn').forEach((btn) => {
    btn.addEventListener('click', () => stopTruckTimer(btn.dataset.id));
  });
  document.querySelectorAll('.truck-restart-btn').forEach((btn) => {
    btn.addEventListener('click', () => restartTruckTimer(btn.dataset.id));
  });
  document.querySelectorAll('.truck-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => editTruck(btn.dataset.id));
  });
  document.querySelectorAll('.truck-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteTruck(btn.dataset.id));
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
  if (!currentUserProfile || !['admin', 'lead'].includes(currentUserProfile.role)) {
    return showToast('You do not have access to that action.');
  }

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
      <button id="saveNewActionBtn" class="primary-btn full">Save Action</button>
    </div>
  `);

  document.getElementById('saveNewActionBtn')?.addEventListener('click', saveNewAction);
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
      <button id="saveTaskBtn" class="primary-btn full">Save Task</button>
    </div>
  `);

  document.getElementById('saveTaskBtn')?.addEventListener('click', saveTask);
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
      <button id="saveCountBtn" class="primary-btn full">Save Count</button>
    </div>
  `);

  document.getElementById('saveCountBtn')?.addEventListener('click', saveCount);
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
      <button id="saveTruckBtn" class="primary-btn full">Save Truck & Start Timer</button>
    </div>
  `);

  document.getElementById('saveTruckBtn')?.addEventListener('click', saveTruck);
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
      <button id="saveTruckEditBtn" class="primary-btn full">Save Changes</button>
    </div>
  `);

  document.getElementById('saveTruckEditBtn')?.addEventListener('click', () => saveTruckEdit(id));
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
      <button id="processPutawayImageBtn" class="primary-btn">Read Image</button>
      <button id="savePutawayFromPreviewBtn" class="secondary-btn">Save From Text</button>
    </div>
  `);

  document.getElementById('processPutawayImageBtn')?.addEventListener('click', processPutawayImage);
  document.getElementById('savePutawayFromPreviewBtn')?.addEventListener('click', savePutawayFromPreview);
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
      <button id="saveIncidentBtn" class="primary-btn full">Save Incident</button>
    </div>
  `);

  setTimeout(() => {
    const today = new Date().toISOString().split('T')[0];
    const input = document.getElementById('incidentDateInput');
    if (input) input.value = today;
  }, 0);

  document.getElementById('saveIncidentBtn')?.addEventListener('click', saveIncident);
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

  if (!employee || !topic || !notesText) return showToast('Fill in employee, topic, and notes.');

  coachingEntries.unshift({
    employee,
    topic,
    notes: notesText,
    createdAt: new Date().toISOString(),
  });

  saveStorage(STORAGE_KEYS.coaching, coachingEntries);
  renderCoaching();

  document.getElementById('coachEmployee').value = '';
  document.getElementById('coachTopic').value = '';
  document.getElementById('coachNotes').value = '';

  showToast('Coaching entry saved.');
}

function generateReport(type) {
  const payload = {
    generatedAt: new Date().toISOString(),
    type,
    tasks,
    notes,
    inventory,
    counts,
    trucks,
    coachingEntries,
    qualityData,
    putawayLogs,
    pickingRows,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}-report-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Report generated.');
}

function openModal(title, content) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = content;
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.getElementById('modalBody').innerHTML = '';
}

/* -------------------------------
   CYCLE COUNT EMBEDDED APP
-------------------------------- */
function initCycleCount() {
  setCcDefaults();

  document.getElementById('ccStartSessionBtn')?.addEventListener('click', ccStartSession);
  document.getElementById('ccSaveSessionBtn')?.addEventListener('click', ccSaveCurrentSession);
  document.getElementById('ccAddRowBtn')?.addEventListener('click', () => ccAddRow());
  document.getElementById('ccExportSessionCsvBtn')?.addEventListener('click', ccExportCurrentSessionCsv);
  document.getElementById('ccExportAllJsonBtn')?.addEventListener('click', ccExportAllJson);
  document.getElementById('ccClearSavedBtn')?.addEventListener('click', ccClearSavedData);
  ccEls.upload?.addEventListener('change', ccHandleUpload);

  ccEls.worksheetBody?.addEventListener('input', ccHandleRowInput);
  ccEls.worksheetBody?.addEventListener('change', ccHandleRowInput);
  ccEls.worksheetBody?.addEventListener('click', ccHandleRowClick);

  ccRenderAll();
}

function setCcDefaults() {
  const now = new Date();

  if (ccEls.countDate && !ccEls.countDate.value) {
    ccEls.countDate.value = now.toISOString().slice(0, 10);
  }

  if (ccEls.startTime && !ccEls.startTime.value) {
    ccEls.startTime.value = now.toTimeString().slice(0, 5);
  }
}

function ccSaveState() {
  saveLocalJson(CC_STORAGE_KEY, ccState);
}

function ccGenerateId() {
  return 'cc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

function ccGetCurrentSession() {
  const id = ccState.currentSessionId;
  return id ? ccState.sessions[id] : null;
}

function ccCreateEmptySession() {
  return {
    id: ccGenerateId(),
    counterName: ccEls.counterName.value || '',
    stockCountId: ccEls.stockCountId.value.trim() || '',
    status: ccEls.status.value || 'In Progress',
    countDate: ccEls.countDate.value || new Date().toISOString().slice(0, 10),
    startTime: ccEls.startTime.value || new Date().toTimeString().slice(0, 5),
    rows: [],
    activityLog: [],
    downtimeLog: [],
    updatedAt: new Date().toISOString(),
  };
}

function ccStartSession() {
  const session = ccCreateEmptySession();
  ccState.currentSessionId = session.id;
  ccState.sessions[session.id] = session;
  ccSaveState();
  ccRenderAll();
  showToast('New cycle count session started.');
}

function ccSaveCurrentSession() {
  const session = ccGetCurrentSession();
  if (!session) {
    showToast('Start a session first.');
    return;
  }

  session.counterName = ccEls.counterName.value || '';
  session.stockCountId = ccEls.stockCountId.value.trim() || '';
  session.status = ccEls.status.value || 'In Progress';
  session.countDate = ccEls.countDate.value || '';
  session.startTime = ccEls.startTime.value || '';
  session.updatedAt = new Date().toISOString();

  ccSaveState();
  ccRenderSavedSessions();
  showToast('Cycle count session saved.');
}

function ccAddRow(rowData = {}) {
  let session = ccGetCurrentSession();
  if (!session) {
    ccStartSession();
    session = ccGetCurrentSession();
  }

  session.rows.push({
    id: ccGenerateId(),
    bin: rowData.bin || '',
    item_number: rowData.item_number || '',
    description: rowData.description || '',
    uom: rowData.uom || 'EA',
    on_hand_qty: Number(rowData.on_hand_qty || 0),
    counted_qty: Number(rowData.counted_qty || 0),
    variance: Number(rowData.counted_qty || 0) - Number(rowData.on_hand_qty || 0),
    reason_code: rowData.reason_code || '',
    done: Boolean(rowData.done || false),
    count_time: rowData.count_time || '',
  });

  session.updatedAt = new Date().toISOString();
  ccSaveState();
  ccRenderAll();
}

function ccHandleUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCSV(reader.result);
    rows.forEach((row) => {
      ccAddRow({
        bin: row.Bin || row.bin || '',
        item_number: row.ItemNumber || row['Item #'] || row.item_number || '',
        description: row.Description || row.description || '',
        uom: row.UOM || row.uom || 'EA',
        on_hand_qty: Number(row.OnHand || row['On Hand'] || row.on_hand_qty || 0),
      });
    });
    showToast('Count list uploaded.');
    ccEls.upload.value = '';
  };
  reader.readAsText(file);
}

function ccHandleRowInput(event) {
  const target = event.target;
  const rowEl = target.closest('tr');
  if (!rowEl) return;

  const rowId = rowEl.dataset.rowId;
  const session = ccGetCurrentSession();
  if (!session) return;

  const row = session.rows.find((r) => r.id === rowId);
  if (!row) return;

  const field = target.dataset.field;
  if (!field) return;

  if (field === 'done') {
    row.done = target.checked;
    if (row.done && !row.count_time) {
      row.count_time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ccRegisterCountEvent(session, row);
    }
    if (!row.done) {
      row.count_time = '';
    }
  } else if (field === 'on_hand_qty' || field === 'counted_qty') {
    row[field] = Number(target.value || 0);
  } else {
    row[field] = target.value;
  }

  row.variance = Number(row.counted_qty || 0) - Number(row.on_hand_qty || 0);
  session.updatedAt = new Date().toISOString();
  ccSaveState();
  ccRenderAll();
}

function ccHandleRowClick(event) {
  const btn = event.target.closest('[data-action="delete"]');
  if (!btn) return;

  const rowEl = btn.closest('tr');
  if (!rowEl) return;

  const rowId = rowEl.dataset.rowId;
  const session = ccGetCurrentSession();
  if (!session) return;

  session.rows = session.rows.filter((r) => r.id !== rowId);
  session.updatedAt = new Date().toISOString();
  ccSaveState();
  ccRenderAll();
}

function ccRegisterCountEvent(session, row) {
  const nowIso = new Date().toISOString();
  session.activityLog.push({
    rowId: row.id,
    item: row.item_number,
    time: nowIso,
  });

  if (session.activityLog.length >= 2) {
    const prev = session.activityLog[session.activityLog.length - 2];
    const current = session.activityLog[session.activityLog.length - 1];
    const diffMinutes = Math.floor((new Date(current.time) - new Date(prev.time)) / 60000);

    if (diffMinutes > CC_DOWNTIME_LIMIT_MINUTES) {
      session.downtimeLog.push({
        fromItem: prev.item || 'Previous',
        toItem: current.item || 'Next',
        minutes: diffMinutes,
        at: nowIso,
      });
    }
  }
}

function ccRenderAll() {
  ccRenderFormFromSession();
  ccRenderRows();
  ccRenderStats();
  ccRenderDowntime();
  ccRenderSavedSessions();
}

function ccRenderFormFromSession() {
  const session = ccGetCurrentSession();

  if (!session) {
    ccEls.sessionBadge.textContent = 'No active session';
    return;
  }

  ccEls.counterName.value = session.counterName || '';
  ccEls.stockCountId.value = session.stockCountId || '';
  ccEls.status.value = session.status || 'In Progress';
  ccEls.countDate.value = session.countDate || '';
  ccEls.startTime.value = session.startTime || '';
  ccEls.sessionBadge.textContent = `${session.stockCountId || 'Unsaved Session'} • ${session.status}`;
}

function ccRenderRows() {
  const body = ccEls.worksheetBody;
  body.innerHTML = '';

  const session = ccGetCurrentSession();
  if (!session || !session.rows.length) {
    body.innerHTML = '<tr><td colspan="11" class="empty">No rows yet.</td></tr>';
    return;
  }

  session.rows.forEach((row) => {
    const fragment = ccEls.rowTemplate.content.cloneNode(true);
    const tr = fragment.querySelector('tr');
    tr.dataset.rowId = row.id;

    tr.querySelectorAll('[data-field]').forEach((el) => {
      const field = el.dataset.field;
      if (field === 'done') el.checked = !!row[field];
      else if (field === 'count_time') el.textContent = row[field] || '—';
      else el.value = row[field] ?? '';
    });

    body.appendChild(fragment);
  });
}

function ccRenderStats() {
  const session = ccGetCurrentSession();

  if (!session) {
    ccEls.totalRows.textContent = '0';
    ccEls.doneRows.textContent = '0';
    ccEls.varianceRows.textContent = '0';
    ccEls.activityEvents.textContent = '0';
    ccEls.downtimeEvents.textContent = '0';
    return;
  }

  ccEls.totalRows.textContent = String(session.rows.length);
  ccEls.doneRows.textContent = String(session.rows.filter((r) => r.done).length);
  ccEls.varianceRows.textContent = String(session.rows.filter((r) => Number(r.variance) !== 0).length);
  ccEls.activityEvents.textContent = String(session.activityLog.length);
  ccEls.downtimeEvents.textContent = String(session.downtimeLog.length);
}

function ccRenderDowntime() {
  const session = ccGetCurrentSession();
  ccEls.downtimeLog.innerHTML = '';

  if (!session || !session.downtimeLog.length) {
    ccEls.downtimeLog.innerHTML = '<div class="empty-state">No downtime events yet.</div>';
    return;
  }

  session.downtimeLog.forEach((entry) => {
    ccEls.downtimeLog.insertAdjacentHTML('beforeend', `
      <div class="log-item">
        <strong>${entry.minutes} min gap</strong><br />
        ${escapeHtml(entry.fromItem)} → ${escapeHtml(entry.toItem)}<br />
        <span class="coach-date">${formatDateTime(entry.at)}</span>
      </div>
    `);
  });
}

function ccRenderSavedSessions() {
  ccEls.savedSessions.innerHTML = '';

  const sessions = Object.values(ccState.sessions).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  if (!sessions.length) {
    ccEls.savedSessions.innerHTML = '<div class="empty-state">No saved sessions yet.</div>';
    return;
  }

  sessions.forEach((session) => {
    const item = document.createElement('div');
    item.className = 'session-item';
    item.innerHTML = `
      <div><strong>${escapeHtml(session.stockCountId || 'Untitled Session')}</strong></div>
      <div class="coach-date">${escapeHtml(session.counterName || 'No counter')} • ${escapeHtml(session.countDate || '')}</div>
      <div class="action-row mt-16">
        <button class="small-btn" data-action="load">Load</button>
        <button class="small-btn" data-action="delete">Delete</button>
      </div>
    `;

    item.querySelector('[data-action="load"]').addEventListener('click', () => {
      ccState.currentSessionId = session.id;
      ccSaveState();
      ccRenderAll();
      showToast('Cycle count session loaded.');
    });

    item.querySelector('[data-action="delete"]').addEventListener('click', () => {
      delete ccState.sessions[session.id];
      if (ccState.currentSessionId === session.id) ccState.currentSessionId = null;
      ccSaveState();
      ccRenderAll();
      showToast('Cycle count session deleted.');
    });

    ccEls.savedSessions.appendChild(item);
  });
}

function ccExportCurrentSessionCsv() {
  const session = ccGetCurrentSession();
  if (!session) return showToast('No active session.');

  const header = ['Bin', 'ItemNumber', 'Description', 'UOM', 'OnHand', 'CountedQty', 'Variance', 'ReasonCode', 'Done', 'CountTime'];
  const csv = [header.join(',')];

  session.rows.forEach((row) => {
    csv.push([
      row.bin,
      row.item_number,
      row.description,
      row.uom,
      row.on_hand_qty,
      row.counted_qty,
      row.variance,
      row.reason_code,
      row.done ? 'Yes' : 'No',
      row.count_time || '',
    ].map(csvEscape).join(','));
  });

  downloadTextFile(csv.join('\n'), `cycle-count-${(session.stockCountId || 'session').replace(/\s+/g, '-')}.csv`, 'text/csv;charset=utf-8;');
}

function ccExportAllJson() {
  downloadTextFile(JSON.stringify(ccState, null, 2), `cycle-count-all-${new Date().toISOString().slice(0, 10)}.json`, 'application/json;charset=utf-8;');
}

function ccClearSavedData() {
  if (!confirm('Clear all saved cycle count data?')) return;
  ccState = deepClone(ccDefaultState);
  ccSaveState();
  ccRenderAll();
  showToast('Cycle count saved data cleared.');
}

/* -------------------------------
   PICKING
-------------------------------- */
function initPicking() {
  pickEls.pickUpload?.addEventListener('change', handlePickUpload);
  pickEls.clearBtn?.addEventListener('click', clearPickList);
  pickEls.exportBtn?.addEventListener('click', exportPickingCsv);
  renderPicking();
}

function handlePickUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const rawRows = parseCSV(reader.result);
    pickingRows = consolidatePickRows(rawRows);
    saveStorage(STORAGE_KEYS.picking, pickingRows);
    renderPicking();
    showToast('Pick list uploaded.');
    pickEls.pickUpload.value = '';
  };
  reader.readAsText(file);
}

function consolidatePickRows(rawRows) {
  const grouped = {};

  rawRows.forEach((row) => {
    const location = (row.Location || row.location || row.Bin || row.bin || '').trim().toUpperCase();
    const itemNumber = (row.ItemNumber || row['Item #'] || row.item_number || '').trim();
    const description = (row.Description || row.description || '').trim();
    const qty = Number(row.Qty || row.QTY || row.Quantity || row.qty || 0);

    if (!location || !itemNumber) return;

    const key = `${location}|${itemNumber}`;

    if (!grouped[key]) {
      grouped[key] = {
        id: cryptoRandomId(),
        location,
        itemNumber,
        description,
        qtyNeeded: 0,
        qtyPicked: 0,
        done: false,
      };
    }

    grouped[key].qtyNeeded += qty;
  });

  return Object.values(grouped).sort((a, b) => naturalBinSort(a.location, b.location));
}

function renderPicking() {
  if (!pickEls.tableBody) return;

  pickEls.tableBody.innerHTML = '';

  if (!pickingRows.length) {
    pickEls.tableBody.innerHTML = '<tr><td colspan="7" class="empty">No pick list uploaded yet.</td></tr>';
    updatePickingStats();
    return;
  }

  pickingRows.forEach((row) => {
    const tr = document.createElement('tr');
    const isShort = Number(row.qtyPicked || 0) < Number(row.qtyNeeded || 0) && row.done;
    const isComplete = Number(row.qtyPicked || 0) >= Number(row.qtyNeeded || 0) && row.done;

    tr.classList.toggle('pick-short-row', isShort);
    tr.classList.toggle('pick-done-row', isComplete);

    tr.innerHTML = `
      <td>${escapeHtml(row.location)}</td>
      <td>${escapeHtml(row.itemNumber)}</td>
      <td>${escapeHtml(row.description)}</td>
      <td>${row.qtyNeeded}</td>
      <td><input type="number" min="0" value="${row.qtyPicked || 0}" data-pick-id="${row.id}" data-action="qty" /></td>
      <td class="${isShort ? 'pick-status-short' : isComplete ? 'pick-status-complete' : 'pick-status-open'}">
        ${isShort ? 'Short' : isComplete ? 'Complete' : 'Open'}
      </td>
      <td class="center"><input type="checkbox" ${row.done ? 'checked' : ''} data-pick-id="${row.id}" data-action="done" /></td>
    `;

    pickEls.tableBody.appendChild(tr);
  });

  pickEls.tableBody.querySelectorAll('[data-action="qty"]').forEach((input) => {
    input.addEventListener('input', (e) => {
      const id = e.target.dataset.pickId;
      const row = pickingRows.find((r) => r.id === id);
      if (!row) return;
      row.qtyPicked = Number(e.target.value || 0);
      saveStorage(STORAGE_KEYS.picking, pickingRows);
      renderPicking();
    });
  });

  pickEls.tableBody.querySelectorAll('[data-action="done"]').forEach((input) => {
    input.addEventListener('change', (e) => {
      const id = e.target.dataset.pickId;
      const row = pickingRows.find((r) => r.id === id);
      if (!row) return;
      row.done = e.target.checked;
      saveStorage(STORAGE_KEYS.picking, pickingRows);
      renderPicking();
    });
  });

  updatePickingStats();
}

function updatePickingStats() {
  const total = pickingRows.length;
  const done = pickingRows.filter((r) => r.done).length;
  const short = pickingRows.filter((r) => r.done && Number(r.qtyPicked || 0) < Number(r.qtyNeeded || 0)).length;

  if (pickEls.totalLines) pickEls.totalLines.textContent = String(total);
  if (pickEls.doneLines) pickEls.doneLines.textContent = String(done);
  if (pickEls.shortLines) pickEls.shortLines.textContent = String(short);
}

function clearPickList() {
  pickingRows = [];
  saveStorage(STORAGE_KEYS.picking, pickingRows);
  renderPicking();
  showToast('Pick list cleared.');
}

function exportPickingCsv() {
  if (!pickingRows.length) return showToast('No picking rows to export.');

  const header = ['Location', 'ItemNumber', 'Description', 'QtyNeeded', 'QtyPicked', 'Done'];
  const csv = [header.join(',')];

  pickingRows.forEach((row) => {
    csv.push([
      row.location,
      row.itemNumber,
      row.description,
      row.qtyNeeded,
      row.qtyPicked,
      row.done ? 'Yes' : 'No',
    ].map(csvEscape).join(','));
  });

  downloadTextFile(csv.join('\n'), `picking-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
}

/* -------------------------------
   HELPERS
-------------------------------- */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = (values[index] || '').trim();
    });
    return obj;
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function naturalBinSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function getTaskAge(task) {
  const created = new Date(task.createdAt);
  const diffMs = Date.now() - created.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function isTaskAtRisk(task) {
  const created = new Date(task.createdAt);
  const diffMins = Math.floor((Date.now() - created.getTime()) / 60000);
  return diffMins > 30 && task.status !== 'Done';
}

function getTruckElapsedTime(truck) {
  if (truck.status !== 'Active') return secondsToClock(truck.totalElapsedSeconds || 0);
  const seconds = Math.floor((Date.now() - new Date(truck.startTime).getTime()) / 1000);
  return secondsToClock(seconds);
}

function isTruckDelayed(truck) {
  const seconds = truck.status === 'Active'
    ? Math.floor((Date.now() - new Date(truck.startTime).getTime()) / 1000)
    : Number(truck.totalElapsedSeconds || 0);

  return seconds > 2 * 3600;
}

function secondsToClock(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function getLaborStatusClass(productivity) {
  if (productivity >= 90) return 'green';
  if (productivity >= 75) return 'yellow';
  return 'red';
}

function getLaborGoalLabel(productivity) {
  if (productivity >= 90) return 'Above Goal';
  if (productivity >= 75) return 'On Track';
  return 'Below Goal';
}

function getTopIssueArea() {
  if (!qualityData.length) return 'None';
  const countsByArea = {};
  qualityData.forEach((item) => {
    countsByArea[item.area] = (countsByArea[item.area] || 0) + 1;
  });
  return Object.entries(countsByArea).sort((a, b) => b[1] - a[1])[0][0];
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function badge(value) {
  const text = escapeHtml(String(value || ''));
  const lower = text.toLowerCase();

  let cls = '';
  if (['healthy', 'done', 'on floor', 'on time', 'active', 'complete'].includes(lower)) cls = 'green';
  else if (['low', 'medium', 'queued', 'pending', 'started', 'in progress'].includes(lower)) cls = 'yellow';
  else if (['out', 'high', 'delayed', 'downtime', 'short'].includes(lower)) cls = 'red';

  return `<span class="badge ${cls}">${text}</span>`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2500);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
  return str;
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function cryptoRandomId() {
  return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
