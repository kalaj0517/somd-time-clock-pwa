// BULLETPROOF APP.JS - PRODUCTION VERSION v1.4.0
// Fixes: offline sync, duplicates, auto-refresh, aggressive retry

const API_URL = 'https://script.google.com/macros/s/AKfycbx_jPi8sLBTdLyVEbIW_dzc86nLSlZHQ4ejqu5CTCaXCKC_R799xjvG2xo9eirBiQd5/exec';

let lat = null, lng = null, meta = null;
let deferredPrompt = null;
let currentEmployee = null;
let syncInProgress = false;

// ===== AUTO-REFRESH EVERY 30 MINUTES =====
setInterval(() => {
  console.log('🔄 Auto-refresh triggered (30 min)');
  if (navigator.onLine) {
    loadMeta(); // Refresh employee/client data
    syncPendingActions(); // Try to sync any pending items
  }
}, 30 * 60 * 1000); // 30 minutes

// Also refresh when app becomes visible again
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && navigator.onLine) {
    console.log('🔄 App visible again - refreshing data');
    loadMeta();
    syncPendingActions();
  }
});

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
  
  // Try to sync when coming online
  if (navigator.onLine) {
    setTimeout(syncPendingActions, 1000); // Wait 1 sec for connection to stabilize
  }
}

window.addEventListener('online', () => {
  console.log('📶 Connection restored');
  updateOnlineStatus();
  setStatus('📶 Connection restored - syncing data...', 'warn');
  syncPendingActions();
});

window.addEventListener('offline', () => {
  console.log('📴 Connection lost');
  updateOnlineStatus();
});

// ===== LOAD EMPLOYEES & CLIENTS =====
async function loadMeta() {
  try {
    // Try cache first for instant display
    const cached = localStorage.getItem('meta-cache');
    if (cached) {
      meta = JSON.parse(cached);
      populateDropdowns();
    }

    // Fetch fresh if online
    if (navigator.onLine) {
      const response = await fetch(`${API_URL}?action=getMeta&t=${Date.now()}`); // Cache buster
      if (!response.ok) throw new Error('Failed to fetch meta');
      
      const data = await response.json();
      meta = data;
      localStorage.setItem('meta-cache', JSON.stringify(data));
      localStorage.setItem('meta-cache-time', Date.now().toString());
      populateDropdowns();
      
      console.log('✅ Employee/client data refreshed');
    }
  } catch (error) {
    console.error('Error loading meta:', error);
    if (meta) {
      populateDropdowns();
      console.log('⚠️ Using cached data');
    } else {
      setStatus('Error loading data. Please check internet and refresh.', 'err');
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
}

// ===== GPS LOCATION =====
function getLoc() {
  if (!navigator.geolocation) {
    setStatus('GPS unavailable on this device.', 'err');
    return;
  }
  
  setStatus('📍 Getting your location...', 'warn');
  
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      setStatus(`✅ GPS OK (${lat.toFixed(5)}, ${lng.toFixed(5)})`, 'ok');
      console.log('📍 GPS acquired:', lat, lng);
    },
    (error) => {
      console.error('GPS error:', error);
      setStatus('⚠️ GPS unavailable. Enable location and refresh.', 'err');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// ===== DUPLICATE PREVENTION =====
const recentClockIns = new Map(); // Track recent clock-ins

function isDuplicate(employeeName, clientName, action) {
  const key = `${employeeName}|${clientName}|${action}`;
  const lastTime = recentClockIns.get(key);
  
  if (lastTime) {
    const timeSince = Date.now() - lastTime;
    if (timeSince < 10000) { // Within 10 seconds
      console.log('⚠️ Duplicate detected - ignoring (within 10 sec)');
      return true;
    }
  }
  
  recentClockIns.set(key, Date.now());
  
  // Clean up old entries (older than 1 minute)
  setTimeout(() => {
    recentClockIns.delete(key);
  }, 60000);
  
  return false;
}

// ===== CLOCK IN/OUT =====
async function submitClock(action) {
  const employeeName = document.getElementById('employee').value;
  const cliSel = document.getElementById('client');
  const clientName = cliSel.value;

  if (!employeeName) {
    setStatus('⚠️ Please set up your email first.', 'err');
    return;
  }

  if (!clientName) {
    setStatus('⚠️ Please select a client.', 'err');
    return;
  }

  // DUPLICATE PREVENTION
  if (isDuplicate(employeeName, clientName, action)) {
    setStatus(`⚠️ You just ${action.toLowerCase()}ed! Please wait 10 seconds before trying again.`, 'warn');
    return;
  }

  const role = document.getElementById('role').value || currentEmployee?.role || '';
  const note = document.getElementById('note').value;
  const mileageVal = document.getElementById('mileage').value;
  const mileage = (action === 'Clock Out' && mileageVal !== '') ? 
    parseFloat(mileageVal) : null;

  const payload = {
    employeeName,
    employeeEmail: localStorage.getItem('userEmail'),
    role,
    clientName,
    action,
    lat,
    lng,
    note,
    mileage,
    timestamp: new Date().toISOString(),
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}` // Unique ID
  };

  console.log('📝 Submitting clock action:', payload);
  setStatus(`📤 ${action}ing...`, 'warn');

  // ALWAYS save to IndexedDB first (even if online)
  await saveToIndexedDB(payload);

  // Try to send immediately if online
  if (navigator.onLine) {
    const success = await sendToServer(payload);
    
    if (success) {
      setStatus(`✅ ${action} successful!`, 'ok');
      await markAsSynced(payload.id);
      
      // Clear form after successful clock out
      if (action === 'Clock Out') {
        document.getElementById('mileage').value = '';
        document.getElementById('note').value = '';
      }
      
      // Show sync count
      showSyncStatus();
    } else {
      setStatus(`⚠️ ${action} saved offline - will sync automatically`, 'warn');
      // Try again in 5 seconds
      setTimeout(() => syncPendingActions(), 5000);
    }
  } else {
    setStatus(`📴 ${action} saved offline - will sync when connected`, 'warn');
  }
}

// ===== SEND TO SERVER WITH RETRY =====
async function sendToServer(payload, retryCount = 0) {
  const maxRetries = 3;
  
  try {
    const params = new URLSearchParams({
      action: 'clock',
      employeeName: payload.employeeName,
      role: payload.role || '',
      clientName: payload.clientName,
      clockAction: payload.action,
      lat: payload.lat || '',
      lng: payload.lng || '',
      note: payload.note || '',
      mileage: payload.mileage || '',
      t: Date.now() // Cache buster
    });

    const url = `${API_URL}?${params.toString()}`;
    console.log('📤 Sending to server (attempt ' + (retryCount + 1) + ')');
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('📥 Server response:', result);
    
    if (result.ok) {
      console.log('✅ Successfully sent to server');
      return true;
    } else {
      console.log('❌ Server rejected:', result.message);
      
      // Retry if server error
      if (retryCount < maxRetries) {
        console.log(`🔄 Retrying in ${(retryCount + 1) * 2} seconds...`);
        await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
        return sendToServer(payload, retryCount + 1);
      }
      
      return false;
    }
  } catch (error) {
    console.error('❌ Error sending to server:', error);
    
    // Retry on network errors
    if (retryCount < maxRetries && navigator.onLine) {
      console.log(`🔄 Retrying in ${(retryCount + 1) * 2} seconds...`);
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
      return sendToServer(payload, retryCount + 1);
    }
    
    return false;
  }
}

// ===== INDEXEDDB - RELIABLE OFFLINE STORAGE =====
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TimeClockDB', 2);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create or upgrade pending-actions store
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
    
    // Check for duplicate IDs
    const existing = await store.get(data.id);
    if (existing) {
      console.log('⚠️ Duplicate ID detected - skipping IndexedDB save');
      return;
    }
    
    await store.add({
      ...data,
      synced: false,
      savedAt: Date.now(),
      retries: 0
    });
    
    console.log('💾 Saved to IndexedDB:', data.id);
    showSyncStatus();
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
      showSyncStatus();
    }
  } catch (error) {
    console.error('Error marking as synced:', error);
  }
}

// ===== AGGRESSIVE SYNC SYSTEM =====
async function syncPendingActions() {
  if (syncInProgress) {
    console.log('⏭️ Sync already in progress - skipping');
    return;
  }
  
  if (!navigator.onLine) {
    console.log('📴 Offline - skipping sync');
    return;
  }

  syncInProgress = true;
  console.log('🔄 Starting sync...');

  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readonly');
    const store = tx.objectStore('pending-actions');
    const index = store.index('synced');
    const pending = await index.getAll(false); // Get all unsynced items

    console.log(`📦 Found ${pending.length} pending items to sync`);

    if (pending.length === 0) {
      syncInProgress = false;
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const action of pending) {
      // Skip if too many retries
      if (action.retries && action.retries > 5) {
        console.log(`⚠️ Skipping ${action.id} - too many retries`);
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
      setStatus(`✅ Synced ${successCount} clock-in(s) successfully!`, 'ok');
    }
    
    showSyncStatus();
    
  } catch (error) {
    console.error('❌ Sync error:', error);
  } finally {
    syncInProgress = false;
  }
}

// Try to sync every 2 minutes when online
setInterval(() => {
  if (navigator.onLine && !syncInProgress) {
    console.log('⏰ Periodic sync check (2 min)');
    syncPendingActions();
  }
}, 2 * 60 * 1000); // 2 minutes

// ===== SHOW SYNC STATUS =====
async function showSyncStatus() {
  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readonly');
    const store = tx.objectStore('pending-actions');
    const index = store.index('synced');
    const pending = await index.getAll(false);
    
    const badge = document.getElementById('syncBadge');
    if (badge) {
      if (pending.length > 0) {
        badge.textContent = `📤 ${pending.length} pending`;
        badge.style.display = 'block';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Error showing sync status:', error);
  }
}

// ===== EMPLOYEE SETUP =====
function checkUserSetup() {
  const savedEmail = localStorage.getItem('userEmail');
  
  if (!savedEmail) {
    document.getElementById('emailSetup').style.display = 'block';
    document.getElementById('mainApp').style.display = 'none';
  } else {
    document.getElementById('emailSetup').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    loadUserEmployee(savedEmail);
  }
}

async function saveUserEmail() {
  const input = document.getElementById('emailInput');
  const email = input.value.trim().toLowerCase();
  
  if (!email || !email.includes('@')) {
    alert('Please enter a valid email address');
    return;
  }
  
  localStorage.setItem('userEmail', email);
  
  document.getElementById('emailSetup').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  
  loadUserEmployee(email);
}

async function loadUserEmployee(email) {
  try {
    setStatus('🔍 Loading your employee info...', 'warn');
    
    // Wait for meta to load if not loaded yet
    let attempts = 0;
    while (!meta && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }
    
    if (!meta) {
      await loadMeta();
    }
    
    const employee = meta.employees.find(e => 
      e.email.toLowerCase() === email.toLowerCase()
    );
    
    if (employee) {
      currentEmployee = employee;
      
      document.getElementById('employeeName').textContent = '👤 ' + employee.fullName;
      document.getElementById('employeeRole').textContent = employee.role || 'Caregiver';
      document.getElementById('employee').value = employee.name;
      document.getElementById('role').value = employee.role || '';
      
      setStatus(`👋 Welcome back, ${employee.name.split(' ')[0]}!`, 'ok');
      
      // Show sync status
      showSyncStatus();
    } else {
      setStatus('⚠️ Email not found. Contact your manager.', 'err');
      document.getElementById('employeeName').textContent = '⚠️ Email Not Found';
      document.getElementById('employeeRole').textContent = 'Contact manager';
    }
  } catch (error) {
    console.error('Error loading employee:', error);
    setStatus('Error loading your info. Please refresh.', 'err');
  }
}

function changeEmployee() {
  if (confirm('Switch to a different employee? This will clear your saved email and any pending offline clock-ins.')) {
    localStorage.removeItem('userEmail');
    currentEmployee = null;
    
    // Optionally clear pending actions for this employee
    // (You might want to keep them - your choice!)
    
    document.getElementById('emailSetup').style.display = 'block';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('emailInput').value = '';
  }
}

// ===== CLIENT INFO POPUP =====
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
  if (prompt) {
    prompt.style.display = 'block';
  }
});

function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((result) => {
      if (result.outcome === 'accepted') {
        console.log('✅ App installed!');
      }
      deferredPrompt = null;
      const prompt = document.getElementById('installPrompt');
      if (prompt) {
        prompt.style.display = 'none';
      }
    });
  }
}

function dismissInstall() {
  const prompt = document.getElementById('installPrompt');
  if (prompt) {
    prompt.style.display = 'none';
  }
}

// ===== INITIALIZE =====
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 App initializing...');
  updateOnlineStatus();
  checkUserSetup();
  getLoc();
  loadMeta();
  
  // Initial sync check
  setTimeout(syncPendingActions, 2000);
  
  // Show sync status
  setTimeout(showSyncStatus, 3000);
});

// Listen for service worker messages
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'SYNC_NOW') {
      console.log('📨 Service Worker requested sync');
      syncPendingActions();
    }
  });
}

// Sync before page unload (if online)
window.addEventListener('beforeunload', () => {
  if (navigator.onLine) {
    syncPendingActions();
  }
});
