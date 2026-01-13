// SILENT SYNC VERSION - v2.0.0
// Offline capability with invisible background sync
// Work email standardization

const API_URL = 'https://script.google.com/macros/s/AKfycbyQ_Q7Wi7XQAOnYbxZWRjCM2MlBdU3x0mFhgzOZuqX8ApEFJimHEvlQY1SF6s6oEtqH/exec';

let lat = null, lng = null, meta = null;
let deferredPrompt = null;
let syncInProgress = false;

// ===== SILENT AGGRESSIVE AUTO-SYNC =====
// Syncs every 30 seconds, completely invisible to user
setInterval(() => {
  if (navigator.onLine && !syncInProgress) {
    syncPendingActions(); // Silent - no console logs to user
  }
}, 30 * 1000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && navigator.onLine) {
    syncPendingActions();
  }
});

setInterval(() => {
  if (navigator.onLine) {
    loadMeta();
  }
}, 30 * 60 * 1000);

// ===== CLOCK DISPLAY =====
function updateClock() {
  const now = new Date();
  const timeEl = document.getElementById('timeDisplay');
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString([], {
      hour:'2-digit', 
      minute:'2-digit', 
      second:'2-digit'
    });
  }
}
setInterval(updateClock, 1000);
updateClock();

function setStatus(msg, cls) {
  const el = document.getElementById('status');
  if (el) {
    el.innerHTML = msg;
    el.className = cls || '';
  }
}

// ===== ONLINE/OFFLINE STATUS =====
function updateOnlineStatus() {
  const badge = document.getElementById('offlineBadge');
  if (badge) {
    badge.style.display = navigator.onLine ? 'none' : 'block';
  }
  
  if (navigator.onLine) {
    setTimeout(syncPendingActions, 1000);
  }
}

window.addEventListener('online', () => {
  updateOnlineStatus();
  syncPendingActions();
});

window.addEventListener('offline', () => {
  updateOnlineStatus();
});

// ===== LOAD META =====
async function loadMeta() {
  try {
    const cached = localStorage.getItem('meta-cache');
    if (cached) {
      meta = JSON.parse(cached);
      populateDropdowns();
    }

    if (navigator.onLine) {
      const response = await fetch(`${API_URL}?action=getMeta&t=${Date.now()}`);
      if (!response.ok) throw new Error('Failed to fetch meta');
      
      const data = await response.json();
      meta = data;
      localStorage.setItem('meta-cache', JSON.stringify(data));
      populateDropdowns();
    }
  } catch (error) {
    console.error('Error loading meta:', error);
    if (meta) {
      populateDropdowns();
    }
  }
}

function populateDropdowns() {
  const cliSel = document.getElementById('client');
  if (!cliSel) return;

  cliSel.innerHTML = '<option value="">Select client...</option>';
  (meta.clients || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    cliSel.appendChild(opt);
  });
  
  const empDropdown = document.getElementById('employeeDropdown');
  if (empDropdown && meta.employees) {
    empDropdown.innerHTML = '<option value="">-- Select your name --</option>';
    meta.employees.forEach(emp => {
      const option = document.createElement('option');
      option.value = emp.fullName;
      option.textContent = emp.fullName;
      option.dataset.email = emp.email; // Work email now!
      option.dataset.role = emp.role || '';
      option.dataset.shortName = emp.name;
      empDropdown.appendChild(option);
    });
  }
}

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
      setStatus(`✅ GPS ready`, 'ok');
    },
    (error) => {
      setStatus('⚠️ GPS unavailable. Enable location.', 'err');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// ===== DUPLICATE PREVENTION =====
const recentClockIns = new Map();

function isDuplicate(employeeName, clientName, action) {
  const key = `${employeeName}|${clientName}|${action}`;
  const lastTime = recentClockIns.get(key);
  
  if (lastTime && (Date.now() - lastTime) < 10000) {
    return true;
  }
  
  recentClockIns.set(key, Date.now());
  setTimeout(() => recentClockIns.delete(key), 60000);
  return false;
}

// ===== CLOCK IN/OUT - SIMPLIFIED =====
async function submitClock(action) {
  const employeeName = document.getElementById('employee').value;
  const employeeEmail = document.getElementById('employeeEmail')?.value || '';
  const cliSel = document.getElementById('client');
  const clientName = cliSel.value;

  if (!employeeName) {
    setStatus('⚠️ Please select your name first.', 'err');
    return;
  }

  if (!clientName) {
    setStatus('⚠️ Please select a client.', 'err');
    return;
  }

  if (isDuplicate(employeeName, clientName, action)) {
    setStatus(`⚠️ You just ${action.toLowerCase()}ed! Wait 10 seconds.`, 'warn');
    return;
  }

  // Check for open session
  if (action === 'Clock In' && navigator.onLine) {
    try {
      const openSession = await checkForOpenSession(employeeName);
      if (openSession) {
        const clockInTime = new Date(openSession.clockIn);
        const message = `⚠️ You're still clocked in at ${openSession.client} since ${clockInTime.toLocaleTimeString()}!\n\nPlease clock out there first.`;
        alert(message);
        setStatus(`⚠️ Clock out of ${openSession.client} first!`, 'err');
        return;
      }
    } catch (error) {
      console.error('Error checking open session:', error);
    }
  }

  const role = document.getElementById('role').value || '';
  const note = document.getElementById('note').value;
  const mileageVal = document.getElementById('mileage').value;
  const mileage = (action === 'Clock Out' && mileageVal !== '') ? parseFloat(mileageVal) : null;

  const payload = {
    employeeName,
    employeeEmail,
    role,
    clientName,
    action,
    lat,
    lng,
    note,
    mileage
    // ID will be generated by server!
  };

  setStatus(`📤 ${action}ing...`, 'warn');

payload.id = payload.id || (crypto.randomUUID
 ? crypto.randomUUID()
 : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  payload.timestamp = payload.timestamp || Date.now();
  
  // Save to IndexedDB for backup
  await saveToIndexedDB(payload);

  // Try to send immediately
  if (navigator.onLine) {
    const success = await sendToServer(payload);
    
    if (success) {
      setStatus(`✅ ${action} successful!`, 'ok');
      await markAsSynced(payload.id);
      
      if (action === 'Clock Out') {
        document.getElementById('mileage').value = '';
        document.getElementById('note').value = '';
      }
    } else {
      // Failed but will retry in background - don't tell employee!
      setStatus(`✅ ${action} recorded! Syncing in background...`, 'ok');
    }
  } else {
    // Offline - save and will sync later
    setStatus(`✅ ${action} saved! Will sync when connected.`, 'ok');
  }
}

async function checkForOpenSession(employeeName) {
  try {
    const params = new URLSearchParams({
      action: 'checkOpenSession',
      employeeName: employeeName,
      t: Date.now()
    });
    
    const response = await fetch(`${API_URL}?${params.toString()}`);
    if (!response.ok) return null;
    
    const result = await response.json();
    return result.openSession || null;
  } catch (error) {
    return null;
  }
}

// ===== SEND TO SERVER =====
async function sendToServer(payload, retryCount = 0) {
  const maxRetries = 10;
  
  try {
    const params = new URLSearchParams({
      action: 'clock',
      employeeName: payload.employeeName,
      employeeEmail: payload.employeeEmail || '',
      role: payload.role || '',
      clientName: payload.clientName,
      clockAction: payload.action,
      lat: payload.lat || '',
      lng: payload.lng || '',
      note: payload.note || '',
      mileage: payload.mileage || '',
      t: Date.now()
    });

    const response = await fetch(`${API_URL}?${params.toString()}`, { 
      method: 'GET',
      cache: 'no-cache'
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const result = await response.json();
    
    if (result.ok) {
      return true;
    } else {
      // Don't retry duplicates or geofence errors
      if (result.message.includes('just clocked') || 
          result.message.includes('Outside geofence') ||
          result.message.includes('Wait 1 minute')) {
        return false;
      }
      
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
        return sendToServer(payload, retryCount + 1);
      }
      
      return false;
    }
  } catch (error) {
    if (retryCount < maxRetries && navigator.onLine) {
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
      return sendToServer(payload, retryCount + 1);
    }
    return false;
  }
}

// ===== INDEXEDDB (Silent backup) =====
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TimeClockDB', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
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
    
    await store.put({
      ...data,
      synced: false,
      savedAt: Date.now(),
      retries: 0
    });
  } catch (error) {
    console.error('IndexedDB save error:', error);
  }
}

async function markAsSynced(id) {
  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readwrite');
    const store = tx.objectStore('pending-actions');
    const record = await store.get(id);
    
    if (record) {
      record.synced = true;
      record.syncedAt = Date.now();
      await store.put(record);
    }
  } catch (error) {
    console.error('Error marking synced:', error);
  }
}

// ===== SILENT SYNC (No UI feedback!) =====
async function syncPendingActions() {
  if (syncInProgress || !navigator.onLine) return;

  syncInProgress = true;

  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readonly');
    const store = tx.objectStore('pending-actions');
    
    const allRecords = await new Promise((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
    
    const pending = allRecords.filter(r => !r.synced && (!r.retries || r.retries < 10));

    if (pending.length === 0) {
      syncInProgress = false;
      return;
    }

    for (const action of pending) {
      const success = await sendToServer(action);
      
      if (success) {
        await markAsSynced(action.id);
      } else {
        const db2 = await openDB();
        const tx2 = db2.transaction('pending-actions', 'readwrite');
        const store2 = tx2.objectStore('pending-actions');
        const record = await store2.get(action.id);
        if (record) {
          record.retries = (record.retries || 0) + 1;
          await store2.put(record);
        }
      }
    }
    
  } catch (error) {
    console.error('Silent sync error:', error);
  } finally {
    syncInProgress = false;
  }
}

// ===== CLIENT INFO =====
function showClientInfo() {
  const cliSel = document.getElementById('client');
  const clientName = cliSel.value;
  if (!meta || !meta.clients || !clientName) return;
  
  const client = meta.clients.find(c => c.name === clientName);
  if (!client) return;

  document.getElementById('clientInfoTitle').textContent = '📍 ' + client.name;
  document.getElementById('clientInfoBody').innerHTML =
    `<strong>Address:</strong><br>${client.address}<br><br>` +
    `<strong>Notes:</strong><br>${client.notes || 'No notes'}`;

  document.getElementById('clientPopup').style.display = 'flex';
}

function closeClientInfo() {
  document.getElementById('clientPopup').style.display = 'none';
}

// ===== INSTALL PROMPT =====
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const prompt = document.getElementById('installPrompt');
  if (prompt) prompt.style.display = 'block';
});

function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((result) => {
      deferredPrompt = null;
      const prompt = document.getElementById('installPrompt');
      if (prompt) prompt.style.display = 'none';
    });
  }
}

function dismissInstall() {
  const prompt = document.getElementById('installPrompt');
  if (prompt) prompt.style.display = 'none';
}

// ===== INITIALIZE =====
document.addEventListener('DOMContentLoaded', () => {
  updateOnlineStatus();
  getLoc();
  loadMeta();
  
  // Start syncing after 2 seconds
  setTimeout(syncPendingActions, 2000);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'SYNC_NOW') {
      syncPendingActions();
    }
  });
}

window.addEventListener('beforeunload', () => {
  if (navigator.onLine) {
    syncPendingActions();
  }
});
