// YOUR GOOGLE APPS SCRIPT URL
const API_URL = 'https://script.google.com/macros/s/AKfycbx_jPi8sLBTdLyVEbIW_dzc86nLSlZHQ4ejqu5CTCaXCKC_R799xjvG2xo9eirBiQd5/exec';

let lat = null, lng = null, meta = null;
let deferredPrompt = null;

// Update clock display
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

// Set status message
function setStatus(msg, cls) {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = msg;
    el.className = cls || '';
  }
}

// Check online/offline status
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

// Load employees and clients
async function loadMeta() {
  try {
    // Try cache first
    const cached = localStorage.getItem('meta-cache');
    if (cached) {
      meta = JSON.parse(cached);
      populateDropdowns();
    }

    // Fetch fresh if online
    if (navigator.onLine) {
      const response = await fetch(`${API_URL}?action=getMeta`);
      const data = await response.json();
      meta = data;
      localStorage.setItem('meta-cache', JSON.stringify(data));
      populateDropdowns();
      setStatus('Ready to clock in!', 'ok');
    }
  } catch (error) {
    console.error('Error loading meta:', error);
    if (meta) {
      populateDropdowns();
      setStatus('Using cached data (offline)', 'warn');
    } else {
      setStatus('Error loading data. Please refresh.', 'err');
    }
  }
}

function populateDropdowns() {
  const empSel = document.getElementById('employee');
  const cliSel = document.getElementById('client');
  
  if (!empSel || !cliSel) return;

  empSel.innerHTML = '';
  cliSel.innerHTML = '';

  (meta.employees || []).forEach(e => {
    const opt = document.createElement('option');
    let badge = '⚪';
    if (e.cprStatus === 'valid') badge = '🟢';
    if (e.cprStatus === 'warning') badge = '🟡';
    if (e.cprStatus === 'expired') badge = '🔴';
    
    opt.textContent = `${badge} ${e.name}`;
    opt.value = e.name;
    opt.dataset.role = e.role || '';
    empSel.appendChild(opt);
  });

  (meta.clients || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    cliSel.appendChild(opt);
  });
}

// Get GPS location
function getLoc() {
  if (!navigator.geolocation) {
    setStatus('GPS unavailable on this device.', 'err');
    return;
  }
  
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      setStatus(`GPS OK (${lat.toFixed(5)}, ${lng.toFixed(5)})`, 'ok');
    },
    () => {
      setStatus('Please enable GPS to clock in.', 'err');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// ✅ UPDATED: Submit clock using GET instead of POST (bypasses CORS!)
async function submitClock(action) {
  const empSel = document.getElementById('employee');
  const cliSel = document.getElementById('client');
  const employeeName = empSel.value;
  const clientName = cliSel.value;

  if (!employeeName || !clientName) {
    setStatus('Please select both employee and client.', 'err');
    return;
  }

  const role = document.getElementById('role').value ||
    (empSel.options[empSel.selectedIndex]?.dataset.role || '');
  
  const note = document.getElementById('note').value;
  const mileageVal = document.getElementById('mileage').value;
  const mileage = (action === 'Clock Out' && mileageVal !== '') ? 
    parseFloat(mileageVal) : null;

  const payload = {
    employeeName,
    role,
    clientName,
    action,
    lat,
    lng,
    note,
    mileage,
    timestamp: new Date().toISOString()
  };

  // Save to IndexedDB for offline
  await saveToIndexedDB(payload);

  // Try to send if online
  if (navigator.onLine) {
    setStatus('Sending...', 'warn');
    const success = await sendToServer(payload);
    if (success) {
      setStatus(`${action} successful!`, 'ok');
      if (action === 'Clock Out') {
        document.getElementById('mileage').value = '';
        document.getElementById('note').value = '';
      }
    } else {
      setStatus(`${action} saved offline - will sync later`, 'warn');
    }
  } else {
    setStatus(`${action} saved offline - will sync when online`, 'warn');
  }
}

// ✅ UPDATED: Send using GET with URL parameters instead of POST
async function sendToServer(payload) {
  try {
    // Build URL with parameters (GET request - no CORS issues!)
    const params = new URLSearchParams({
      action: 'clock',
      employeeName: payload.employeeName,
      role: payload.role || '',
      clientName: payload.clientName,
      clockAction: payload.action,
      lat: payload.lat || '',
      lng: payload.lng || '',
      note: payload.note || '',
      mileage: payload.mileage || ''
    });

    const url = `${API_URL}?${params.toString()}`;
    
    const response = await fetch(url);
    
    if (response.ok) {
      const result = await response.json();
      console.log('Server response:', result);
      
      // Mark as synced in IndexedDB
      await markAsSynced(payload.timestamp);
      
      return result.ok;
    }
    return false;
  } catch (error) {
    console.error('Error sending to server:', error);
    return false;
  }
}

// IndexedDB operations
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TimeClockDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pending-actions')) {
        const store = db.createObjectStore('pending-actions', { keyPath: 'timestamp' });
        store.createIndex('synced', 'synced');
      }
    };
  });
}

async function saveToIndexedDB(data) {
  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readwrite');
    await tx.objectStore('pending-actions').add({
      ...data,
      synced: false
    });
    console.log('Saved to IndexedDB:', data);
  } catch (error) {
    console.error('IndexedDB error:', error);
  }
}

async function markAsSynced(timestamp) {
  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readwrite');
    const store = tx.objectStore('pending-actions');
    const record = await store.get(timestamp);
    if (record) {
      record.synced = true;
      await store.put(record);
      console.log('Marked as synced:', timestamp);
    }
  } catch (error) {
    console.error('Error marking as synced:', error);
  }
}

async function syncPendingActions() {
  if (!navigator.onLine) return;

  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readonly');
    const store = tx.objectStore('pending-actions');
    const index = store.index('synced');
    const pending = await index.getAll(false);

    console.log('Syncing pending actions:', pending.length);

    for (const action of pending) {
      const success = await sendToServer(action);
      if (success) {
        console.log('Synced:', action);
      }
    }
  } catch (error) {
    console.error('Sync error:', error);
  }
}

// Install prompt
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
        console.log('App installed!');
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  updateOnlineStatus();
  loadMeta();
  getLoc();
});

// Listen for service worker messages
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'SYNC_NOW') {
      syncPendingActions();
    }
  });
}
