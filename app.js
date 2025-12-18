// SUPER AGGRESSIVE SYNC - v1.9.0
// Manual sync button + 30-second polling + better feedback

const API_URL = 'https://script.google.com/macros/s/AKfycbyQ_Q7Wi7XQAOnYbxZWRjCM2MlBdU3x0mFhgzOZuqX8ApEFJimHEvlQY1SF6s6oEtqH/exec';

let lat = null, lng = null, meta = null;
let deferredPrompt = null;
let syncInProgress = false;
let lastSyncAttempt = 0;

// ===== SUPER AGGRESSIVE AUTO-SYNC (30 seconds!) =====
setInterval(() => {
  if (navigator.onLine && !syncInProgress) {
    console.log('⏰ Auto-sync check (30 sec)');
    syncPendingActions();
  }
}, 30 * 1000); // 30 seconds!

// Also sync when visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && navigator.onLine) {
    console.log('👁️ App visible - syncing');
    syncPendingActions();
  }
});

// Auto-refresh meta every 30 min
setInterval(() => {
  if (navigator.onLine) {
    console.log('🔄 Auto-refresh meta (30 min)');
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
  console.log('📶 Connection restored');
  updateOnlineStatus();
  setStatus('📶 Connection restored - syncing...', 'warn');
  syncPendingActions();
});

window.addEventListener('offline', () => {
  console.log('📴 Connection lost');
  updateOnlineStatus();
});

// ===== LOAD EMPLOYEES & CLIENTS =====
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
      
      console.log('✅ Employee/client data refreshed');
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
      option.dataset.email = emp.email;
      option.dataset.workEmail = emp.workEmail || '';
      option.dataset.role = emp.role || '';
      option.dataset.shortName = emp.name;
      empDropdown.appendChild(option);
    });
  }
}

// ===== GPS =====
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
      setStatus(`✅ GPS OK (${lat.toFixed(5)}, ${lng.toFixed(5)})`, 'ok');
    },
    (error) => {
      console.error('GPS error:', error);
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

// ===== CLOCK IN/OUT =====
async function submitClock(action) {
  const employeeName = document.getElementById('employee').value;
  const employeeEmail = document.getElementById('employeeEmail')?.value || '';
  const cliSel = document.getElementById('client');
  const clientName = cliSel.value;

  if (!employeeName) {
    setStatus('⚠️ Please set up your employee info first.', 'err');
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

  // Check for open session before clock-in
  if (action === 'Clock In' && navigator.onLine) {
    try {
      const openSession = await checkForOpenSession(employeeName);
      if (openSession) {
        const clockInTime = new Date(openSession.clockIn);
        const hoursAgo = Math.round((Date.now() - clockInTime.getTime()) / (1000 * 60 * 60));
        
        const userTime = prompt(
          `⚠️ You're still clocked in at ${openSession.client}!\n\n` +
          `Clock-in time: ${clockInTime.toLocaleString()}\n` +
          `(${hoursAgo} hours ago)\n\n` +
          `What time did you leave ${openSession.client}?\n` +
          `Enter time (e.g., "12:30 PM") or leave blank:`,
          clockInTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        );
        
        if (userTime === null) {
          setStatus('Clock-in cancelled.', 'warn');
          return;
        }
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
    mileage,
    timestamp: new Date().toISOString(),
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  };

  console.log('📝 Submitting:', payload);
  setStatus(`📤 ${action}ing...`, 'warn');

  // ALWAYS save to IndexedDB first
  await saveToIndexedDB(payload);

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
      setStatus(`⚠️ Saved offline - tap SYNC NOW when you have service!`, 'warn');
    }
  } else {
    setStatus(`📴 Saved offline - tap SYNC NOW when connected!`, 'warn');
  }
  
  await showSyncStatus();
}

// ===== CHECK FOR OPEN SESSION =====
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
    console.error('Error checking open session:', error);
    return null;
  }
}

// ===== SEND TO SERVER (10 retries!) =====
async function sendToServer(payload, retryCount = 0) {
  const maxRetries = 10; // Increased from 3!
  
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

    const url = `${API_URL}?${params.toString()}`;
    console.log(`📤 Attempt ${retryCount + 1}/${maxRetries}`);
    
    const response = await fetch(url, { 
      method: 'GET',
      cache: 'no-cache'
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const result = await response.json();
    console.log('📥 Response:', result);
    
    if (result.ok) {
      console.log('✅ Sent successfully!');
      return true;
    } else {
      console.log('❌ Rejected:', result.message);
      
      // Don't retry if it's a business logic error (duplicate, geofence)
      if (result.message.includes('just clocked') || 
          result.message.includes('Outside geofence') ||
          result.message.includes('Wait 1 minute')) {
        console.log('⚠️ Business logic error - not retrying');
        return false;
      }
      
      // Retry for other errors
      if (retryCount < maxRetries) {
        const delay = Math.min((retryCount + 1) * 2000, 10000); // Max 10 sec delay
        console.log(`🔄 Retry in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return sendToServer(payload, retryCount + 1);
      }
      
      return false;
    }
  } catch (error) {
    console.error('❌ Error:', error);
    
    if (retryCount < maxRetries && navigator.onLine) {
      const delay = Math.min((retryCount + 1) * 2000, 10000);
      console.log(`🔄 Retry in ${delay/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return sendToServer(payload, retryCount + 1);
    }
    
    return false;
  }
}

// ===== INDEXEDDB =====
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
    
    const existing = await store.get(data.id);
    if (existing) {
      console.log('⚠️ Duplicate ID - updating instead');
      await store.put({
        ...data,
        synced: false,
        savedAt: Date.now(),
        retries: 0
      });
    } else {
      await store.add({
        ...data,
        synced: false,
        savedAt: Date.now(),
        retries: 0
      });
    }
    
    console.log('💾 Saved to IndexedDB:', data.id);
    await showSyncStatus();
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
      console.log('✅ Marked as synced:', id);
      await showSyncStatus();
    }
  } catch (error) {
    console.error('Error marking synced:', error);
  }
}

// ===== MANUAL SYNC FUNCTION =====
async function manualSync() {
  const btn = document.getElementById('manualSyncBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Syncing...';
  }
  
  setStatus('🔄 Starting manual sync...', 'warn');
  
  await syncPendingActions();
  
  if (btn) {
    btn.disabled = false;
    btn.textContent = '🔄 SYNC NOW';
  }
}

// ===== AGGRESSIVE SYNC =====
async function syncPendingActions() {
  if (syncInProgress) {
    console.log('⏭️ Sync in progress - skipping');
    return;
  }
  
  if (!navigator.onLine) {
    console.log('📴 Offline - skipping sync');
    setStatus('📴 No internet connection', 'warn');
    return;
  }

  // Don't spam sync attempts
  const timeSinceLastSync = Date.now() - lastSyncAttempt;
  if (timeSinceLastSync < 5000) {
    console.log('⏭️ Too soon since last sync - waiting');
    return;
  }

  syncInProgress = true;
  lastSyncAttempt = Date.now();
  console.log('🔄 Starting sync...');

  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readonly');
    const store = tx.objectStore('pending-actions');
    
    const allRecords = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    
    const pending = Array.isArray(allRecords) ? allRecords.filter(r => !r.synced) : [];

    console.log(`📦 Found ${pending.length} pending items`);

    if (pending.length === 0) {
      syncInProgress = false;
      return;
    }

    // Show which items are pending
    pending.forEach((item, idx) => {
      console.log(`  ${idx + 1}. ${item.action} at ${item.clientName} (${item.retries || 0} retries)`);
    });

    let successCount = 0;
    let failCount = 0;

    for (const action of pending) {
      // Skip if too many retries
      if (action.retries && action.retries > 10) {
        console.log(`⚠️ Skipping ${action.id} - too many retries (${action.retries})`);
        failCount++;
        continue;
      }

      const success = await sendToServer(action);
      
      if (success) {
        await markAsSynced(action.id);
        successCount++;
      } else {
        // Increment retry count
        const db2 = await openDB();
        const tx2 = db2.transaction('pending-actions', 'readwrite');
        const store2 = tx2.objectStore('pending-actions');
        const record = await store2.get(action.id);
        if (record) {
          record.retries = (record.retries || 0) + 1;
          await store2.put(record);
        }
        failCount++;
      }
    }

    console.log(`✅ Sync complete: ${successCount} success, ${failCount} failed`);
    
    if (successCount > 0) {
      setStatus(`✅ Synced ${successCount} item(s)! ${failCount > 0 ? `(${failCount} still pending)` : ''}`, 'ok');
    } else if (failCount > 0) {
      setStatus(`⚠️ ${failCount} item(s) failed to sync - tap SYNC NOW to retry`, 'warn');
    }
    
    await showSyncStatus();
    
  } catch (error) {
    console.error('❌ Sync error:', error);
    setStatus('❌ Sync error - tap SYNC NOW to retry', 'err');
  } finally {
    syncInProgress = false;
  }
}

// ===== SHOW SYNC STATUS =====
async function showSyncStatus() {
  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readonly');
    const store = tx.objectStore('pending-actions');
    
    const allRecords = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    
    const pending = Array.isArray(allRecords) ? allRecords.filter(r => !r.synced) : [];
    
    const badge = document.getElementById('syncBadge');
    const manualBtn = document.getElementById('manualSyncBtn');
    
    if (pending.length > 0) {
      if (badge) {
        badge.textContent = `📤 ${pending.length} pending`;
        badge.style.display = 'block';
      }
      if (manualBtn) {
        manualBtn.style.display = 'block';
      }
      
      // Show persistent warning if items are old
      const oldestItem = pending[0];
      const age = Date.now() - (oldestItem.savedAt || Date.now());
      if (age > 5 * 60 * 1000) { // Older than 5 minutes
        setStatus(`⚠️ ${pending.length} clock-in(s) waiting to sync! Tap SYNC NOW!`, 'warn');
      }
    } else {
      if (badge) badge.style.display = 'none';
      if (manualBtn) manualBtn.style.display = 'none';
    }
  } catch (error) {
    console.error('Error showing sync status:', error);
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
      if (result.outcome === 'accepted') {
        console.log('✅ Installed!');
      }
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
  console.log('🚀 App initializing...');
  updateOnlineStatus();
  getLoc();
  loadMeta();
  
  setTimeout(syncPendingActions, 2000);
  setTimeout(showSyncStatus, 3000);
  
  // Check sync status frequently
  setInterval(showSyncStatus, 10000); // Every 10 seconds
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
