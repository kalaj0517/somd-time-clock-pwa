// CareTeam Time Clock PWA - v4.0.0 NUCLEAR RESET
// Automatic cache clearing on version mismatch
// Forces all old cached versions to refresh

const API_URL = 'https://script.google.com/macros/s/AKfycbyQ_Q7Wi7XQAOnYbxZWRjCM2MlBdU3x0mFhgzOZuqX8ApEFJimHEvlQY1SF6s6oEtqH/exec';
const APP_VERSION = '4.0.0';

let lat = null, lng = null;
let syncInProgress = false;
window.meta = null;

// ✅ FORCE CACHE CLEAR ON VERSION MISMATCH
(function checkVersion() {
  const storedVersion = localStorage.getItem('app-version');
  
  if (storedVersion !== APP_VERSION) {
    console.log('🔄 VERSION MISMATCH! Forcing cache clear...');
    console.log(`  Old: ${storedVersion || 'none'}, New: ${APP_VERSION}`);
    
    // Keep only critical user data
    const keep = ['selectedEmployee', 'employeeData', 'userEmail'];
    const toKeep = {};
    keep.forEach(key => {
      const val = localStorage.getItem(key);
      if (val) toKeep[key] = val;
    });
    
    // CLEAR EVERYTHING
    localStorage.clear();
    
    // Clear IndexedDB too
    indexedDB.deleteDatabase('TimeClockDB');
    
    // Restore user data
    Object.keys(toKeep).forEach(key => {
      localStorage.setItem(key, toKeep[key]);
    });
    
    // Set new version
    localStorage.setItem('app-version', APP_VERSION);
    
    // Force hard reload
    console.log('🔄 Reloading with fresh cache...');
    window.location.reload(true);
    return;
  }
  
  console.log('✅ Version OK:', APP_VERSION);
})();

// ---------- Utilities ----------
function uuid() {
  return (crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

window.setStatus = function(msg, cls) {
  const el = document.getElementById('status');
  if (!el) return;
  el.innerHTML = msg;
  el.className = cls || '';
  console.log(`Status: ${msg} (${cls})`);
};

function updateClock() {
  const now = new Date();
  const el = document.getElementById('timeDisplay');
  if (!el) return;
  el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

// ---------- Online/Offline ----------
function updateOnlineStatus() {
  const badge = document.getElementById('offlineBadge');
  if (badge) {
    badge.style.display = navigator.onLine ? 'none' : 'block';
  }
}
window.addEventListener('online', () => { 
  updateOnlineStatus(); 
  syncPendingActions(); 
});
window.addEventListener('offline', updateOnlineStatus);

// ---------- Geolocation (FORCE FRESH GPS) ----------
function getLoc() {
  if (!navigator.geolocation) {
    window.setStatus('GPS unavailable.', 'err');
    return;
  }
  window.setStatus('📍 Getting location...', 'warn');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      console.log('✅ GPS acquired:', { lat, lng, accuracy: pos.coords.accuracy });
      window.setStatus('✅ GPS ready', 'ok');
    },
    (error) => {
      console.error('❌ GPS error:', error);
      window.setStatus('⚠️ GPS unavailable. Enable location permissions.', 'err');
    },
    { 
      enableHighAccuracy: true, 
      timeout: 15000, 
      maximumAge: 0  // ✅ FORCE FRESH - no cached GPS!
    }
  );
}

// ✅ Refresh GPS before EVERY clock attempt
function refreshGPS() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ lat: null, lng: null });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        console.log('🔄 GPS refreshed:', { lat, lng, accuracy: pos.coords.accuracy });
        resolve({ lat, lng });
      },
      (error) => {
        console.error('❌ GPS refresh failed:', error);
        resolve({ lat, lng }); // Use last known if refresh fails
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  });
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

// ---------- Load meta ----------
window.loadMeta = async function() {
  console.log('🔄 Loading meta data...');
  
  try {
    const cached = localStorage.getItem('meta-cache');
    if (cached) {
      try {
        window.meta = JSON.parse(cached);
        console.log('✅ Loaded meta from cache:', window.meta);
        populateDropdowns();
      } catch (e) {
        console.warn('⚠️ Cache parse error:', e);
      }
    }

    if (navigator.onLine) {
      console.log('🌐 Fetching fresh meta...');
      
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          const data = await apiPost('getMeta', {});
          
          if (data && data.employees && data.clients) {
            window.meta = data;
            localStorage.setItem('meta-cache', JSON.stringify(data));
            console.log('✅ Meta loaded:', {
              employees: data.employees.length,
              clients: data.clients.length
            });
            populateDropdowns();
            return;
          }
        } catch (e) {
          attempts++;
          console.error(`❌ Attempt ${attempts} failed:`, e);
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
          }
        }
      }
    }
    
    if (window.meta) {
      populateDropdowns();
    } else {
      window.setStatus('❌ Unable to load data. Please refresh.', 'err');
    }
  } catch (e) {
    console.error('❌ loadMeta error:', e);
  }
};

function populateDropdowns() {
  if (!window.meta) return;

  const cliSel = document.getElementById('client');
  if (cliSel && window.meta.clients) {
    cliSel.innerHTML = '<option value="">Select client...</option>';
    window.meta.clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      opt.dataset.address = c.address || '';
      opt.dataset.notes = c.notes || '';
      cliSel.appendChild(opt);
    });
  }
}

// ---------- Duplicate prevention ----------
const recentActions = new Map();
function isDuplicate(employeeName, clientName, action) {
  const key = `${employeeName}|${clientName}|${action}`;
  const last = recentActions.get(key);
  if (last && (Date.now() - last) < 5000) {
    console.warn('⚠️ Duplicate prevented:', key);
    return true;
  }
  recentActions.set(key, Date.now());
  setTimeout(() => recentActions.delete(key), 60000);
  return false;
}

// ---------- Open session check ----------
async function checkForOpenSession(employeeName) {
  try {
    const result = await apiPost('checkOpenSession', { employeeName });
    return result.openSession || null;
  } catch (e) {
    console.error('❌ Error checking open session:', e);
    return null;
  }
}

// ---------- Clock submit ----------
window.submitClock = async function(action) {
  console.log(`⏰ Clock ${action} initiated`);
  
  const buttons = document.querySelectorAll('.clockInBtn, .clockOutBtn');
  const originalButtonTexts = new Map();
  
  buttons.forEach(btn => {
    originalButtonTexts.set(btn, btn.textContent);
  });
  
  const reEnableButtons = () => {
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.textContent = originalButtonTexts.get(btn);
    });
  };
  
  buttons.forEach(btn => {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    btn.textContent = '⏳ Processing...';
  });
  
  window.setStatus(`📤 ${action}ing... Please wait`, 'warn');
  
  try {
    // ✅ REFRESH GPS BEFORE CLOCKING
    console.log('🔄 Refreshing GPS...');
    const freshGPS = await refreshGPS();
    if (freshGPS.lat && freshGPS.lng) {
      console.log('✅ Using fresh GPS:', freshGPS);
    }
    
    const employeeName = document.getElementById('employee')?.value || '';
    const employeeEmail = document.getElementById('employeeEmail')?.value || '';
    const role = document.getElementById('role')?.value || '';
    const clientName = document.getElementById('client')?.value || '';
    const note = document.getElementById('note')?.value || '';
    const mileageVal = document.getElementById('mileage')?.value || '';
    const mileage = (action === 'Clock Out' && mileageVal !== '') ? parseFloat(mileageVal) : '';

    console.log('📋 Form data:', { employeeName, employeeEmail, role, clientName, note, mileage });

    // ✅ VALIDATE EMAIL (detect old cached versions)
    if (employeeEmail && !employeeEmail.includes('@somdhomehealth.com')) {
      alert('⚠️ OLD VERSION DETECTED!\n\nPlease:\n1. Close this page\n2. Clear browser cache\n3. Restart your phone\n4. Come back');
      reEnableButtons();
      return;
    }

    if (!employeeName) {
      window.setStatus('⚠️ Please select your name first.', 'err');
      reEnableButtons();
      return;
    }
    
    if (!clientName) {
      window.setStatus('⚠️ Please select a client.', 'err');
      reEnableButtons();
      return;
    }

    if (isDuplicate(employeeName, clientName, action)) {
      window.setStatus(`⚠️ Please wait 5 seconds between clicks.`, 'warn');
      reEnableButtons();
      return;
    }

    let previousClockOut = '';

    if (action === 'Clock In' && navigator.onLine) {
      try {
        const openSession = await checkForOpenSession(employeeName);
        if (openSession) {
          const clockInTime = new Date(openSession.clockIn);
          
          const input = prompt(
            `⚠️ You're still clocked in at ${openSession.client} since ${clockInTime.toLocaleTimeString()}.\n\n` +
            `Enter the time you LEFT that client (HH:MM or 2:15 PM).\n` +
            `Press Cancel to auto-close at current time.`
          );
          
          if (input && input.trim()) {
            previousClockOut = input.trim();
          }
        }
      } catch (e) {
        console.error('❌ Error checking open session:', e);
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

    console.log('📦 Payload:', payload);

    await saveToIndexedDB(payload);

    if (!navigator.onLine) {
      window.setStatus(`⚠️ ${action} saved (pending sync).`, 'warn');
      reEnableButtons();
      return;
    }

    const success = await sendToServer(payload);
    if (success) {
      window.setStatus(`✅ ${action} confirmed!`, 'ok');
      await markAsSynced(payload.id);

      if (action === 'Clock Out') {
        const m = document.getElementById('mileage'); if (m) m.value = '';
        const n = document.getElementById('note'); if (n) n.value = '';
      }
    } else {
      window.setStatus(`⚠️ ${action} saved (will sync).`, 'warn');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    window.setStatus(`❌ Error. Please try again.`, 'err');
    
  } finally {
    setTimeout(reEnableButtons, 2000);
  }
};

// ---------- Send to server ----------
async function sendToServer(payload, retry = 0) {
  const maxRetries = 3; // Reduced from 6

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
    
    // Show error to user
    window.setStatus(`⚠️ ${msg}`, 'err');
    
    const hardRejects = ['Outside geofence', 'Wait', 'just clocked', 'You just'];
    
    if (hardRejects.some(phrase => msg.includes(phrase))) {
      return false;
    }

    if (retry < maxRetries) {
      const delay = (retry + 1) * 1500;
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return sendToServer(payload, retry + 1);
    }
    
    return false;
  } catch (e) {
    console.error(`❌ Send error:`, e);
    
    if (retry < maxRetries && navigator.onLine) {
      const delay = (retry + 1) * 1500;
      await new Promise(r => setTimeout(r, delay));
      return sendToServer(payload, retry + 1);
    }
    return false;
  }
}

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('TimeClockDB', 4); // ✅ Bumped version
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
    }

    await new Promise((res) => (tx.oncomplete = () => res(true)));
  } catch (e) {
    console.error('❌ markAsSynced error:', e);
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

    const pending = all.filter(x => !x.synced && (x.retries ?? 0) < 5); // Reduced from 10
    
    for (const item of pending) {
      const ok = await sendToServer(item);
      
      if (ok) {
        await markAsSynced(item.id);
      } else {
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
    console.error('❌ syncPendingActions error:', e);
  } finally {
    syncInProgress = false;
  }
}

setInterval(() => { 
  if (navigator.onLine) syncPendingActions(); 
}, 30 * 1000);

document.addEventListener('visibilitychange', () => { 
  if (!document.hidden && navigator.onLine) syncPendingActions(); 
});

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 App v4.0.0 loaded');
  updateOnlineStatus();
  getLoc();
  window.loadMeta();
  setTimeout(syncPendingActions, 2000);
});
