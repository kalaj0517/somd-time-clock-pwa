// YOUR GOOGLE APPS SCRIPT URL - YOU'LL UPDATE THIS!
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
    // Try to get from cache first
    const cached = localStorage.getItem('meta-cache');
    if (cached) {
      meta = JSON.parse(cached);
      populateDropdowns();
    }

    // Then fetch fresh data if online
    if (navigator.onLine) {
      const response = await fetch(`${API_URL}?action=getMeta`);
      const data = await response.json();
      meta = data;
      localStorage.setItem('meta-cache', JSON.stringify(data));
      populateDropdowns();
    }
  } catch (error) {
    console.error('Error loading meta:', error);
    if (meta) {
      populateDropdowns();
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

// Submit clock in/out
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

  // Save offline first
  await saveToIndexedDB(payload);

  // Try to send if online
  if (navigator.onLine) {
    const success = await sendToServer(payload);
    if (success) {
      setStatus(`${action} successful!`, 'ok');
      if (action === 'Clock Out') {
        document.getElementById('mileage').value = '';
      }
    } else {
      setStatus(`${action} saved offline - will sync later`, 'warn');
    }
  } else {
    setStatus(`${action} saved offline - will sync later`, 'warn');
  }
}

// Send to Google Apps Script
async function sendToServer(payload) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const result = await response.json();
      return result.ok;
    }
    return false;
  } catch (error) {
    console.error('Error sending to server:', error);
    return false;
  }
}

// IndexedDB operations
async function saveToIndexedDB(data) {
  const db = await openDB();
  const tx = db.transaction('pending-actions', 'readwrite');
  await tx.objectStore('pending-actions').add({
    ...data,
    synced: false,
    id: Date.now()
  });
}

async function syncPendingActions() {
  if (!navigator.onLine) return;

  const db = await openDB();
  const tx = db.transaction('pending-actions', 'readwrite');
  const store = tx.objectStore('pending-actions');
  const pending = await store.getAll();

  for (const action of pending) {
    if (!action.synced) {
      const success = await sendToServer(action);
      if (success) {
        action.synced = true;
        await store.put(action);
      }
    }
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TimeClockDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pending-actions')) {
        db.createObjectStore('pending-actions', { keyPath: 'id' });
      }
    };
  });
}

// Install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('installPrompt').style.display = 'block';
});

function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((result) => {
      if (result.outcome === 'accepted') {
        console.log('App installed');
      }
      deferredPrompt = null;
      document.getElementById('installPrompt').style.display = 'none';
    });
  }
}

function dismissInstall() {
  document.getElementById('installPrompt').style.display = 'none';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  updateOnlineStatus();
  loadMeta();
  getLoc();
});

// Listen for sync messages
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'SYNC_NOW') {
      syncPendingActions();
    }
  });
}
