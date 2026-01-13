// CareTeam Time Clock PWA - Reliable Version
// - POST API calls (no querystring issues)
// - Never caches API calls (paired with SW rules)
// - Client-generated action IDs (IndexedDB works)
// - Allows Clock In even if previous session open: prompts previousClockOut
// - Sets localStorage.userEmail from employee selection
// - Clear pending vs confirmed UI messaging

const API_URL = 'https://script.google.com/macros/s/AKfycbyQ_Q7Wi7XQAOnYbxZWRjCM2MlBdU3x0mFhgzOZuqX8ApEFJimHEvlQY1SF6s6oEtqH/exec';

let lat = null, lng = null;
let meta = null;
let syncInProgress = false;

// ---------- Utilities ----------
function uuid() {
  return (crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setStatus(msg, cls) {
  const el = document.getElementById('status');
  if (!el) return;
  el.innerHTML = msg;
  el.className = cls || '';
}

function updateClock() {
  const now = new Date();
  const el = document.getElementById('timeDisplay');
  if (!el) return;
  el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ---------- Online/Offline badge ----------
function updateOnlineStatus() {
  const badge = document.getElementById('offlineBadge');
  if (badge) badge.style.display = navigator.onLine ? 'none' : 'block';
}
window.addEventListener('online', () => { updateOnlineStatus(); syncPendingActions(); });
window.addEventListener('offline', updateOnlineStatus);

// ---------- Geolocation ----------
function getLoc() {
  if (!navigator.geolocation) {
    setStatus('GPS unavailable.', 'err');
    return;
  }
  setStatus('📍 Getting location...', 'warn');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      setStatus('✅ GPS ready', 'ok');
    },
    () => setStatus('⚠️ GPS unavailable. Enable location permissions.', 'err'),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// ---------- API helper (POST) ----------
async function apiPost(action, params = {}) {
  const body = new URLSearchParams({ action, ...params, t: Date.now() });

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
    cache: 'no-store'
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- Load meta ----------
async function loadMeta() {
  try {
    const cached = localStorage.getItem('meta-cache');
    if (cached) {
      meta = JSON.parse(cached);
      populateDropdowns();
    }

    if (navigator.onLine) {
      const data = await apiPost('getMeta', {});
      meta = data;
      localStorage.setItem('meta-cache', JSON.stringify(data));
      populateDropdowns();
    }
  } catch (e) {
    console.error('loadMeta error', e);
    if (meta) populateDropdowns();
  }
}

function populateDropdowns() {
  const cliSel = document.getElementById('client');
  if (cliSel && meta?.clients) {
    cliSel.innerHTML = '<option value="">Select client...</option>';
    meta.clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      cliSel.appendChild(opt);
    });
  }

  const empDropdown = document.getElementById('employeeDropdown');
  if (empDropdown && meta?.employees) {
    empDropdown.innerHTML = '<option value="">-- Select your name --</option>';
    meta.employees.forEach(emp => {
      const option = document.createElement('option');
      option.value = emp.fullName;
      option.textContent = emp.fullName;
      option.dataset.email = emp.email || '';
      option.dataset.role = emp.role || '';
      option.dataset.shortName = emp.shortName || emp.name || emp.fullName;
      empDropdown.appendChild(option);
    });
  }
}

// Called by your existing UI if you have a "Save employee" button
function saveEmployeeSelection() {
  const dd = document.getElementById('employeeDropdown');
  const selected = dd?.options?.[dd.selectedIndex];
  if (!selected || !selected.value) return;

  const shortName = selected.dataset.shortName || selected.value;
  const email = (selected.dataset.email || '').trim().toLowerCase();
  const role = selected.dataset.role || '';

  // Your existing hidden inputs (if present)
  const empNameEl = document.getElementById('employee');
  const empEmailEl = document.getElementById('employeeEmail');
  const roleEl = document.getElementById('role');

  if (empNameEl) empNameEl.value = shortName;
  if (empEmailEl) empEmailEl.value = email;
  if (roleEl && !roleEl.value) roleEl.value = role;

  // Critical: make My Times always use the same email
  if (email) localStorage.setItem('userEmail', email);

  setStatus(`✅ Selected: ${selected.value}`, 'ok');
}

// ---------- Duplicate prevention (client-side) ----------
const recentActions = new Map();
function isDuplicate(employeeName, clientName, action) {
  const key = `${employeeName}|${clientName}|${action}`;
  const last = recentActions.get(key);
  if (last && (Date.now() - last) < 10000) return true;
  recentActions.set(key, Date.now());
  setTimeout(() => recentActions.delete(key), 60000);
  return false;
}

// ---------- Open session check ----------
async function checkForOpenSession(employeeName) {
  try {
    const result = await apiPost('checkOpenSession', { employeeName });
    return result.openSession || null;
  } catch {
    return null;
  }
}

// ---------- Clock submit ----------
async function submitClock(action) {
  const employeeName = document.getElementById('employee')?.value || '';
  const employeeEmail = document.getElementById('employeeEmail')?.value || '';
  const role = document.getElementById('role')?.value || '';
  const clientName = document.getElementById('client')?.value || '';
  const note = document.getElementById('note')?.value || '';

  const mileageVal = document.getElementById('mileage')?.value || '';
  const mileage = (action === 'Clock Out' && mileageVal !== '') ? parseFloat(mileageVal) : '';

  if (!employeeName) return setStatus('⚠️ Please select your name first.', 'err');
  if (!clientName) return setStatus('⚠️ Please select a client.', 'err');

  if (isDuplicate(employeeName, clientName, action)) {
    return setStatus(`⚠️ You just ${action.toLowerCase()}ed. Wait 10 seconds.`, 'warn');
  }

  // Allow Clock In even if open session exists
  let previousClockOut = '';
  if (action === 'Clock In' && navigator.onLine) {
    const openSession = await checkForOpenSession(employeeName);
    if (openSession) {
      const clockInTime = new Date(openSession.clockIn);
      const input = prompt(
        `⚠️ You're still clocked in at ${openSession.client} since ${clockInTime.toLocaleTimeString()}.\n\n` +
        `Enter the time you LEFT that client (HH:MM or 2:15 PM).\n` +
        `Press Cancel to keep it open and continue clocking in.`
      );
      if (input && input.trim()) previousClockOut = input.trim();
      // Do NOT return; continue
    }
  }

  const payload = {
    id: uuid(),
    timestamp: Date.now(),
    employeeName,
    employeeEmail: (employeeEmail || '').trim().toLowerCase(),
    role,
    clientName,
    action,
    lat: lat ?? '',
    lng: lng ?? '',
    note,
    mileage,
    previousClockOut
  };

  setStatus(`📤 ${action}ing...`, 'warn');

  // Save to IndexedDB (always)
  await saveToIndexedDB(payload);

  // Try to send
  if (!navigator.onLine) {
    return setStatus(`⚠️ ${action} saved (pending sync).`, 'warn');
  }

  const success = await sendToServer(payload);
  if (success) {
    setStatus(`✅ ${action} confirmed.`, 'ok');
    await markAsSynced(payload.id);

    if (action === 'Clock Out') {
      const m = document.getElementById('mileage'); if (m) m.value = '';
      const n = document.getElementById('note'); if (n) n.value = '';
    }
  } else {
    // Don't claim success if not confirmed
    setStatus(`⚠️ ${action} saved (pending sync). Keep app open briefly.`, 'warn');
  }
}

// ---------- Send to server (POST) ----------
async function sendToServer(payload, retry = 0) {
  const maxRetries = 6;

  try {
    const result = await apiPost('clock', {
      id: payload.id,
      employeeName: payload.employeeName,
      employeeEmail: payload.employeeEmail || '',
      role: payload.role || '',
      clientName: payload.clientName,
      clockAction: payload.action,
      lat: payload.lat || '',
      lng: payload.lng || '',
      note: payload.note || '',
      mileage: payload.mileage ?? '',
      previousClockOut: payload.previousClockOut || ''
    });

    if (result?.ok) return true;

    const msg = (result?.message || '').toString();
    // Don't retry hard rejects
    if (msg.includes('Outside geofence') || msg.includes('Wait') || msg.includes('just clocked')) return false;

    if (retry < maxRetries) {
      await new Promise(r => setTimeout(r, (retry + 1) * 1500));
      return sendToServer(payload, retry + 1);
    }
    return false;
  } catch (e) {
    if (retry < maxRetries && navigator.onLine) {
      await new Promise(r => setTimeout(r, (retry + 1) * 1500));
      return sendToServer(payload, retry + 1);
    }
    return false;
  }
}

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('TimeClockDB', 3);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pending-actions')) {
        const store = db.createObjectStore('pending-actions', { keyPath: 'id' });
        store.createIndex('synced', 'synced');
        store.createIndex('timestamp', 'timestamp');
      }
    };
  });
}

async function saveToIndexedDB(data) {
  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readwrite');
    const store = tx.objectStore('pending-actions');
    store.put({ ...data, synced: false, retries: 0, savedAt: Date.now() });
    await new Promise((res, rej) => {
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.error('IndexedDB save error:', e);
  }
}

async function markAsSynced(id) {
  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readwrite');
    const store = tx.objectStore('pending-actions');

    const record = await new Promise((resolve) => {
      const r = store.get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });

    if (record) {
      record.synced = true;
      record.syncedAt = Date.now();
      store.put(record);
    }

    await new Promise((res) => (tx.oncomplete = () => res(true)));
  } catch (e) {
    console.error('markAsSynced error', e);
  }
}

async function syncPendingActions() {
  if (syncInProgress || !navigator.onLine) return;
  syncInProgress = true;

  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readonly');
    const store = tx.objectStore('pending-actions');

    const all = await new Promise((resolve) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => resolve([]);
    });

    const pending = all.filter(x => !x.synced && (x.retries ?? 0) < 10);
    for (const item of pending) {
      const ok = await sendToServer(item);
      if (ok) {
        await markAsSynced(item.id);
      } else {
        // bump retries
        const db2 = await openDB();
        const tx2 = db2.transaction('pending-actions', 'readwrite');
        const store2 = tx2.objectStore('pending-actions');
        const rec = await new Promise((resolve) => {
          const r = store2.get(item.id);
          r.onsuccess = () => resolve(r.result || null);
          r.onerror = () => resolve(null);
        });
        if (rec) {
          rec.retries = (rec.retries ?? 0) + 1;
          store2.put(rec);
        }
        await new Promise((res) => (tx2.oncomplete = () => res(true)));
      }
    }
  } catch (e) {
    console.error('syncPendingActions error', e);
  } finally {
    syncInProgress = false;
  }
}

// Silent sync schedule
setInterval(() => { if (navigator.onLine) syncPendingActions(); }, 30 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) syncPendingActions(); });

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  updateOnlineStatus();
  getLoc();
  loadMeta();
  setTimeout(syncPendingActions, 2000);
});
