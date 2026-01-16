import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getDatabase, ref, set, push, onValue, remove, update, get } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

/* ================= FIREBASE CONFIG ================= */
const firebaseConfig = {
  apiKey: "AIzaSyALS4Sy7J5NVXG9JCmdk0ZPMaHxamJvA_Q",
  databaseURL: "https://medical-inventory-ef978-default-rtdb.firebaseio.com/",
  projectId: "medical-inventory-ef978",
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

/* ================= GLOBAL STATE ================= */
let allLogs = [];
let lowStockItems = [];
let expiringItems = [];
let currentLogView = "requests";
let currentStockFilter = 'all';
let isPPEMode = false;
let pendingItemData = null;

/* ================= ENHANCED UI FEEDBACK ================= */
function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()">×</button>
    `;
    
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideIn 0.3s ease;
        max-width: 300px;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = "slideOut 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Add toast styles to document
const toastStyles = document.createElement("style");
toastStyles.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    .toast button {
        background: transparent;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
`;
document.head.appendChild(toastStyles);

/* ================= LOADING STATE ================= */
function showLoading(show = true) {
    let loader = document.getElementById("globalLoader");
    if (!loader && show) {
        loader = document.createElement("div");
        loader.id = "globalLoader";
        loader.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255,255,255,0.8);
            backdrop-filter: blur(5px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        `;
        loader.innerHTML = `
            <div style="
                width: 50px;
                height: 50px;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #3b82f6;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
        `;
        document.body.appendChild(loader);
    } else if (loader && !show) {
        loader.remove();
    }
}

// Add spin animation
const spinStyles = document.createElement("style");
spinStyles.textContent = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;
document.head.appendChild(spinStyles);

/* ================= INPUT VALIDATION ================= */
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validateEmployeeData(name, id) {
    if (!name.trim() || name.length < 2) {
        return "Name must be at least 2 characters long";
    }
    if (!id.trim() || id.length < 3) {
        return "Employee ID must be at least 3 characters long";
    }
    return null;
}

/* ================= INPUT SANITIZATION ================= */
function sanitizeInput(text, maxLength = 500) {
  if (!text) return '';
  
  return text
    .toString()
    .replace(/[<>"'&]/g, '')
    .trim()
    .substring(0, maxLength);
}

/* ================= EXPIRY MANAGEMENT FUNCTIONS ================= */
function getExpiryStatus(expiryDate) {
    if (!expiryDate) return { status: 'none', days: null };
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate);
    const diffTime = expiry - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
        return { status: 'expired', days: Math.abs(diffDays) };
    } else if (diffDays <= 30) {
        return { status: 'warning', days: diffDays };
    } else {
        return { status: 'valid', days: diffDays };
    }
}

function formatExpiryDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

function checkExpiringItems(inventoryData) {
    expiringItems = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    Object.keys(inventoryData).forEach(key => {
        const item = inventoryData[key];
        if (item.expiryDate) {
            const expiryDate = new Date(item.expiryDate);
            const diffTime = expiryDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays <= 60) {
                expiringItems.push({
                    id: key,
                    name: item.name,
                    quantity: item.quantity,
                    expiryDate: item.expiryDate,
                    daysLeft: diffDays,
                    isExpired: diffDays < 0
                });
            }
        }
    });
    
    expiringItems.sort((a, b) => a.daysLeft - b.daysLeft);
    
    updateExpiryAlertBadge();
}

function updateExpiryAlertBadge() {
    const expiryAlert = document.getElementById('expiryAlert');
    if (expiryAlert && auth.currentUser) {
        const criticalCount = expiringItems.filter(item => item.daysLeft < 0 || item.daysLeft <= 7).length;
        const totalCount = expiringItems.length;
        
        if (totalCount > 0) {
            expiryAlert.style.display = 'flex';
            expiryAlert.classList.toggle('critical', criticalCount > 0);
            
            let badge = expiryAlert.querySelector('.expiry-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'expiry-badge';
                badge.style.cssText = `
                    position: absolute;
                    top: -5px;
                    right: -5px;
                    background: ${criticalCount > 0 ? '#ef4444' : '#f59e0b'};
                    color: white;
                    border-radius: 50%;
                    width: 18px;
                    height: 18px;
                    font-size: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                `;
                expiryAlert.style.position = 'relative';
                expiryAlert.appendChild(badge);
            }
            badge.textContent = criticalCount > 0 ? criticalCount : totalCount;
        } else {
            expiryAlert.style.display = 'none';
            const badge = expiryAlert.querySelector('.expiry-badge');
            if (badge) badge.remove();
        }
    }
}

function showExpiryAlert(filterType = 'expired') {
    const modal = document.getElementById('expiryAlertModal');
    const list = document.getElementById('expiryAlertList');
    
    if (!modal || !list) return;
    
    let filteredItems = expiringItems;
    if (filterType === 'expired') {
        filteredItems = expiringItems.filter(item => item.daysLeft < 0);
    } else if (filterType === 'expiring') {
        filteredItems = expiringItems.filter(item => item.daysLeft >= 0 && item.daysLeft <= 30);
    }
    
    list.innerHTML = '';
    
    if (filteredItems.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                <svg width="48" height="48" fill="currentColor" viewBox="0 0 24 24" style="opacity: 0.5;">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                <h4 style="margin: 16px 0 8px 0;">No ${filterType} items found</h4>
                <p>All items are within acceptable expiry range</p>
            </div>
        `;
    } else {
        filteredItems.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="expiry-item-info">
                    <span class="expiry-item-name">${item.name.replace(/\s*\(PPE\)\s*$/i, '')}</span>
                    <span class="expiry-item-date">
                        📅 ${formatExpiryDate(item.expiryDate)}
                        <span class="expiry-status ${item.daysLeft < 0 ? 'expiry-expired' : 'expiry-warning'}">
                            ${item.daysLeft < 0 ? `Expired ${Math.abs(item.daysLeft)} days ago` : 
                              `${item.daysLeft} days left`}
                        </span>
                    </span>
                </div>
                <span class="expiry-item-qty">${item.quantity} units</span>
            `;
            list.appendChild(li);
        });
    }
    
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function updateInventoryExpiryDisplay() {
    const rows = document.querySelectorAll('#inventoryBody tr');
    
    rows.forEach(row => {
        const qtyCell = row.querySelector('.stock-level');
        let expiryCell = row.querySelector('.expiry-cell');
        
        if (!expiryCell) {
            expiryCell = document.createElement('td');
            expiryCell.className = 'expiry-cell';
            if (qtyCell) {
                row.insertBefore(expiryCell, qtyCell.nextSibling);
            }
        }
        
        const isMedkit = row.classList.contains('cat-medkit');
        const expiryDate = row.dataset.expiry || null;
        
        if (isMedkit && expiryDate) {
            const status = getExpiryStatus(expiryDate);
            expiryCell.innerHTML = `
                <div class="expiry-date ${status.status}">
                    ${formatExpiryDate(expiryDate)}
                    ${status.days !== null ? `<span class="expiry-status expiry-${status.status}">
                        ${status.status === 'expired' ? 'Expired' : 
                          status.status === 'warning' ? `${status.days}d left` : 
                          'Valid'}
                    </span>` : ''}
                </div>
            `;
        } else if (isMedkit) {
            expiryCell.innerHTML = '<div class="expiry-date">-</div>';
        } else {
            expiryCell.innerHTML = '<div class="expiry-date">N/A</div>';
        }
    });
}

function printExpiryReport() {
    const today = new Date().toLocaleDateString();
    const criticalItems = expiringItems.filter(item => item.daysLeft < 0 || item.daysLeft <= 7);
    const warningItems = expiringItems.filter(item => item.daysLeft > 7 && item.daysLeft <= 30);
    
    let printContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Medication Expiry Report - ${today}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h1 { color: #333; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                th { background-color: #f5f5f5; }
                .critical { background-color: #fee; }
                .warning { background-color: #ffd; }
                .summary { background-color: #f0f8ff; padding: 15px; border-radius: 5px; margin: 20px 0; }
            </style>
        </head>
        <body>
            <h1>Medication Expiry Report</h1>
            <p>Generated on: ${today}</p>
            
            <div class="summary">
                <h3>Summary</h3>
                <p><strong>Critical (Expired/≤7 days):</strong> ${criticalItems.length} items</p>
                <p><strong>Warning (8-30 days):</strong> ${warningItems.length} items</p>
                <p><strong>Total Expiring Items:</strong> ${expiringItems.length} items</p>
            </div>
            
            <h3>Expiring Items</h3>
            <table>
                <thead>
                    <tr>
                        <th>Item Name</th>
                        <th>Quantity</th>
                        <th>Expiry Date</th>
                        <th>Status</th>
                        <th>Days Remaining</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    expiringItems.forEach(item => {
        const status = item.daysLeft < 0 ? 'Expired' : 
                      item.daysLeft <= 7 ? 'Critical' : 'Warning';
        const rowClass = item.daysLeft < 0 ? 'critical' : 
                        item.daysLeft <= 7 ? 'critical' : 'warning';
        
        printContent += `
            <tr class="${rowClass}">
                <td>${item.name.replace(/\s*\(PPE\)\s*$/i, '')}</td>
                <td>${item.quantity}</td>
                <td>${formatExpiryDate(item.expiryDate)}</td>
                <td>${status}</td>
                <td>${item.daysLeft < 0 ? `Expired ${Math.abs(item.daysLeft)} days ago` : `${item.daysLeft} days`}</td>
            </tr>
        `;
    });
    
    printContent += `
                </tbody>
            </table>
            
            <div style="margin-top: 30px; font-size: 12px; color: #666;">
                <p><strong>Legend:</strong></p>
                <p>Critical: Expired or expiring within 7 days</p>
                <p>Warning: Expiring within 8-30 days</p>
            </div>
        </body>
        </html>
    `;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 500);
}

/* ================= AUTH & UI STATE ================= */
onAuthStateChanged(auth, user => {
  const isAdmin = !!user;
  document.body.classList.toggle("is-admin", isAdmin);
  
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.style.display = isAdmin ? "block" : "none";
  
  const loginTrigger = document.getElementById("loginTrigger");
  if (loginTrigger) loginTrigger.style.display = isAdmin ? "none" : "flex";
  
  const empTrigger = document.getElementById("employeeTrigger");
  if (empTrigger) empTrigger.style.display = isAdmin ? "flex" : "none";
  
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => {
    if (isAdmin) {
      if (el.style.display === 'none') {
        el.style.display = '';
      }
    }
  });
  
  const publicElements = document.querySelectorAll('.public-only');
  publicElements.forEach(el => {
    el.style.display = isAdmin ? 'none' : '';
  });
  
  const filterButtons = document.querySelectorAll('.filter-buttons');
  filterButtons.forEach(btn => {
    if (btn) btn.style.display = isAdmin ? 'flex' : 'none';
  });

  if (!isAdmin) {
    document.getElementById("adminEmail").value = "";
    document.getElementById("adminPass").value = "";
    document.getElementById("loginModal").style.display = "none";
  }

  if (isAdmin) {
    loadReports();
    loadEmployees();
    currentStockFilter = 'all';
    updateStockFilterButtons();
    applyStockFilter();
    showToast(`Welcome back, ${user.email.split('@')[0]}!`, "success");
  } else {
    currentStockFilter = isPPEMode ? 'ppe' : 'medkit';
    applyStockFilter();
  }
});

/* ================= ENHANCED MODAL CONTROLS ================= */
const setupModal = (triggerId, modalId, closeId, onCloseCallback = null, clearFieldsOnClose = false) => {
  const trigger = document.getElementById(triggerId);
  const modal = document.getElementById(modalId);
  const close = document.getElementById(closeId);
  
  if (trigger && modal) {
    trigger.onclick = () => {
      modal.style.display = "flex";
      document.body.classList.add("modal-open");
      modal.offsetHeight;
      modal.classList.add("modal-visible");
    };
  }
  
  if (close && modal) {
    close.onclick = () => { 
      closeModal(modal, clearFieldsOnClose, onCloseCallback);
    };
  }
  
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeModal(modal, clearFieldsOnClose, onCloseCallback);
      }
    };
  }
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal(modal, clearFieldsOnClose, onCloseCallback);
    }
  });
};

function closeModal(modal, clearFieldsOnClose, onCloseCallback) {
  modal.style.display = "none";
  document.body.classList.remove("modal-open");
  modal.classList.remove("modal-visible");
  
  if (clearFieldsOnClose) {
    document.getElementById("adminEmail").value = "";
    document.getElementById("adminPass").value = "";
  }
  
  if (onCloseCallback) onCloseCallback();
}

setupModal("loginTrigger", "loginModal", "closeModal", null, true);
setupModal("employeeTrigger", "employeeModal", "closeEmployeeModal", () => {
  resetEmployeeForm();
});
setupModal("lowStockAlert", "lowStockModal", "closeLowStockModal");
setupModal("expiryAlert", "expiryAlertModal", "closeExpiryAlertModal");

/* ================= ENHANCED INVENTORY SYNC ================= */
onValue(ref(db, "inventory"), snapshot => {
  const data = snapshot.val() || {};
  const tbody = document.getElementById("inventoryBody");
  const select = document.getElementById("reqItemSelect");
  const lowStockList = document.getElementById("lowStockList");
  
  tbody.innerHTML = "";
  lowStockList.innerHTML = "";
  select.innerHTML = '<option value="">Select Item...</option>';
  lowStockItems = [];
  expiringItems = [];
  
  Object.keys(data).forEach(key => {
    const item = data[key];
    const qty = parseInt(item.quantity) || 0;
    const isLow = qty <= 5;
    const isCritical = qty <= 2;
    const rawItemName = item.name || "";
    
    const displayName = rawItemName.replace(/\s*\(PPE\)\s*$/i, '').trim();
    const lowerName = rawItemName.toLowerCase();
    const isPPE = lowerName.includes('(ppe)') || 
                  ['mask', 'gloves', 'gown', 'shield', 'ppe', 'face shield', 'apron', 'coverall', 'safety', 'protective', 'hard hat', 'helmet'].some(w => 
                      lowerName.includes(w)
                  ) ||
                  (item.category && item.category === 'ppe');
    
    if (isLow) {
        lowStockItems.push({ name: rawItemName, quantity: qty, critical: isCritical });
        const li = document.createElement("li");
        li.style.cssText = `
            padding: 8px 0;
            border-bottom: 1px solid rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        li.innerHTML = `
            <span><strong>${displayName}</strong></span>
            <span style="color: ${isCritical ? '#ef4444' : '#f59e0b'}; font-weight: bold;">
                ${qty} left${isCritical ? ' ⚠️' : ''}
            </span>
        `;
        lowStockList.appendChild(li);
    }
    
    if (!isPPE && item.expiryDate) {
        const expiryDate = new Date(item.expiryDate);
        const today = new Date();
        const diffDays = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
        
        if (diffDays <= 60) {
            expiringItems.push({
                id: key,
                name: rawItemName,
                quantity: qty,
                expiryDate: item.expiryDate,
                daysLeft: diffDays,
                isExpired: diffDays < 0
            });
        }
    }
    
    const categoryClass = isPPE ? 'ppe' : 'medkit';
    const categoryIcon = isPPE ? '🛡️' : '💊';
    
    const tr = document.createElement("tr");
    tr.className = `cat-${categoryClass}`;
    tr.dataset.category = categoryClass;
    tr.dataset.quantity = qty;
    if (!isPPE && item.expiryDate) {
        tr.dataset.expiry = item.expiryDate;
    }
    
    tr.innerHTML = `
        <td>
            <span class="category-badge ${categoryClass}">${categoryIcon} ${isPPE ? 'PPE' : 'Medkit'}</span>
            ${displayName}
        </td>
        <td style="text-align:center">
            <div class="stock-level">
                <span class="stock-indicator ${isCritical ? 'low' : isLow ? 'low' : 'ok'}"></span>
                <span class="stock-qty">${qty}</span>
                ${isCritical ? '<span style="color:#ef4444; font-size:0.8rem; margin-left:4px;">(Critical)</span>' : 
                    isLow ? '<span style="color:#f59e0b; font-size:0.8rem; margin-left:4px;">(Low)</span>' : ''}
            </div>
        </td>
        <td class="expiry-cell"></td>
        <td class="admin-only" style="text-align:center">
            <div class="table-actions">
                <button class="btn-table btn-edit-table btn-edit" data-id="${key}" title="Edit Item" aria-label="Edit ${displayName}">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                    </svg>
                </button>
                <button class="btn-table btn-delete-table btn-delete" data-id="${key}" title="Delete Item" aria-label="Delete ${displayName}">
                    <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                </button>
            </div>
        </td>
    `;
    
    tbody.appendChild(tr);
    
    let optionText = `${displayName} (${qty} available)`;
    if (!isPPE && item.expiryDate) {
        const expiryDate = new Date(item.expiryDate);
        const status = getExpiryStatus(item.expiryDate);
        optionText += ` - Exp: ${expiryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        
        if (status.status === 'warning') {
            optionText += ` ⚠️`;
        } else if (status.status === 'expired') {
            optionText += ` ❌`;
        }
    }
    
    select.innerHTML += `<option value="${key}" class="cat-${categoryClass}" data-expiry="${item.expiryDate || ''}">${optionText}</option>`;
  });
  
  applyStockFilter();
  updateInventoryExpiryDisplay();
  checkExpiringItems(data);
  updateExpiryAlertBadge();
  
  const bell = document.getElementById("lowStockAlert");
  if(bell) {
    bell.style.display = (auth.currentUser && lowStockItems.length > 0) ? "flex" : "none";
    
    const criticalCount = lowStockItems.filter(item => item.critical).length;
    if (criticalCount > 0) {
      let badge = bell.querySelector('.notification-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'notification-badge';
        badge.style.cssText = `
          position: absolute;
          top: -5px;
          right: -5px;
          background: #ef4444;
          color: white;
          border-radius: 50%;
          width: 18px;
          height: 18px;
          font-size: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
        `;
        bell.style.position = 'relative';
        bell.appendChild(badge);
      }
      badge.textContent = criticalCount;
    } else {
      const badge = bell.querySelector('.notification-badge');
      if (badge) badge.remove();
    }
  }
});

/* ================= ADMIN STOCK FILTER ================= */
document.getElementById('filterAllBtn')?.addEventListener('click', () => {
  setStockFilter('all');
});

document.getElementById('filterMedkitBtn')?.addEventListener('click', () => {
  setStockFilter('medkit');
});

document.getElementById('filterPPEBtn')?.addEventListener('click', () => {
  setStockFilter('ppe');
});

function setStockFilter(filterType) {
  currentStockFilter = filterType;
  applyStockFilter();
  updateStockFilterButtons();
  applyLogFilter();
}

function applyStockFilter() {
  const rows = document.querySelectorAll('#inventoryBody tr');
  const options = document.querySelectorAll('#reqItemSelect option');
  
  rows.forEach(tr => {
    const isPPERow = tr.classList.contains('cat-ppe');
    const isMedkitRow = tr.classList.contains('cat-medkit');
    
    switch(currentStockFilter) {
      case 'all':
        tr.style.display = 'table-row';
        break;
      case 'medkit':
        tr.style.display = isMedkitRow ? 'table-row' : 'none';
        break;
      case 'ppe':
        tr.style.display = isPPERow ? 'table-row' : 'none';
        break;
    }
  });
  
  if (!auth.currentUser) {
    options.forEach(option => {
      if (option.value === "") return;
      
      const isPPEOption = option.classList.contains('cat-ppe');
      const isMedkitOption = option.classList.contains('cat-medkit');
      
      switch(currentStockFilter) {
        case 'medkit':
          option.style.display = isMedkitOption ? 'block' : 'none';
          break;
        case 'ppe':
          option.style.display = isPPEOption ? 'block' : 'none';
          break;
        default:
          option.style.display = 'block';
      }
    });
  }
}

function updateStockFilterButtons() {
  const allBtn = document.getElementById('filterAllBtn');
  const medkitBtn = document.getElementById('filterMedkitBtn');
  const ppeBtn = document.getElementById('filterPPEBtn');
  
  [allBtn, medkitBtn, ppeBtn].forEach(btn => {
    if (btn) {
      btn.classList.remove('active');
    }
  });
  
  let activeBtn;
  switch(currentStockFilter) {
    case 'all': activeBtn = allBtn; break;
    case 'medkit': activeBtn = medkitBtn; break;
    case 'ppe': activeBtn = ppeBtn; break;
  }
  
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
}

/* ================= SWITCH FORM TOGGLE ================= */
const toggleBtn = document.getElementById("formToggleBtn");
if (toggleBtn) {
  toggleBtn.onclick = () => {
    isPPEMode = !isPPEMode;
    
    if (isPPEMode) {
      document.body.classList.add("mode-ppe");
      document.body.classList.remove("mode-medkit");
      document.getElementById("formTitle").innerText = "🛡️ PPE Request Form";
      document.getElementById("toggleIcon").innerText = "💊";
      toggleBtn.title = "Switch to Medkit Request";
    } else {
      document.body.classList.add("mode-medkit");
      document.body.classList.remove("mode-ppe");
      document.getElementById("formTitle").innerText = "💊 Medkit Request Form";
      document.getElementById("toggleIcon").innerText = "🛡️";
      toggleBtn.title = "Switch to PPE Request";
    }
    
    if (!auth.currentUser) {
      currentStockFilter = isPPEMode ? 'ppe' : 'medkit';
      applyStockFilter();
    }
  };
}

/* ================= ENHANCED EMPLOYEE MANAGEMENT ================= */
function loadEmployees() {
  onValue(ref(db, "employees"), snapshot => {
    const data = snapshot.val() || {};
    const tbody = document.querySelector("#employeeTable tbody");
    if(!tbody) return;
    
    tbody.innerHTML = "";
    Object.keys(data).forEach(key => {
      const emp = data[key];
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${emp.name || ''}</td>
        <td>${emp.id || ''}</td>
        <td class="admin-only" style="white-space: nowrap;">
          <button class="btn-table btn-edit-table btn-edit-emp" 
                  data-key="${key}" 
                  data-name="${emp.name || ''}" 
                  data-id="${emp.id || ''}"
                  title="Edit Employee">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
          <button class="btn-table btn-delete-table btn-delete-emp" 
                  data-key="${key}"
                  title="Delete Employee">
            <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </td>
      `;
      tbody.appendChild(row);
    });
    
    attachEmployeeEventListeners();
  });
}

function attachEmployeeEventListeners() {
  document.querySelectorAll('.btn-edit-emp').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const name = btn.dataset.name;
      const id = btn.dataset.id;
      editEmployee(key, name, id);
    };
  });
  
  document.querySelectorAll('.btn-delete-emp').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      deleteEmployee(key);
    };
  });
}

function editEmployee(key, name, id) {
  document.getElementById("editEmpId").value = key;
  document.getElementById("empNameAdmin").value = name;
  document.getElementById("empIDAdmin").value = id;
  document.getElementById("saveEmpBtn").innerText = "Update Employee";
  document.getElementById("empNameAdmin").focus();
  
  document.getElementById("employeeModal").querySelector('.admin-form-grid').scrollIntoView({ 
    behavior: 'smooth', 
    block: 'start' 
  });
}

function deleteEmployee(key) {
  if(confirm("Are you sure you want to remove this employee?")) {
    showLoading(true);
    remove(ref(db, `employees/${key}`)).then(() => {
      showToast("Employee deleted successfully", "success");
    }).catch(error => {
      showToast("Error deleting employee: " + error.message, "error");
    }).finally(() => {
      showLoading(false);
    });
  }
}

function resetEmployeeForm() {
  document.getElementById("editEmpId").value = "";
  document.getElementById("empNameAdmin").value = "";
  document.getElementById("empIDAdmin").value = "";
  document.getElementById("saveEmpBtn").innerText = "Add / Update";
}

document.getElementById("saveEmpBtn").onclick = async () => {
  const key = document.getElementById("editEmpId").value;
  const name = document.getElementById("empNameAdmin").value.trim();
  const id = document.getElementById("empIDAdmin").value.trim();
  
  const validationError = validateEmployeeData(name, id);
  if (validationError) {
    showToast(validationError, "error");
    return;
  }
  
  try {
    showLoading(true);
    if (key) {
      await update(ref(db, `employees/${key}`), { name, id });
      showToast("Employee updated successfully!", "success");
    } else {
      await push(ref(db, "employees"), { name, id });
      showToast("Employee added successfully!", "success");
    }
    
    resetEmployeeForm();
  } catch (error) {
    showToast("Error saving employee: " + error.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ================= ENHANCED REQUEST VALIDATION ================= */
document.getElementById("reqBtn").onclick = async () => {
  const itemId = document.getElementById("reqItemSelect").value;
  const inputName = sanitizeInput(document.getElementById("reqName").value);
  const inputID = sanitizeInput(document.getElementById("reqID").value, 50);
  const qty = parseInt(document.getElementById("reqQty").value);
  const purpose = sanitizeInput(document.getElementById("reqPurpose").value);
  
  if (!itemId) {
    showToast("Please select an item from the list", "error");
    return;
  }
  
  if (!inputName || inputName.length < 2) {
    showToast("Please enter a valid name (at least 2 characters)", "error");
    return;
  }
  
  if (!inputID || inputID.length < 3) {
    showToast("Please enter a valid employee ID", "error");
    return;
  }
  
  if (isNaN(qty) || qty <= 0) {
    showToast("Please enter a valid quantity (greater than 0)", "error");
    return;
  }
  
  if (!purpose) {
    showToast("Please provide a purpose for the request", "error");
    return;
  }
  
  try {
    showLoading(true);
    
    const empSnap = await get(ref(db, "employees"));
    const employees = empSnap.val() || {};
    const employeeMatch = Object.values(employees).find(e => 
      e.name && e.id && 
      e.name.toLowerCase() === inputName.toLowerCase() && 
      e.id === inputID
    );
    
    if (!employeeMatch) {
      showToast("❌ Name and ID do not match any registered employee.", "error");
      return;
    }
    
    const itemRef = ref(db, `inventory/${itemId}`);
    const itemSnap = await get(itemRef);
    const itemData = itemSnap.val();
    
    if (!itemData) {
      showToast("Selected item not found in inventory", "error");
      return;
    }
    
    if (itemData.quantity < qty) {
      showToast(`Insufficient stock! Only ${itemData.quantity} available.`, "error");
      return;
    }
    
    await update(itemRef, { 
      quantity: itemData.quantity - qty 
    });
    
    await push(ref(db, "transactions"), {
      date: new Date().toISOString(),
      requester: inputName,
      empID: inputID,
      itemName: itemData.name,
      qty: qty,
      purpose: purpose,
      itemId: itemId,
      expiryDate: itemData.expiryDate || null,
      timestamp: Date.now()
    });
    
    showToast("✅ Request Granted! Item issued successfully.", "success");
    
    const form = document.getElementById("requestFields");
    form.style.opacity = "0.5";
    setTimeout(() => {
      ["reqName", "reqID", "reqQty", "reqPurpose"].forEach(id => {
        document.getElementById(id).value = "";
      });
      document.getElementById("reqItemSelect").selectedIndex = 0;
      document.getElementById("itemExpiryInfo").style.display = "none";
      form.style.opacity = "1";
    }, 300);
    
  } catch (error) {
    showToast("Error processing request: " + error.message, "error");
    console.error(error);
  } finally {
    showLoading(false);
  }
};

/* ================= ENHANCED REPORTS & FILTERING ================= */
function loadReports() {
  const path = currentLogView === "requests" ? "transactions" : "admin_logs";
  onValue(ref(db, path), snapshot => {
    const data = snapshot.val();
    if (data) {
      allLogs = Object.values(data).sort((a, b) => 
        new Date(b.date || b.timestamp || 0) - new Date(a.date || a.timestamp || 0)
      );
    } else {
      allLogs = [];
    }
    applyLogFilter();
  });
}

function applyLogFilter() {
  const filter = document.getElementById("logFilterMonth")?.value || "";
  const container = document.getElementById("reportTableContainer");
  
  if (!container) return;
  
  let filtered = allLogs.filter(log => {
    if (!log.date) return false;
    if (!filter) return true;
    return log.date.startsWith(filter);
  });
  
  filtered = filtered.filter(log => {
    if (!log.itemName) return false;
    
    const itemName = (log.itemName || "").toLowerCase();
    const isPPE = itemName.includes('(ppe)') || 
                  ['mask', 'gloves', 'gown', 'shield', 'ppe', 'face shield', 'apron', 'coverall'].some(w => 
                    itemName.includes(w)
                  );
    
    switch(currentStockFilter) {
      case 'all': return true;
      case 'medkit': return !isPPE;
      case 'ppe': return isPPE;
      default: return true;
    }
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:#64748b;">
        <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="opacity:0.5; margin-bottom:16px;">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
        <h4 style="margin:0 0 8px 0; font-weight:500;">No logs found</h4>
        <p style="margin:0; font-size:14px;">
          ${currentStockFilter === 'all' ? '' : currentStockFilter.toUpperCase() + ' '}
          ${filter ? 'for this period' : 'yet'}
        </p>
      </div>
    `;
    return;
  }

  let html = `<table class="logs-table"><thead><tr>
    <th style="width:15%">Date</th>
    <th style="width:15%">User</th>
    <th style="width:10%">Expiry</th>
    <th style="width:25%">Action/Item</th>
    <th style="width:35%">Detail</th>
  </tr></thead><tbody>`;
  
  filtered.slice(0, 100).forEach(log => {
    const itemName = log.itemName || '';
    const isPPE = itemName.toLowerCase().includes('(ppe)');
    const date = new Date(log.date || log.timestamp);
    const formattedDate = isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
    const formattedTime = isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    const action = log.action || 'REQUEST';
    const actionClass = action === 'Add' ? 'add' : 
                       action === 'Edit' ? 'edit' : 
                       action === 'Delete' ? 'delete' : 'req';
    
    const expiryInfo = log.expiryDate ? `
        <div class="log-expiry">
            ${formatExpiryDate(log.expiryDate)}
            ${log.expiryAction ? `<div class="expiry-log-badge ${log.expiryAction}">
                ${log.expiryAction.toUpperCase()} EXPIRY
            </div>` : ''}
        </div>
    ` : '<div class="log-expiry">-</div>';
    
    html += `
      <tr>
        <td>
          <div style="font-weight:500;">${formattedDate}</div>
          <div style="font-size:12px; color:#64748b;">${formattedTime}</div>
        </td>
        <td>
          <div style="font-weight:600;">${log.admin || log.requester || 'Unknown'}</div>
          ${log.empID ? `<div style="font-size:12px; color:#64748b;">ID: ${log.empID}</div>` : ''}
        </td>
        <td class="log-expiry">
          ${expiryInfo}
        </td>
        <td>
          <span class="action-badge ${actionClass}">${action}</span>
          <div style="margin-top:4px; font-weight:500;">${itemName}</div>
          <span class="category-indicator category-${isPPE ? 'ppe' : 'medkit'}">
            ${isPPE ? '🛡️ PPE' : '💊 Medkit'}
          </span>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <span class="quantity-badge">Qty: ${log.qty || 0}</span>
          </div>
          ${log.purpose ? `<div class="purpose-text">${log.purpose}</div>` : ''}
        </td>
      </tr>
    `;
  });
  
  html += `</tbody></table>`;
  
  if (filtered.length > 100) {
    html += `<div style="text-align:center; padding:10px; color:#64748b; font-size:14px;">
      Showing 100 most recent logs of ${filtered.length} total
    </div>`;
  }
  
  container.innerHTML = html;
}

document.getElementById("logTypeSelect").onchange = e => {
  currentLogView = e.target.value;
  loadReports();
};

document.getElementById("logFilterMonth").onchange = applyLogFilter;

document.getElementById("downloadCsvBtn").onclick = () => {
  if (allLogs.length === 0) {
    showToast("No data to export", "error");
    return;
  }
  
  const filter = document.getElementById("logFilterMonth")?.value || "";
  
  let filtered = allLogs.filter(log => {
    if (!log.date) return false;
    if (!filter) return true;
    return log.date.startsWith(filter);
  });
  
  filtered = filtered.filter(log => {
    if (!log.itemName) return false;
    
    const itemName = (log.itemName || "").toLowerCase();
    const isPPE = itemName.includes('(ppe)') || 
                  ['mask', 'gloves', 'gown', 'shield', 'ppe', 'face shield', 'apron', 'coverall'].some(w => 
                    itemName.includes(w)
                  );
    
    switch(currentStockFilter) {
      case 'all': return true;
      case 'medkit': return !isPPE;
      case 'ppe': return isPPE;
      default: return true;
    }
  });
  
  if (filtered.length === 0) {
    showToast("No data matches the current filter", "error");
    return;
  }
  
  let csv = "Date,Time,User,User ID,Action,Item,Quantity,Expiry Date,Category,Purpose\n";
  
  filtered.forEach(log => {
    const itemName = log.itemName || '';
    const isPPE = itemName.toLowerCase().includes('(ppe)');
    const category = isPPE ? 'PPE' : 'Medkit';
    const date = new Date(log.date || log.timestamp);
    const formattedDate = isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
    const formattedTime = isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
    
    csv += `"${formattedDate}","${formattedTime}","${log.admin || log.requester || ''}","${log.empID || ''}",`;
    csv += `"${log.action || 'Request'}","${itemName}",${log.qty || 0},"${log.expiryDate || ''}",${category},"${(log.purpose || "").replace(/"/g, '""')}"\n`;
  });
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Inventory_Report_${currentLogView}_${currentStockFilter}_${filter || 'All'}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  showToast("CSV exported successfully!", "success");
};

/* ================= INVENTORY EDIT/DELETE ================= */
document.getElementById("inventoryBody").addEventListener("click", async e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  
  const id = btn.dataset.id;
  const tr = btn.closest("tr");
  
  if (btn.classList.contains("btn-edit")) {
    document.getElementById("editItemId").value = id;
    
    try {
      showLoading(true);
      const itemRef = ref(db, `inventory/${id}`);
      const itemSnap = await get(itemRef);
      const itemData = itemSnap.val();
      
      if (itemData) {
        const rawName = itemData.name || '';
        const displayName = rawName.replace(/\s*\(PPE\)\s*$/i, '').trim();
        
        document.getElementById("itemName").value = displayName;
        document.getElementById("itemQty").value = parseInt(itemData.quantity) || 0;
        document.getElementById("itemExpiry").value = itemData.expiryDate || '';
        document.getElementById("saveBtn").innerText = "Update Item";
      }
    } catch (error) {
      showToast("Error loading item data: " + error.message, "error");
    } finally {
      showLoading(false);
    }
    
    document.querySelector('.card.admin-only').scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center' 
    });
    
  } else if (btn.classList.contains("btn-delete")) {
    try {
      showLoading(true);
      const itemRef = ref(db, `inventory/${id}`);
      const itemSnap = await get(itemRef);
      const itemData = itemSnap.val();
      
      if (!itemData) {
        showToast("Item not found in database", "error");
        return;
      }
      
      const rawName = itemData.name || '';
      const displayName = rawName.replace(/\s*\(PPE\)\s*$/i, '').trim();
      
      if (confirm(`Are you sure you want to delete "${displayName}" from inventory?`)) {
        await push(ref(db, "admin_logs"), {
          date: new Date().toISOString(),
          admin: auth.currentUser?.email || "Unknown",
          action: "Delete",
          itemName: rawName,
          qty: 0,
          expiryDate: itemData.expiryDate || null,
          timestamp: Date.now()
        });
        
        await remove(ref(db, `inventory/${id}`));
        
        showToast(`"${displayName}" deleted from inventory`, "success");
      }
    } catch (error) {
      showToast("Error deleting item: " + error.message, "error");
    } finally {
      showLoading(false);
    }
  }
});

/* ================= ENHANCED ADD/SAVE INVENTORY ================= */
document.getElementById("saveBtn").onclick = async () => {
  const id = document.getElementById("editItemId").value;
  const name = document.getElementById("itemName").value.trim();
  const qty = parseInt(document.getElementById("itemQty").value);
  const expiryDate = document.getElementById("itemExpiry").value;
  
  if (!name) {
    showToast("Item name is required", "error");
    document.getElementById("itemName").focus();
    return;
  }
  
  if (isNaN(qty) || qty < 0) {
    showToast("Please enter a valid quantity (0 or higher)", "error");
    document.getElementById("itemQty").focus();
    return;
  }
  
  if (expiryDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(expiryDate);
    
    if (selectedDate < today) {
      showToast("Expiry date cannot be in the past", "error");
      document.getElementById("itemExpiry").focus();
      return;
    }
  }
  
  try {
    showLoading(true);
    
    if (id) {
      const itemData = {
        name,
        quantity: qty
      };
      
      if (expiryDate) {
        itemData.expiryDate = expiryDate;
      }
      
      await update(ref(db, `inventory/${id}`), itemData);
      
      await push(ref(db, "admin_logs"), {
        date: new Date().toISOString(),
        admin: auth.currentUser.email,
        action: "Edit",
        itemName: name,
        qty: qty,
        expiryDate: expiryDate || null,
        timestamp: Date.now()
      });
      
      ["editItemId", "itemName", "itemQty", "itemExpiry"].forEach(i => {
        document.getElementById(i).value = "";
      });
      document.getElementById("saveBtn").innerText = "Add / Update";
      
      showToast("Inventory Updated Successfully!", "success");
      
    } else {
      pendingItemData = { name, qty, expiryDate };
      document.getElementById("categoryModal").style.display = "flex";
    }
    
  } catch (error) {
    showToast("Error saving item: " + error.message, "error");
  } finally {
    showLoading(false);
  }
};

document.getElementById("chooseMedkit").onclick = () => finalizeAddition("Medkit");
document.getElementById("choosePPE").onclick = () => finalizeAddition("PPE");
document.getElementById("cancelCategory").onclick = () => {
  document.getElementById("categoryModal").style.display = "none";
  pendingItemData = null;
};

async function finalizeAddition(category) {
  if (!pendingItemData) return;
  
  try {
    showLoading(true);
    
    const finalName = category === "PPE" ? 
      `${pendingItemData.name}${pendingItemData.name.toLowerCase().includes('(ppe)') ? '' : ' (PPE)'}` : 
      pendingItemData.name;
    
    const newKey = push(ref(db, "inventory")).key;
    
    const itemData = {
      name: finalName,
      quantity: pendingItemData.qty,
      category: category.toLowerCase(),
      addedDate: new Date().toISOString()
    };
    
    if (category === "Medkit" && pendingItemData.expiryDate) {
      itemData.expiryDate = pendingItemData.expiryDate;
    }
    
    await update(ref(db, `inventory/${newKey}`), itemData);
    
    await push(ref(db, "admin_logs"), {
      date: new Date().toISOString(),
      admin: auth.currentUser.email,
      action: "Add",
      itemName: finalName,
      qty: pendingItemData.qty,
      expiryDate: pendingItemData.expiryDate || null,
      timestamp: Date.now()
    });
    
    document.getElementById("categoryModal").style.display = "none";
    
    ["itemName", "itemQty", "itemExpiry"].forEach(i => {
      document.getElementById(i).value = "";
    });
    
    showToast("Item Added Successfully!", "success");
    pendingItemData = null;
    
  } catch (error) {
    showToast("Error adding item: " + error.message, "error");
  } finally {
    showLoading(false);
  }
}

/* ================= REQUEST FORM EXPIRY INFO ================= */
document.getElementById("reqItemSelect").addEventListener("change", function() {
    const selectedOption = this.options[this.selectedIndex];
    const expiryDate = selectedOption.dataset.expiry;
    const expiryInfo = document.getElementById("itemExpiryInfo");
    const expiryDisplay = document.getElementById("expiryDateDisplay");
    
    if (expiryDate) {
        const status = getExpiryStatus(expiryDate);
        expiryDisplay.textContent = `${formatExpiryDate(expiryDate)} `;
        
        if (status.status === 'expired') {
            expiryDisplay.innerHTML += `<span style="color:#ef4444; font-weight:bold;">(EXPIRED)</span>`;
            expiryInfo.style.background = "rgba(239, 68, 68, 0.1)";
            expiryInfo.style.borderLeft = "3px solid #ef4444";
        } else if (status.status === 'warning') {
            expiryDisplay.innerHTML += `<span style="color:#f59e0b; font-weight:bold;">(${status.days} days left)</span>`;
            expiryInfo.style.background = "rgba(245, 158, 11, 0.1)";
            expiryInfo.style.borderLeft = "3px solid #f59e0b";
        } else {
            expiryInfo.style.background = "rgba(59, 130, 246, 0.1)";
            expiryInfo.style.borderLeft = "3px solid #3b82f6";
        }
        
        expiryInfo.style.display = 'block';
    } else {
        expiryInfo.style.display = 'none';
    }
});

/* ================= ENHANCED AUTH ACTIONS ================= */
document.getElementById("loginBtn").onclick = async () => {
  const email = document.getElementById("adminEmail").value;
  const password = document.getElementById("adminPass").value;
  
  if (!email) {
    showToast("Please enter email address", "error");
    document.getElementById("adminEmail").focus();
    return;
  }
  
  if (!validateEmail(email)) {
    showToast("Please enter a valid email address", "error");
    document.getElementById("adminEmail").focus();
    return;
  }
  
  if (!password) {
    showToast("Please enter password", "error");
    document.getElementById("adminPass").focus();
    return;
  }
  
  try {
    showLoading(true);
    await signInWithEmailAndPassword(auth, email, password);
    document.getElementById("loginModal").style.display = "none";
    document.getElementById("adminEmail").value = "";
    document.getElementById("adminPass").value = "";
    
  } catch (error) {
    let errorMessage = "Login failed: ";
    switch(error.code) {
      case 'auth/user-not-found':
        errorMessage += "User not found";
        break;
      case 'auth/wrong-password':
        errorMessage += "Incorrect password";
        break;
      case 'auth/invalid-email':
        errorMessage += "Invalid email format";
        break;
      default:
        errorMessage += error.message;
    }
    showToast(errorMessage, "error");
    document.getElementById("adminPass").value = "";
  } finally {
    showLoading(false);
  }
};

document.getElementById("logoutBtn").onclick = () => {
  if(confirm("Are you sure you want to logout?")) {
    showLoading(true);
    signOut(auth).then(() => {
      isPPEMode = false;
      currentStockFilter = 'medkit';
      
      document.body.classList.add("mode-medkit");
      document.body.classList.remove("mode-ppe");
      document.getElementById("formTitle").innerText = "💊 Medkit Request Form";
      document.getElementById("toggleIcon").innerText = "🛡️";
      
      applyStockFilter();
      showToast("Logged out successfully", "success");
    }).catch(error => {
      showToast("Error logging out: " + error.message, "error");
    }).finally(() => {
      showLoading(false);
    });
  }
};

/* ================= ENHANCED INITIALIZATION ================= */
document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add("mode-medkit");
  document.getElementById("formTitle").innerText = "💊 Medkit Request Form";
  document.getElementById("toggleIcon").innerText = "🛡️";
  if (toggleBtn) toggleBtn.title = "Switch to PPE Request";
  
  if (auth.currentUser) {
    updateStockFilterButtons();
  }
  
  document.getElementById("adminPass")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      document.getElementById("loginBtn").click();
    }
  });
  
  document.getElementById("empIDAdmin")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      document.getElementById("saveEmpBtn").click();
    }
  });
  
  document.getElementById("itemQty")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      document.getElementById("saveBtn").click();
    }
  });
  
  // Expiry alert modal setup
  document.querySelectorAll('#expiryFilterTabs .filter-btn').forEach(btn => {
    btn.onclick = function() {
      document.querySelectorAll('#expiryFilterTabs .filter-btn').forEach(b => {
        b.classList.remove('active');
      });
      this.classList.add('active');
      showExpiryAlert(this.dataset.filter);
    };
  });
  
  document.getElementById('closeExpiryAlertModal').onclick = () => {
    document.getElementById('expiryAlertModal').style.display = 'none';
    document.body.classList.remove('modal-open');
  };
  
  document.getElementById('printExpiryReport').onclick = () => {
    printExpiryReport();
  };
  
  // Set minimum date for expiry input
  const today = new Date().toISOString().split('T')[0];
  const expiryInput = document.getElementById('itemExpiry');
  if (expiryInput) {
    expiryInput.min = today;
  }
  
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      const searchInput = document.querySelector('input[type="search"], input[placeholder*="search"]');
      if (searchInput) searchInput.focus();
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'l' && !auth.currentUser) {
      e.preventDefault();
      document.getElementById("loginModal").style.display = "flex";
    }
  });
  
  window.addEventListener('online', () => {
    showToast("Back online. Syncing data...", "success");
    setTimeout(() => location.reload(), 1000);
  });
  
  window.addEventListener('offline', () => {
    showToast("You are offline. Some features may be limited.", "warning");
  });
  
  console.log("Medical Inventory System with Expiry Tracking initialized successfully");
});
