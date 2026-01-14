// CareTeam Time Clock PWA - Fixed Version v2.0.1
// Key fixes:
// - Better meta loading with retry logic
// - Consistent employee data handling
// - Improved error logging
// - Fixed dropdown population

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
  console.log(`Status: ${msg} (${cls})`);
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
  if (badge) {
    badge.style.display = navigator.onLine ? 'none' : 'block';
    console.log('Online status:', navigator.onLine ? 'ONLINE' : 'OFFLINE');
  }
}
window.addEventListener('online', () => { 
  updateOnlineStatus(); 
  console.log('🌐 Back online!');
  syncPendingActions(); 
});
window.addEventListener('offline', () => {
  updateOnlineStatus();
  console.log('📴 Gone offline');
});

// ---------- Geolocation ----------
function getLoc() {
  if (!navigator.geolocation) {
    setStatus('GPS unavailable.', 'err');
    return;
  }
  setStatus('📍 Getting location...', 'warn');
  console.log('📍 Requesting geolocation...');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      console.log('✅ GPS acquired:', { lat, lng });
      setStatus('✅ GPS ready', 'ok');
    },
    (error) => {
      console.error('❌ GPS error:', error);
      setStatus('⚠️ GPS unavailable. Enable location permissions.', 'err');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// ---------- API helper (POST) ----------
async function apiPost(action, params = {}) {
  const body = new URLSearchParams({ action, ...params, t: Date.now() });
  
  console.log(`📡 API Call: ${action}`, params);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      cache: 'no-store'
    });

    if (!res.ok) {
      console.error(`❌ API HTTP Error: ${res.status}`);
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    console.log(`✅ API Response for ${action}:`, data);
    return data;
  } catch (error) {
    console.error(`❌ API Error for ${action}:`, error);
    throw error;
  }
}

// ---------- Load meta with retry logic ----------
async function loadMeta() {
  console.log('🔄 Loading meta data...');
  
  try {
    // Try to use cached data first
    const cached = localStorage.getItem('meta-cache');
    if (cached) {
      try {
        meta = JSON.parse(cached);
        console.log('✅ Loaded meta from cache:', meta);
        populateDropdowns();
      } catch (e) {
        console.warn('⚠️ Cache parse error:', e);
      }
    }

    // If online, fetch fresh data
    if (navigator.onLine) {
      console.log('🌐 Fetching fresh meta from server...');
      
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          const data = await apiPost('getMeta', {});
          
          if (data && data.employees && data.clients) {
            meta = data;
            localStorage.setItem('meta-cache', JSON.stringify(data));
            console.log('✅ Meta loaded from server:', {
              employees: data.employees.length,
              clients: data.clients.length
            });
            populateDropdowns();
            return;
          } else {
            console.warn('⚠️ Invalid meta data structure:', data);
          }
        } catch (e) {
          attempts++;
          console.error(`❌ Attempt ${attempts}/${maxAttempts} failed:`, e);
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
          }
        }
      }
    }
    
    // If we have cached data, use it
    if (meta) {
      console.log('✅ Using cached meta data');
      populateDropdowns();
    } else {
      console.error('❌ No meta data available');
      setStatus('❌ Unable to load data. Please check your connection and refresh.', 'err');
    }
  } catch (e) {
    console.error('❌ loadMeta error:', e);
    if (meta) {
      console.log('⚠️ Falling back to cached meta');
      populateDropdowns();
    }
  }
}

function populateDropdowns() {
  console.log('📋 Populating dropdowns...');
  
  if (!meta) {
    console.error('❌ Cannot populate: meta is null');
    return;
  }

  // Populate clients dropdown
  const cliSel = document.getElementById('client');
  if (cliSel && meta.clients) {
    console.log(`📋 Populating ${meta.clients.length} clients...`);
    cliSel.innerHTML = '<option value="">Select client...</option>';
    meta.clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      opt.dataset.address = c.address || '';
      opt.dataset.notes = c.notes || '';
      cliSel.appendChild(opt);
    });
    console.log('✅ Clients dropdown populated');
  }

  // Note: Employee dropdown is handled separately in index.html
  // because it's only used during setup
}

// ---------- Duplicate prevention (client-side) ----------
const recentActions = new Map();
function isDuplicate(employeeName, clientName, action) {
  const key = `${employeeName}|${clientName}|${action}`;
  const last = recentActions.get(key);
  if (last && (Date.now() - last) < 10000) {
    console.warn('⚠️ Duplicate action prevented:', key);
    return true;
  }
  recentActions.set(key, Date.now());
  setTimeout(() => recentActions.delete(key), 60000);
  return false;
}

// ---------- Open session check ----------
async function checkForOpenSession(employeeName) {
  console.log('🔍 Checking for open session:', employeeName);
  try {
    const result = await apiPost('checkOpenSession', { employeeName });
    console.log('✅ Open session check result:', result);
    return result.openSession || null;
  } catch (e) {
    console.error('❌ Error checking open session:', e);
    return null;
  }
}

// ---------- Clock submit ----------
async function submitClock(action) {
  console.log(`⏰ Clock ${action} initiated`);
  
  const employeeName = document.getElementById('employee')?.value || '';
  const employeeEmail = document.getElementById('employeeEmail')?.value || '';
  const role = document.getElementById('role')?.value || '';
  const clientName = document.getElementById('client')?.value || '';
  const note = document.getElementById('note')?.value || '';

  const mileageVal = document.getElementById('mileage')?.value || '';
  const mileage = (action === 'Clock Out' && mileageVal !== '') ? parseFloat(mileageVal) : '';

  console.log('📋 Form data:', { employeeName, employeeEmail, role, clientName, note, mileage });

  // Validation
  if (!employeeName) {
    console.error('❌ No employee name');
    return setStatus('⚠️ Please select your name first.', 'err');
  }
  
  if (!clientName) {
    console.error('❌ No client selected');
    return setStatus('⚠️ Please select a client.', 'err');
  }

  // Duplicate check
  if (isDuplicate(employeeName, clientName, action)) {
    return setStatus(`⚠️ You just ${action.toLowerCase()}ed. Wait 10 seconds.`, 'warn');
  }

  // Check for open session on Clock In
  let previousClockOut = '';

  if (action === 'Clock In' && navigator.onLine) {
    try {
      const openSession = await checkForOpenSession(employeeName);
      if (openSession) {
        const clockInTime = new Date(openSession.clockIn);
        console.log('⚠️ Found open session:', openSession);
        
        const input = prompt(
          `⚠️ You're still clocked in at ${openSession.client} since ${clockInTime.toLocaleTimeString()}.\n\n` +
          `Enter the time you LEFT that client (HH:MM or 2:15 PM).\n` +
          `Press Cancel to auto-close it at the current time and continue.`
        );
        
        if (input && input.trim()) {
          previousClockOut = input.trim();
          console.log('✏️ User provided previous clock out time:', previousClockOut);
        } else {
          console.log('⏰ Will auto-close previous session at current time');
        }
      }
    } catch (e) {
      console.error('❌ Error checking for open session:', e);
    }
  }

  // Build payload
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

  console.log('📦 Payload:', payload);
  setStatus(`📤 ${action}ing...`, 'warn');

  // Save to IndexedDB (always)
  await saveToIndexedDB(payload);
  console.log('💾 Saved to IndexedDB');

  // Try to send
  if (!navigator.onLine) {
    console.log('📴 Offline - will sync later');
    return setStatus(`⚠️ ${action} saved (pending sync).`, 'warn');
  }

  const success = await sendToServer(payload);
  if (success) {
    console.log('✅ Clock action confirmed by server');
    setStatus(`✅ ${action} confirmed.`, 'ok');
    await markAsSynced(payload.id);

    // Clear fields after successful clock out
    if (action === 'Clock Out') {
      const m = document.getElementById('mileage'); if (m) m.value = '';
      const n = document.getElementById('note'); if (n) n.value = '';
      console.log('🧹 Cleared mileage and note fields');
    }
  } else {
    console.warn('⚠️ Server did not confirm - will retry later');
    setStatus(`⚠️ ${action} saved (pending sync). Keep app open briefly.`, 'warn');
  }
}

// ---------- Send to server (POST) ----------
async function sendToServer(payload, retry = 0) {
  const maxRetries = 6;
  
  console.log(`📡 Sending to server (attempt ${retry + 1}/${maxRetries + 1})`);

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

    if (result?.ok) {
      console.log('✅ Server confirmed:', result.message);
      return true;
    }

    const msg = (result?.message || '').toString();
    console.warn('⚠️ Server rejected:', msg);
    
    // Don't retry hard rejects
    const hardRejects = [
      'Outside geofence',
      'Wait',
      'just clocked',
      'You just'
    ];
    
    if (hardRejects.some(phrase => msg.includes(phrase))) {
      console.log('🛑 Hard reject - not retrying');
      return false;
    }

    // Retry on soft failures
    if (retry < maxRetries) {
      const delay = (retry + 1) * 1500;
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return sendToServer(payload, retry + 1);
    }
    
    console.error('❌ Max retries reached');
    return false;
  } catch (e) {
    console.error(`❌ Send error (attempt ${retry + 1}):`, e);
    
    if (retry < maxRetries && navigator.onLine) {
      const delay = (retry + 1) * 1500;
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
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
    console.log('💾 IndexedDB save successful');
  } catch (e) {
    console.error('❌ IndexedDB save error:', e);
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
      console.log('✅ Marked as synced:', id);
    }

    await new Promise((res) => (tx.oncomplete = () => res(true)));
  } catch (e) {
    console.error('❌ markAsSynced error:', e);
  }
}

async function syncPendingActions() {
  if (syncInProgress || !navigator.onLine) {
    console.log('⏸️ Sync skipped:', syncInProgress ? 'already in progress' : 'offline');
    return;
  }
  
  syncInProgress = true;
  console.log('🔄 Starting sync of pending actions...');

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
    console.log(`📋 Found ${pending.length} pending actions to sync`);
    
    for (const item of pending) {
      console.log('📤 Syncing:', item);
      const ok = await sendToServer(item);
      
      if (ok) {
        await markAsSynced(item.id);
      } else {
        // Bump retries
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
          console.log(`⏭️ Bumped retry count to ${rec.retries} for:`, item.id);
        }
        await new Promise((res) => (tx2.oncomplete = () => res(true)));
      }
    }
    
    console.log('✅ Sync complete');
  } catch (e) {
    console.error('❌ syncPendingActions error:', e);
  } finally {
    syncInProgress = false;
  }
}

// Silent sync schedule
setInterval(() => { 
  if (navigator.onLine) {
    console.log('⏰ Auto-sync triggered');
    syncPendingActions(); 
  }
}, 30 * 1000);

document.addEventListener('visibilitychange', () => { 
  if (!document.hidden && navigator.onLine) {
    console.log('👀 App visible - triggering sync');
    syncPendingActions(); 
  }
});

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 App.js loaded and initializing...');
  updateOnlineStatus();
  getLoc();
  loadMeta();
  setTimeout(() => {
    console.log('⏰ Initial sync check');
    syncPendingActions();
  }, 2000);
});
