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
let editingRequestId = null;
let inventoryData = {};

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

/* ================= CHANGE FORMATTING HELPER ================= */
function formatItemChanges(oldData, newData) {
    const changes = [];
    
    if (oldData.name !== newData.name) {
        changes.push(`Name: "${oldData.name}" → "${newData.name}"`);
    }
    
    if (oldData.quantity !== newData.quantity) {
        changes.push(`Quantity: ${oldData.quantity} → ${newData.quantity} ${newData.unit || oldData.unit}`);
    }
    
    if (oldData.unit !== newData.unit) {
        changes.push(`Unit: ${oldData.unit} → ${newData.unit}`);
    }
    
    if (oldData.expiryDate !== newData.expiryDate) {
        const oldExpiry = oldData.expiryDate ? formatExpiryDate(oldData.expiryDate) : 'None';
        const newExpiry = newData.expiryDate ? formatExpiryDate(newData.expiryDate) : 'None';
        changes.push(`Expiry: ${oldExpiry} → ${newExpiry}`);
    }
    
    return changes.length > 0 ? changes.join(', ') : 'No significant changes';
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
                    unit: item.unit || 'Pc',
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
                    <span class="expiry-item-name">${item.name.replace(/\s*\(PPE\)\s*$/i, '')} <span class="unit-badge">${item.unit}</span></span>
                    <span class="expiry-item-date">
                        📅 ${formatExpiryDate(item.expiryDate)}
                        <span class="expiry-status ${item.daysLeft < 0 ? 'expiry-expired' : 'expiry-warning'}">
                            ${item.daysLeft < 0 ? `Expired ${Math.abs(item.daysLeft)} days ago` : 
                              `${item.daysLeft} days left`}
                        </span>
                    </span>
                </div>
                <span class="expiry-item-qty">${item.quantity} ${item.unit}</span>
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
                        <th>Unit</th>
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
                <td>${item.unit}</td>
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
setupModal("bulkImportBtn", "bulkImportModal", "closeBulkModal", () => {
  resetBulkImport();
});

/* ================= INVENTORY SYNC FUNCTIONS ================= */
function updateInventoryDisplay() {
    const tbody = document.getElementById("inventoryBody");
    const emptyMessage = document.getElementById("emptyStockMessage");
    
    if (!tbody) return;
    
    tbody.innerHTML = "";
    
    if (Object.keys(inventoryData).length === 0) {
        if (emptyMessage) emptyMessage.style.display = 'block';
        return;
    }
    
    if (emptyMessage) emptyMessage.style.display = 'none';
    
    // Sort items by name, then by expiry date
    const sortedKeys = Object.keys(inventoryData).sort((a, b) => {
        const itemA = inventoryData[a];
        const itemB = inventoryData[b];
        const nameA = (itemA.name || "").toLowerCase();
        const nameB = (itemB.name || "").toLowerCase();
        
        // First sort by name
        if (nameA !== nameB) {
            return nameA.localeCompare(nameB);
        }
        
        // If same name, sort by expiry date (items without expiry first)
        const expiryA = itemA.expiryDate || '';
        const expiryB = itemB.expiryDate || '';
        
        if (!expiryA && !expiryB) return 0;
        if (!expiryA) return -1;
        if (!expiryB) return 1;
        
        return expiryA.localeCompare(expiryB);
    });
    
    sortedKeys.forEach(key => {
        const item = inventoryData[key];
        const qty = parseFloat(item.quantity) || 0;
        const unit = item.unit || 'Pc';
        const rawItemName = item.name || "";
        const expiryDate = item.expiryDate || null;
        
        const displayName = rawItemName.replace(/\s*\(PPE\)\s*$/i, '').trim();
        const lowerName = rawItemName.toLowerCase();
        const isPPE = lowerName.includes('(ppe)') || 
                      ['mask', 'gloves', 'gown', 'shield', 'ppe', 'face shield', 'apron', 'coverall', 'safety', 'protective', 'hard hat', 'helmet'].some(w => 
                          lowerName.includes(w)
                      ) ||
                      (item.category && item.category === 'ppe');
        
        const categoryClass = isPPE ? 'ppe' : 'medkit';
        const categoryIcon = isPPE ? '🛡️' : '💊';
        
        // Format expiry for display
        let expiryDisplay = '';
        if (expiryDate && !isPPE) {
            const status = getExpiryStatus(expiryDate);
            const formattedDate = formatExpiryDate(expiryDate);
            expiryDisplay = `
                <div class="expiry-date ${status.status}">
                    ${formattedDate}
                    ${status.days !== null ? `<span class="expiry-status expiry-${status.status}">
                        ${status.status === 'expired' ? 'Expired' : 
                          status.status === 'warning' ? `${status.days}d left` : 
                          'Valid'}
                    </span>` : ''}
                </div>
            `;
        } else if (isPPE) {
            expiryDisplay = '<div class="expiry-date">N/A</div>';
        } else {
            expiryDisplay = '<div class="expiry-date">-</div>';
        }
        
        const tr = document.createElement("tr");
        tr.className = `cat-${categoryClass}`;
        tr.dataset.category = categoryClass;
        tr.dataset.quantity = qty;
        tr.dataset.expiry = expiryDate || '';
        
        tr.innerHTML = `
            <td style="position: sticky; left: 0; background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(10px); z-index: 1;">
                <div class="item-with-unit" style="display: flex; align-items: center; gap: 6px;">
                    <span class="category-badge ${categoryClass}">${categoryIcon} ${isPPE ? 'PPE' : 'Medkit'}</span>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem;">${displayName}</div>
                        ${expiryDate && !isPPE ? `<div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">Exp: ${formatExpiryDate(expiryDate)}</div>` : ''}
                    </div>
                    <span class="unit-badge">${unit}</span>
                </div>
            </td>
            <td style="text-align:center;">
                <div class="stock-level" style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="stock-qty" style="font-weight: 600; font-size: 0.95rem;">${qty.toLocaleString()}</span>
                    </div>
                </div>
            </td>
            <td>
                ${expiryDisplay}
            </td>
            <td class="admin-only">
                <div class="table-actions">
                    <button class="btn-table btn-edit-table btn-edit" data-id="${key}" title="Edit Item" aria-label="Edit ${displayName}">
                        <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                    </button>
                    <button class="btn-table btn-delete-table btn-delete" data-id="${key}" title="Delete Item" aria-label="Delete ${displayName}">
                        <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(tr);
    });
    
    applyStockFilter();
}

function updateRequestItemOptions() {
    const select = document.getElementById("reqItemSelect");
    const manualItemSelect = document.getElementById("manualReqItem");
    
    if (!select) return;
    
    select.innerHTML = '<option value="">Select Item...</option>';
    if (manualItemSelect) manualItemSelect.innerHTML = '<option value="">Select Item...</option>';
    
    // Group items by name to show expiry variants
    const groupedItems = {};
    
    Object.keys(inventoryData).forEach(key => {
        const item = inventoryData[key];
        const qty = parseFloat(item.quantity) || 0;
        const unit = item.unit || 'Pc';
        const rawItemName = item.name || "";
        const expiryDate = item.expiryDate || null;
        
        const displayName = rawItemName.replace(/\s*\(PPE\)\s*$/i, '').trim();
        const lowerName = rawItemName.toLowerCase();
        const isPPE = lowerName.includes('(ppe)') || 
                      ['mask', 'gloves', 'gown', 'shield', 'ppe', 'face shield', 'apron', 'coverall'].some(w => 
                          lowerName.includes(w)
                      );
        
        if (qty > 0) {
            const baseName = displayName;
            
            if (!groupedItems[baseName]) {
                groupedItems[baseName] = [];
            }
            
            groupedItems[baseName].push({
                key: key,
                item: item,
                displayName: displayName,
                qty: qty,
                unit: unit,
                expiryDate: expiryDate,
                isPPE: isPPE
            });
        }
    });
    
    // Create options with expiry variants
    Object.keys(groupedItems).forEach(baseName => {
        const variants = groupedItems[baseName];
        
        if (variants.length === 1) {
            // Single variant
            const variant = variants[0];
            const optionText = createOptionText(variant);
            
            createOption(select, manualItemSelect, variant, optionText);
        } else {
            // Multiple variants (different expiry dates)
            variants.forEach((variant, index) => {
                let optionText = createOptionText(variant);
                
                // Add variant indicator for items with same name
                if (index > 0) {
                    optionText = optionText.replace(variant.displayName, `${variant.displayName} [Variant ${index + 1}]`);
                }
                
                createOption(select, manualItemSelect, variant, optionText);
            });
        }
    });
}

function createOptionText(variant) {
    let optionText = `${variant.displayName} (${variant.qty} ${variant.unit})`;
    
    if (!variant.isPPE && variant.expiryDate) {
        const expiryDate = new Date(variant.expiryDate);
        const status = getExpiryStatus(variant.expiryDate);
        optionText += ` - Exp: ${expiryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        
        if (status.status === 'warning') {
            optionText += ` ⚠️`;
        } else if (status.status === 'expired') {
            optionText += ` ❌`;
        }
    }
    
    return optionText;
}

function createOption(select, manualItemSelect, variant, optionText) {
    const option = document.createElement("option");
    option.value = variant.key;
    option.textContent = optionText;
    option.className = variant.isPPE ? 'cat-ppe' : 'cat-medkit';
    option.dataset.expiry = variant.expiryDate || '';
    option.dataset.unit = variant.unit;
    select.appendChild(option);
    
    if (manualItemSelect) {
        const manualOption = document.createElement("option");
        manualOption.value = variant.key;
        manualOption.textContent = `${variant.displayName} (${variant.qty} ${variant.unit})`;
        manualOption.dataset.name = variant.item.name;
        manualOption.dataset.unit = variant.unit;
        manualItemSelect.appendChild(manualOption);
    }
}

function updateLowStockItems() {
    const lowStockList = document.getElementById("lowStockList");
    
    if (!lowStockList) return;
    
    lowStockList.innerHTML = "";
    lowStockItems = [];
    
    Object.keys(inventoryData).forEach(key => {
        const item = inventoryData[key];
        const qty = parseFloat(item.quantity) || 0;
        const unit = item.unit || 'Pc';
        const rawItemName = item.name || "";
        const displayName = rawItemName.replace(/\s*\(PPE\)\s*$/i, '').trim();
        const isLow = qty <= 5;
        const isCritical = qty <= 2;
        
        if (isLow) {
            lowStockItems.push({ 
                name: rawItemName, 
                quantity: qty, 
                unit: unit,
                critical: isCritical 
            });
            
            const li = document.createElement("li");
            li.style.cssText = `
                padding: 8px 0;
                border-bottom: 1px solid rgba(0,0,0,0.1);
                display: flex;
                justify-content: space-between;
                align-items: center;
            `;
            li.innerHTML = `
                <span><strong>${displayName}</strong> <span class="unit-badge">${unit}</span></span>
                <span style="color: ${isCritical ? '#ef4444' : '#f59e0b'}; font-weight: bold;">
                    ${qty} ${unit}${isCritical ? ' ⚠️' : ''}
                </span>
            `;
            lowStockList.appendChild(li);
        }
    });
    
    // Update low stock alert badge
    const bell = document.getElementById("lowStockAlert");
    if(bell && auth.currentUser) {
        const criticalCount = lowStockItems.filter(item => item.critical).length;
        bell.style.display = criticalCount > 0 ? "flex" : "none";
        
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
}

/* ================= ENHANCED INVENTORY SYNC ================= */
onValue(ref(db, "inventory"), snapshot => {
    const data = snapshot.val() || {};
    inventoryData = data; // Store globally
    
    updateInventoryDisplay();
    updateRequestItemOptions();
    checkExpiringItems(data);
    updateLowStockItems();
    applyStockFilter();
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
  const stockSummary = document.getElementById('stockSummary');
  const emptyMessage = document.getElementById('emptyStockMessage');
  
  let visibleCount = 0;
  
  rows.forEach(tr => {
    const isPPERow = tr.classList.contains('cat-ppe');
    const isMedkitRow = tr.classList.contains('cat-medkit');
    
    let shouldShow = false;
    
    switch(currentStockFilter) {
      case 'all':
        shouldShow = true;
        break;
      case 'medkit':
        shouldShow = isMedkitRow;
        break;
      case 'ppe':
        shouldShow = isPPERow;
        break;
    }
    
    if (shouldShow) {
      tr.style.display = 'table-row';
      visibleCount++;
    } else {
      tr.style.display = 'none';
    }
  });
  
  // Hide empty message when filtering
  if (emptyMessage) {
    emptyMessage.style.display = 'none';
  }
  
  // Hide stock summary completely
  if (stockSummary) {
    stockSummary.style.display = 'none';
  }
  
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
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
          <button class="btn-table btn-delete-table btn-delete-emp" 
                  data-key="${key}"
                  title="Delete Employee">
            <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
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

/* ================= UPDATED REQUEST VALIDATION WITH UNIT ================= */
document.getElementById("reqBtn").onclick = async () => {
    const itemId = document.getElementById("reqItemSelect").value;
    const inputName = sanitizeInput(document.getElementById("reqName").value);
    const inputID = sanitizeInput(document.getElementById("reqID").value, 50);
    const qty = parseFloat(document.getElementById("reqQty").value);
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
        
        const selectedOption = document.getElementById("reqItemSelect").options[document.getElementById("reqItemSelect").selectedIndex];
        const unit = selectedOption?.dataset.unit || itemData.unit || 'Pc';
        
        // Unit-specific validation
        if (unit === 'ml') {
            // Allow decimal for ml
            if (qty % 1 !== 0 && !Number.isFinite(qty)) {
                showToast("Please enter a valid decimal quantity for ml", "error");
                return;
            }
        } else {
            // Whole numbers for other units
            if (!Number.isInteger(qty)) {
                showToast(`Quantity must be a whole number for ${unit}`, "error");
                return;
            }
        }
        
        if (itemData.quantity < qty) {
            showToast(`Insufficient stock! Only ${itemData.quantity} ${unit} available.`, "error");
            return;
        }
        
        await update(itemRef, { 
            quantity: itemData.quantity - qty 
        });
        
        const newTransactionRef = push(ref(db, "transactions"));
        const transactionKey = newTransactionRef.key;
        
        await set(newTransactionRef, {
            date: new Date().toISOString(),
            requester: inputName,
            empID: inputID,
            itemName: itemData.name,
            qty: qty,
            unit: unit,
            purpose: purpose,
            itemId: itemId,
            expiryDate: itemData.expiryDate || null,
            timestamp: Date.now(),
            transactionId: transactionKey
        });
        
        showToast(`✅ Request Granted! ${qty} ${unit} of ${itemData.name.replace(/\s*\(PPE\)\s*$/i, '')} issued successfully.`, "success");
        
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
    allLogs = [];
    
    if (data) {
      // Store both the data and the Firebase key
      Object.keys(data).forEach(key => {
        allLogs.push({
          ...data[key],
          _key: key  // Store the Firebase key
        });
      });
      
      allLogs.sort((a, b) => 
        new Date(b.date || b.timestamp || 0) - new Date(a.date || a.timestamp || 0)
      );
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
    <th style="width:10%" class="admin-only">Actions</th>
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
      <tr data-log-key="${log._key || ''}">
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
            <span class="quantity-badge">${log.qty || 0} ${log.unit || 'Pc'}</span>
          </div>
          ${log.purpose ? `<div class="purpose-text">${log.purpose}</div>` : ''}
          ${log.detail ? `<div class="purpose-text" style="margin-top:4px; font-size:0.8rem; color:#64748b;">${log.detail}</div>` : ''}
        </td>
        <td class="admin-only">
          ${currentLogView === "requests" && !log.action ? `
            <div class="table-actions" style="justify-content:center; gap:4px;">
              <button class="btn-table btn-edit-table btn-edit-log" 
                      data-key="${log._key || ''}" 
                      title="Edit Request">
                <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                </svg>
              </button>
              <button class="btn-table btn-delete-table btn-delete-log" 
                      data-key="${log._key || ''}"
                      title="Delete Request">
                <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
              </button>
            </div>
          ` : ''}
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
  
  // Attach event listeners to log action buttons
  attachLogActionButtons();
}

function attachLogActionButtons() {
  document.querySelectorAll('.btn-edit-log').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      if (key) {
        editRequestFromLog(key);
      } else {
        showToast("Cannot edit: Request key not found", "error");
      }
    };
  });
  
  document.querySelectorAll('.btn-delete-log').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      if (key) {
        deleteRequestFromLog(key);
      } else {
        showToast("Cannot delete: Request key not found", "error");
      }
    };
  });
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
  
  let csv = "Date,Time,User,User ID,Action,Item,Quantity,Unit,Expiry Date,Category,Purpose,Detail\n";
  
  filtered.forEach(log => {
    const itemName = log.itemName || '';
    const isPPE = itemName.toLowerCase().includes('(ppe)');
    const category = isPPE ? 'PPE' : 'Medkit';
    const date = new Date(log.date || log.timestamp);
    const formattedDate = isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
    const formattedTime = isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
    
    csv += `"${formattedDate}","${formattedTime}","${log.admin || log.requester || ''}","${log.empID || ''}",`;
    csv += `"${log.action || 'Request'}","${itemName}",${log.qty || 0},"${log.unit || 'Pc'}","${log.expiryDate || ''}",${category},"${(log.purpose || "").replace(/"/g, '""')}","${(log.detail || "").replace(/"/g, '""')}"\n`;
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

/* ================= UPDATED INVENTORY EDIT/DELETE WITH UNIT ================= */
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
                document.getElementById("itemQty").value = parseFloat(itemData.quantity) || 0;
                document.getElementById("itemExpiry").value = itemData.expiryDate || '';
                document.getElementById("itemUnit").value = itemData.unit || 'Pc';
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
        const qty = parseFloat(itemData.quantity) || 0;
        const unit = itemData.unit || 'Pc';
        const expiryDate = itemData.expiryDate || null;
        const category = itemData.category || (rawName.toLowerCase().includes('(ppe)') ? 'ppe' : 'medkit');
        
        if (confirm(`Are you sure you want to delete "${displayName}" (${qty} ${unit}) from inventory?`)) {
            // First log the deletion
            await push(ref(db, "admin_logs"), {
                date: new Date().toISOString(),
                admin: auth.currentUser?.email || "Unknown",
                action: "Delete",
                itemName: rawName,
                qty: qty,
                unit: unit,
                expiryDate: expiryDate,
                category: category,
                detail: `Deleted item "${displayName}" from inventory`,
                timestamp: Date.now(),
                originalQuantity: qty,
                originalUnit: unit
            });
            
            // Then delete the item
            await remove(ref(db, `inventory/${id}`));
            
            showToast(`"${displayName}" (${qty} ${unit}) deleted from inventory`, "success");
        }
        } catch (error) {
            showToast("Error deleting item: " + error.message, "error");
        } finally {
            showLoading(false);
        }
    }
});

/* ================= UPDATED SAVE ITEM FUNCTION WITH UNIT ================= */
document.getElementById("saveBtn").onclick = async () => {
    const id = document.getElementById("editItemId").value;
    const name = document.getElementById("itemName").value.trim();
    const qty = parseFloat(document.getElementById("itemQty").value);
    const expiryDate = document.getElementById("itemExpiry").value;
    const unit = document.getElementById("itemUnit").value || 'Pc';
    
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
    
    if (!unit) {
        showToast("Please select a unit of measurement", "error");
        document.getElementById("itemUnit").focus();
        return;
    }
    
    // Unit-specific validation
    if (unit === 'ml') {
        // Allow decimal for ml
        if (qty % 1 !== 0 && !Number.isFinite(qty)) {
            showToast("Please enter a valid decimal quantity for ml", "error");
            document.getElementById("itemQty").focus();
            return;
        }
    } else {
        // Whole numbers for other units
        if (!Number.isInteger(qty)) {
            showToast(`Quantity must be a whole number for ${unit}`, "error");
            document.getElementById("itemQty").focus();
            return;
        }
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
            // Editing existing item - get current data first
            const currentItemRef = ref(db, `inventory/${id}`);
            const currentItemSnap = await get(currentItemRef);
            const currentItemData = currentItemSnap.val();
            
            if (!currentItemData) {
                showToast("Item not found for editing", "error");
                return;
            }
            
            const oldQty = parseFloat(currentItemData.quantity) || 0;
            const oldUnit = currentItemData.unit || 'Pc';
            const oldExpiry = currentItemData.expiryDate || null;
            const oldName = currentItemData.name || '';
            const itemData = {
                name,
                quantity: qty,
                unit: unit
            };
            
            if (expiryDate) {
                itemData.expiryDate = expiryDate;
            }
            
            await update(ref(db, `inventory/${id}`), itemData);
            
            // Log the edit with detailed changes
            const changes = formatItemChanges(
                { 
                    name: oldName, 
                    quantity: oldQty, 
                    unit: oldUnit, 
                    expiryDate: oldExpiry 
                },
                { 
                    name, 
                    quantity: qty, 
                    unit: unit, 
                    expiryDate: expiryDate 
                }
            );
            
            await push(ref(db, "admin_logs"), {
                date: new Date().toISOString(),
                admin: auth.currentUser.email,
                action: "Edit",
                itemName: name,
                qty: qty,
                unit: unit,
                expiryDate: expiryDate || null,
                detail: changes === 'No significant changes' ? 'Item details updated' : changes,
                timestamp: Date.now(),
                originalQuantity: oldQty,
                originalUnit: oldUnit,
                originalExpiry: oldExpiry
            });
            
            ["editItemId", "itemName", "itemQty", "itemExpiry", "itemUnit"].forEach(i => {
                document.getElementById(i).value = "";
            });
            document.getElementById("saveBtn").innerText = "Add / Update";
            
            showToast("Inventory Updated Successfully!", "success");
            
        } else {
            // Adding new item - check for duplicates with same name AND expiry
            const itemsRef = ref(db, "inventory");
            const snapshot = await get(itemsRef);
            const existingItems = snapshot.val() || {};
            
            let existingItemKey = null;
            let exactMatch = false;
            
            // Check for exact match including expiry date
            Object.keys(existingItems).forEach(key => {
                const existingItem = existingItems[key];
                const sameName = existingItem.name.toLowerCase() === name.toLowerCase();
                const sameExpiry = (!existingItem.expiryDate && !expiryDate) || 
                                 (existingItem.expiryDate === expiryDate);
                
                if (sameName && sameExpiry) {
                    existingItemKey = key;
                    exactMatch = true;
                }
            });
            
            if (existingItemKey && exactMatch) {
                // Update existing item (same name AND same expiry)
                const existingItem = existingItems[existingItemKey];
                const oldQty = existingItem.quantity || 0;
                const newQuantity = oldQty + qty;
                
                await update(ref(db, `inventory/${existingItemKey}`), {
                    quantity: newQuantity
                });
                
                // Log the quantity update
                await push(ref(db, "admin_logs"), {
                    date: new Date().toISOString(),
                    admin: auth.currentUser.email,
                    action: "Update Quantity",
                    itemName: existingItem.name,
                    qty: qty,
                    unit: unit,
                    expiryDate: existingItem.expiryDate || null,
                    detail: `Added ${qty} ${unit} to existing item "${name}" (${oldQty} → ${newQuantity})`,
                    timestamp: Date.now(),
                    originalQuantity: oldQty
                });
                
                showToast(`Added ${qty} more to existing item "${name}"`, "success");
                
            } else {
                // Different name OR different expiry - show category modal
                pendingItemData = { name, qty, expiryDate, unit };
                document.getElementById("categoryModal").style.display = "flex";
            }
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
            unit: pendingItemData.unit,
            category: category.toLowerCase(),
            addedDate: new Date().toISOString()
        };
        
        if (category === "Medkit" && pendingItemData.expiryDate) {
            itemData.expiryDate = pendingItemData.expiryDate;
        }
        
        await update(ref(db, `inventory/${newKey}`), itemData);
        
        // Log the addition
        await push(ref(db, "admin_logs"), {
            date: new Date().toISOString(),
            admin: auth.currentUser.email,
            action: "Add",
            itemName: finalName,
            qty: pendingItemData.qty,
            unit: pendingItemData.unit,
            expiryDate: pendingItemData.expiryDate || null,
            category: category.toLowerCase(),
            detail: `Added new ${category.toLowerCase()} item`,
            timestamp: Date.now()
        });
        
        document.getElementById("categoryModal").style.display = "none";
        
        ["itemName", "itemQty", "itemExpiry", "itemUnit"].forEach(i => {
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

/* ================= UPDATED REQUEST FORM EXPIRY INFO ================= */
document.getElementById("reqItemSelect").addEventListener("change", function() {
    const selectedOption = this.options[this.selectedIndex];
    const expiryDate = selectedOption.dataset.expiry;
    const unit = selectedOption.dataset.unit || 'Pc';
    const expiryInfo = document.getElementById("itemExpiryInfo");
    const expiryDisplay = document.getElementById("expiryDateDisplay");
    
    // Update quantity placeholder based on unit
    const qtyInput = document.getElementById("reqQty");
    if (unit === 'ml') {
        qtyInput.placeholder = `Volume in ${unit}`;
        qtyInput.step = "0.1";
    } else {
        qtyInput.placeholder = `Number of ${unit.toLowerCase()}s`;
        qtyInput.step = "1";
    }
    
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

/* ================= MANUAL REQUEST FUNCTIONS ================= */
function resetManualRequestForm() {
    editingRequestId = null;
    document.getElementById("manualRequestId").value = "";
    document.getElementById("manualReqName").value = "";
    document.getElementById("manualReqID").value = "";
    
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('manualReqDate');
    if (dateInput) {
        dateInput.value = today;
        dateInput.max = today;
    }
    
    document.getElementById("manualReqQty").value = "";
    document.getElementById("manualReqPurpose").value = "";
    document.getElementById("manualReqStatus").value = "Completed";
    document.getElementById("saveManualRequestBtn").innerText = "Save Request";
}

function populateManualRequestItems() {
    const itemSelect = document.getElementById("manualReqItem");
    if (!itemSelect) return;
    
    itemSelect.innerHTML = '<option value="">Select Item...</option>';
    
    get(ref(db, "inventory")).then(snapshot => {
        const data = snapshot.val() || {};
        Object.keys(data).forEach(key => {
            const item = data[key];
            const qty = parseFloat(item.quantity) || 0;
            const unit = item.unit || 'Pc';
            const rawName = item.name || "";
            const displayName = rawName.replace(/\s*\(PPE\)\s*$/i, '').trim();
            
            if (qty > 0) {
                const option = document.createElement("option");
                option.value = key;
                option.textContent = `${displayName} (${qty} ${unit})`;
                option.dataset.name = rawName;
                option.dataset.unit = unit;
                itemSelect.appendChild(option);
            }
        });
    }).catch(error => {
        console.error("Error loading items:", error);
        showToast("Error loading inventory items", "error");
    });
}

/* ================= FIXED EDIT REQUEST FUNCTION ================= */
async function editRequestFromLog(requestKey) {
    try {
        showLoading(true);
        
        if (!requestKey) {
            showToast("Invalid request key", "error");
            return;
        }
        
        // Get the request data using the Firebase key
        const requestRef = ref(db, `transactions/${requestKey}`);
        const requestSnap = await get(requestRef);
        const requestData = requestSnap.val();
        
        if (!requestData) {
            showToast("Request not found in database", "error");
            return;
        }
        
        // Set editing state
        editingRequestId = requestKey;
        
        // Populate the form
        document.getElementById("manualRequestId").value = requestKey;
        document.getElementById("manualReqName").value = requestData.requester || "";
        document.getElementById("manualReqID").value = requestData.empID || "";
        
        const requestDate = requestData.date ? new Date(requestData.date) : new Date();
        const formattedDate = requestDate.toISOString().split('T')[0];
        document.getElementById("manualReqDate").value = formattedDate;
        
        const today = new Date().toISOString().split('T')[0];
        const dateInput = document.getElementById('manualReqDate');
        dateInput.max = today;
        
        document.getElementById("manualReqQty").value = requestData.qty || 1;
        document.getElementById("manualReqPurpose").value = requestData.purpose || "";
        document.getElementById("manualReqStatus").value = "Completed";
        document.getElementById("saveManualRequestBtn").innerText = "Update Request";
        
        // Populate items
        await populateManualRequestItems();
        
        // Set the selected item after a short delay to ensure options are loaded
        setTimeout(() => {
            const itemSelect = document.getElementById("manualReqItem");
            if (itemSelect && requestData.itemId) {
                itemSelect.value = requestData.itemId;
                
                // If item doesn't exist in dropdown (maybe deleted), add it
                if (!itemSelect.value) {
                    const option = document.createElement("option");
                    option.value = requestData.itemId;
                    option.textContent = `${requestData.itemName} (0 ${requestData.unit || 'Pc'})`;
                    option.dataset.name = requestData.itemName;
                    option.dataset.unit = requestData.unit || 'Pc';
                    option.selected = true;
                    itemSelect.appendChild(option);
                }
            }
        }, 500);
        
        // Show modal
        document.getElementById("manualRequestModal").style.display = "flex";
        document.body.classList.add("modal-open");
        
    } catch (error) {
        console.error("Error loading request:", error);
        showToast("Error loading request: " + error.message, "error");
    } finally {
        showLoading(false);
    }
}

/* ================= FIXED DELETE REQUEST FUNCTION ================= */
async function deleteRequestFromLog(requestKey) {
    if (!confirm("Are you sure you want to delete this request? This will restore the inventory quantity.")) return;
    
    try {
        showLoading(true);
        
        if (!requestKey) {
            showToast("Invalid request key", "error");
            return;
        }
        
        // Get the request data
        const requestRef = ref(db, `transactions/${requestKey}`);
        const requestSnap = await get(requestRef);
        const requestData = requestSnap.val();
        
        if (!requestData) {
            showToast("Request not found in database", "error");
            return;
        }
        
        // Restore inventory before deleting the request
        if (requestData.itemId) {
            const itemRef = ref(db, `inventory/${requestData.itemId}`);
            const itemSnap = await get(itemRef);
            const itemData = itemSnap.val();
            
            if (itemData) {
                const restoredQty = (itemData.quantity || 0) + (requestData.qty || 0);
                await update(itemRef, { quantity: restoredQty });
                
                // Log the restoration
                await push(ref(db, "admin_logs"), {
                    date: new Date().toISOString(),
                    admin: auth.currentUser?.email || "Unknown",
                    action: "Restore Inventory",
                    itemName: requestData.itemName,
                    qty: requestData.qty || 0,
                    unit: requestData.unit || 'Pc',
                    detail: `Restored ${requestData.qty} ${requestData.unit} from deleted request by ${requestData.requester}`,
                    timestamp: Date.now()
                });
            }
        }
        
        // Delete the transaction
        await remove(requestRef);
        
        // Log the deletion
        await push(ref(db, "admin_logs"), {
            date: new Date().toISOString(),
            admin: auth.currentUser?.email || "Unknown",
            action: "Delete Request",
            itemName: `Request: ${requestData.itemName}`,
            qty: requestData.qty || 0,
            unit: requestData.unit || 'Pc',
            detail: `Deleted request by ${requestData.requester}`,
            timestamp: Date.now()
        });
        
        showToast("Request deleted successfully. Inventory restored.", "success");
        
        // Reload reports to reflect changes
        loadReports();
        
    } catch (error) {
        console.error("Error deleting request:", error);
        showToast("Error deleting request: " + error.message, "error");
    } finally {
        showLoading(false);
    }
}

/* ================= FIXED SAVE MANUAL REQUEST ================= */
document.getElementById("saveManualRequestBtn").onclick = async () => {
    try {
        const requestKey = document.getElementById("manualRequestId").value;
        const name = document.getElementById("manualReqName").value.trim();
        const empID = document.getElementById("manualReqID").value.trim();
        const date = document.getElementById("manualReqDate").value;
        const itemSelect = document.getElementById("manualReqItem");
        const itemId = itemSelect.value;
        const selectedOption = itemSelect.options[itemSelect.selectedIndex];
        const itemName = selectedOption?.dataset.name || "";
        const itemUnit = selectedOption?.dataset.unit || "Pc";
        const qty = parseFloat(document.getElementById("manualReqQty").value);
        const purpose = document.getElementById("manualReqPurpose").value.trim();
        
        // Validation
        if (!name || name.length < 2) {
            showToast("Please enter a valid name (at least 2 characters)", "error");
            return;
        }
        
        if (!empID || empID.length < 3) {
            showToast("Please enter a valid employee ID", "error");
            return;
        }
        
        if (!date) {
            showToast("Please select a request date", "error");
            return;
        }
        
        if (!itemId) {
            showToast("Please select an item", "error");
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
        
        showLoading(true);
        
        const isoDate = new Date(date).toISOString();
        
        const itemRef = ref(db, `inventory/${itemId}`);
        const itemSnap = await get(itemRef);
        const itemData = itemSnap.val();
        const unit = itemData?.unit || itemUnit;
        
        if (requestKey && requestKey.trim() !== "") {
            // EDITING EXISTING REQUEST
            
            // Get the original request data
            const originalRequestRef = ref(db, `transactions/${requestKey}`);
            const originalRequestSnap = await get(originalRequestRef);
            const originalRequest = originalRequestSnap.val();
            
            if (!originalRequest) {
                showToast("Original request data not found", "error");
                return;
            }
            
            const originalQty = originalRequest.qty || 0;
            const originalItemId = originalRequest.itemId;
            const isSameItem = originalItemId === itemId;
            
            // Handle inventory adjustments
            if (isSameItem) {
                // SAME ITEM, DIFFERENT QUANTITY
                const quantityDifference = qty - originalQty;
                
                if (quantityDifference !== 0) {
                    if (itemData) {
                        if (quantityDifference > 0) {
                            // INCREASING quantity - need to deduct more from inventory
                            if (itemData.quantity < quantityDifference) {
                                showToast(`Cannot increase quantity. Only ${itemData.quantity} ${unit} available in stock.`, "error");
                                return;
                            }
                            const newQty = itemData.quantity - quantityDifference;
                            await update(itemRef, { quantity: newQty });
                        } else {
                            // DECREASING quantity - need to restore some to inventory
                            const quantityToRestore = Math.abs(quantityDifference);
                            const newQty = itemData.quantity + quantityToRestore;
                            await update(itemRef, { quantity: newQty });
                        }
                    }
                }
            } else {
                // DIFFERENT ITEM - restore original, deduct new
                
                // 1. Restore original item quantity
                if (originalItemId) {
                    const originalItemRef = ref(db, `inventory/${originalItemId}`);
                    const originalItemSnap = await get(originalItemRef);
                    const originalItemData = originalItemSnap.val();
                    
                    if (originalItemData) {
                        const restoredQty = originalItemData.quantity + originalQty;
                        await update(originalItemRef, { quantity: restoredQty });
                    }
                }
                
                // 2. Deduct new quantity from new item
                if (itemData) {
                    if (itemData.quantity < qty) {
                        showToast(`Insufficient stock! Only ${itemData.quantity} ${unit} available.`, "error");
                        return;
                    }
                    const newQty = itemData.quantity - qty;
                    await update(itemRef, { quantity: newQty });
                }
            }
            
            // Update the request
            await update(originalRequestRef, {
                date: isoDate,
                requester: name,
                empID: empID,
                itemName: itemName,
                qty: qty,
                unit: unit,
                purpose: purpose,
                itemId: itemId,
                isManual: true,
                timestamp: Date.now(),
                updatedBy: auth.currentUser?.email || "Admin",
                updateTime: new Date().toISOString(),
                originalQty: originalQty,
                originalItemId: originalItemId
            });
            
            // Log the edit
            await push(ref(db, "admin_logs"), {
                date: new Date().toISOString(),
                admin: auth.currentUser?.email || "Admin",
                action: "Edit Request",
                itemName: itemName,
                qty: qty,
                unit: unit,
                detail: `Edited request from ${originalRequest?.requester || 'Unknown'} (${originalQty} ${originalRequest?.unit || 'Pc'}) to ${name} (${qty} ${unit})`,
                timestamp: Date.now()
            });
            
            showToast(`Request updated successfully. ${isSameItem ? 
                (qty > originalQty ? `Added ${qty - originalQty} more ${unit}` : 
                 qty < originalQty ? `Reduced by ${originalQty - qty} ${unit}` : 
                 'Quantity unchanged') : 
                'Item changed'}`, "success");
                
        } else {
            // NEW REQUEST
            const newTransactionRef = push(ref(db, "transactions"));
            const transactionKey = newTransactionRef.key;
            
            await set(newTransactionRef, {
                date: isoDate,
                requester: name,
                empID: empID,
                itemName: itemName,
                qty: qty,
                unit: unit,
                purpose: purpose,
                itemId: itemId,
                isManual: true,
                timestamp: Date.now(),
                createdBy: auth.currentUser?.email || "Admin",
                transactionId: transactionKey
            });
            
            if (itemData) {
                const newQty = Math.max(0, (itemData.quantity || 0) - qty);
                await update(itemRef, { quantity: newQty });
                
                await push(ref(db, "admin_logs"), {
                    date: new Date().toISOString(),
                    admin: auth.currentUser?.email || "Admin",
                    action: "Manual Request",
                    itemName: itemName,
                    qty: qty,
                    unit: unit,
                    detail: `Manual request by ${name} (${empID}) - ${purpose}`,
                    timestamp: Date.now()
                });
            }
            
            showToast(`Manual request for ${qty} ${unit} of ${itemName} added successfully`, "success");
        }
        
        document.getElementById("manualRequestModal").style.display = "none";
        document.body.classList.remove("modal-open");
        resetManualRequestForm();
        
        // Reload reports
        loadReports();
        
    } catch (error) {
        console.error("Error saving request:", error);
        showToast("Error saving request: " + error.message, "error");
    } finally {
        showLoading(false);
    }
};

/* ================= BULK IMPORT FUNCTIONALITY ================= */

// Additional modal setup for bulk import
document.getElementById('closeBulkModal').onclick = () => {
    document.getElementById('bulkImportModal').style.display = 'none';
    document.body.classList.remove('modal-open');
    resetBulkImport();
};

document.getElementById('bulkImportModal').onclick = (e) => {
    if (e.target === document.getElementById('bulkImportModal')) {
        document.getElementById('bulkImportModal').style.display = 'none';
        document.body.classList.remove('modal-open');
        resetBulkImport();
    }
};

// Validate units function
function isValidUnit(unit) {
    const validUnits = ['Pc', 'Tablet', 'ml', 'Box', 'Bottle', 'Pack', 'Pair', 'Set', 'Vial', 'Tube', 'Can', 'Carton'];
    return validUnits.includes(unit);
}

// Parse bulk items
function parseBulkItems(text) {
    const lines = text.split('\n').filter(line => line.trim() !== '');
    const items = [];
    
    lines.forEach((line, index) => {
        const parts = line.split(',').map(part => part.trim());
        
        if (parts.length < 4) {
            items.push({
                line: index + 1,
                raw: line,
                valid: false,
                error: 'Insufficient fields. Need at least: Name, Quantity, Unit, Category'
            });
            return;
        }
        
        const [name, quantity, unit, category, expiry] = parts;
        
        // Basic validation
        if (!name || name === '') {
            items.push({
                line: index + 1,
                raw: line,
                valid: false,
                error: 'Item name is required'
            });
            return;
        }
        
        const qtyNum = parseFloat(quantity);
        if (isNaN(qtyNum) || qtyNum < 0) {
            items.push({
                line: index + 1,
                raw: line,
                valid: false,
                error: 'Quantity must be a valid number (≥ 0)'
            });
            return;
        }
        
        const unitToUse = unit || 'Pc';
        if (!isValidUnit(unitToUse)) {
            items.push({
                line: index + 1,
                raw: line,
                valid: false,
                error: `Invalid unit "${unitToUse}". Use: Pc, Tablet, ml, Box, Bottle, Pack, Pair, Set, Vial, Tube, Can, Carton`
            });
            return;
        }
        
        const categoryLower = (category || 'Medkit').toLowerCase();
        if (!['medkit', 'ppe'].includes(categoryLower)) {
            items.push({
                line: index + 1,
                raw: line,
                valid: false,
                error: 'Category must be "Medkit" or "PPE"'
            });
            return;
        }
        
        let expiryDate = '';
        let expiryError = '';
        
        if (expiry && expiry !== '') {
            // Validate date format
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(expiry)) {
                expiryError = 'Date must be YYYY-MM-DD format';
            } else {
                const date = new Date(expiry);
                if (isNaN(date.getTime())) {
                    expiryError = 'Invalid date';
                } else if (date < new Date() && categoryLower === 'medkit') {
                    expiryError = 'Warning: Expiry date is in the past';
                }
                expiryDate = expiry;
            }
        }
        
        items.push({
            line: index + 1,
            raw: line,
            name: name,
            quantity: qtyNum,
            unit: unitToUse,
            category: categoryLower,
            expiryDate: expiryDate,
            valid: true,
            error: expiryError,
            warning: expiryError.includes('Warning')
        });
    });
    
    return items;
}

// Validate bulk items
document.getElementById('validateBulkBtn').onclick = function() {
    const textarea = document.getElementById('bulkItemsTextarea');
    const preview = document.getElementById('bulkPreview');
    const previewContent = document.getElementById('bulkPreviewContent');
    const importBtn = document.getElementById('importBulkBtn');
    const errorDiv = document.getElementById('bulkError');
    
    if (!textarea || !preview || !previewContent) return;
    
    const text = textarea.value.trim();
    if (!text) {
        errorDiv.textContent = 'Please enter some items';
        errorDiv.style.display = 'block';
        preview.style.display = 'none';
        importBtn.disabled = true;
        return;
    }
    
    const items = parseBulkItems(text);
    
    if (items.length === 0) {
        errorDiv.textContent = 'No valid items found';
        errorDiv.style.display = 'block';
        preview.style.display = 'none';
        importBtn.disabled = true;
        return;
    }
    
    // Calculate stats
    const validItems = items.filter(item => item.valid);
    const invalidItems = items.filter(item => !item.valid);
    const warningItems = items.filter(item => item.warning);
    
    // Clear previous preview
    previewContent.innerHTML = '';
    
    // Add stats
    const statsHTML = `
        <div class="bulk-stats">
            <div class="bulk-stat">
                <div class="count total">${items.length}</div>
                <div class="label">Total Items</div>
            </div>
            <div class="bulk-stat">
                <div class="count valid">${validItems.length}</div>
                <div class="label">Valid Items</div>
            </div>
            <div class="bulk-stat">
                <div class="count invalid">${invalidItems.length}</div>
                <div class="label">Invalid Items</div>
            </div>
        </div>
    `;
    previewContent.innerHTML = statsHTML;
    
    // Add items preview (show first 10 only)
    const itemsToShow = items.slice(0, 10);
    itemsToShow.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = `bulk-preview-item ${item.valid ? (item.warning ? 'warning' : '') : 'invalid'}`;
        
        let status = item.valid ? (item.warning ? '⚠️' : '✅') : '❌';
        let details = '';
        
        if (item.valid) {
            details = `
                <div class="bulk-item-details">
                    <span class="bulk-item-detail">${item.quantity} ${item.unit}</span>
                    <span class="bulk-item-detail category-${item.category}">${item.category.toUpperCase()}</span>
                    ${item.expiryDate ? `<span class="bulk-item-detail">Exp: ${item.expiryDate}</span>` : ''}
                </div>
            `;
        }
        
        itemDiv.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 8px;">
                <span style="flex-shrink: 0;">${status}</span>
                <div style="flex: 1;">
                    <strong>${item.name}</strong>
                    <div style="color: #64748b; font-size: 0.8rem; margin-top: 2px;">
                        ${item.error || 'Ready to import'}
                    </div>
                    ${details}
                </div>
            </div>
        `;
        previewContent.appendChild(itemDiv);
    });
    
    if (items.length > 10) {
        const moreDiv = document.createElement('div');
        moreDiv.style.cssText = 'text-align: center; color: #64748b; font-size: 0.85rem; padding: 10px;';
        moreDiv.textContent = `...and ${items.length - 10} more items`;
        previewContent.appendChild(moreDiv);
    }
    
    // Update UI
    errorDiv.style.display = 'none';
    preview.style.display = 'block';
    importBtn.disabled = validItems.length === 0;
    
    // Store items for import
    window.bulkItemsToImport = items.filter(item => item.valid);
};

// Clear bulk items
document.getElementById('clearBulkBtn').onclick = function() {
    document.getElementById('bulkItemsTextarea').value = '';
    document.getElementById('bulkPreview').style.display = 'none';
    document.getElementById('bulkError').style.display = 'none';
    document.getElementById('importBulkBtn').disabled = true;
    window.bulkItemsToImport = [];
};

// Import bulk items
document.getElementById('importBulkBtn').onclick = async function() {
    const items = window.bulkItemsToImport;
    if (!items || items.length === 0) return;
    
    const progressDiv = document.getElementById('bulkProgress');
    const progressBar = document.getElementById('bulkProgressBar');
    const progressPercent = document.getElementById('bulkProgressPercent');
    const statusDiv = document.getElementById('bulkStatus');
    const importBtn = document.getElementById('importBulkBtn');
    const validateBtn = document.getElementById('validateBulkBtn');
    
    progressDiv.style.display = 'block';
    importBtn.disabled = true;
    validateBtn.disabled = true;
    
    let successCount = 0;
    let errorCount = 0;
    let updatedCount = 0;
    let addedCount = 0;
    
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Update progress
        const progress = Math.round(((i + 1) / items.length) * 100);
        progressBar.style.width = `${progress}%`;
        progressPercent.textContent = `${progress}%`;
        statusDiv.textContent = `Processing item ${i + 1} of ${items.length}: ${item.name}`;
        
        try {
            // Check if item already exists with EXACT same name AND expiry date
            const itemsRef = ref(db, "inventory");
            const snapshot = await get(itemsRef);
            const existingItems = snapshot.val() || {};
            
            let existingItemKey = null;
            let exactMatch = false;
            
            // Check for exact match including expiry date
            Object.keys(existingItems).forEach(key => {
                const existingItem = existingItems[key];
                const sameName = existingItem.name.toLowerCase() === item.name.toLowerCase();
                const sameExpiry = (!existingItem.expiryDate && !item.expiryDate) || 
                                 (existingItem.expiryDate === item.expiryDate);
                
                // Only consider it the same item if BOTH name AND expiry date match
                if (sameName && sameExpiry) {
                    existingItemKey = key;
                    exactMatch = true;
                }
            });
            
            if (existingItemKey && exactMatch) {
                // Update existing item (same name AND same expiry)
                const existingItem = existingItems[existingItemKey];
                const oldQty = existingItem.quantity || 0;
                const newQuantity = oldQty + item.quantity;
                
                await update(ref(db, `inventory/${existingItemKey}`), {
                    quantity: newQuantity
                });
                
                // Log the bulk quantity update
                await push(ref(db, "admin_logs"), {
                    date: new Date().toISOString(),
                    admin: auth.currentUser?.email || "Unknown",
                    action: "Update Quantity",
                    itemName: existingItem.name,
                    qty: item.quantity,
                    unit: item.unit,
                    expiryDate: existingItem.expiryDate || null,
                    detail: `Bulk import: Added ${item.quantity} ${item.unit} to existing item "${item.name}" (${oldQty} → ${newQuantity})`,
                    timestamp: Date.now(),
                    originalQuantity: oldQty
                });
                
                updatedCount++;
                successCount++;
            } else {
                // Add as new item (either different name OR different expiry)
                const newKey = push(ref(db, "inventory")).key;
                
                const finalName = item.category === 'ppe' && !item.name.toLowerCase().includes('(ppe)') 
                    ? `${item.name} (PPE)` 
                    : item.name;
                
                const itemData = {
                    name: finalName,
                    quantity: item.quantity,
                    unit: item.unit,
                    category: item.category,
                    addedDate: new Date().toISOString()
                };
                
                if (item.category === 'medkit' && item.expiryDate) {
                    itemData.expiryDate = item.expiryDate;
                }
                
                await update(ref(db, `inventory/${newKey}`), itemData);
                
                // Log the bulk addition
                await push(ref(db, "admin_logs"), {
                    date: new Date().toISOString(),
                    admin: auth.currentUser?.email || "Unknown",
                    action: "Add",
                    itemName: finalName,
                    qty: item.quantity,
                    unit: item.unit,
                    expiryDate: item.expiryDate || null,
                    category: item.category,
                    detail: `Bulk import: Added new ${item.category} item "${item.name}"`,
                    timestamp: Date.now()
                });
                
                addedCount++;
                successCount++;
            }
            
        } catch (error) {
            console.error(`Error importing item ${item.name}:`, error);
            errorCount++;
        }
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Log the import
    if (successCount > 0) {
        try {
            await push(ref(db, "admin_logs"), {
                date: new Date().toISOString(),
                admin: auth.currentUser?.email || "Unknown",
                action: "Bulk Import",
                itemName: `${addedCount} new items added, ${updatedCount} items updated`,
                qty: successCount,
                unit: "items",
                detail: `Bulk import completed: ${addedCount} new items added (including same name with different expiry), ${updatedCount} existing items updated, ${errorCount} errors`,
                timestamp: Date.now(),
                importSummary: {
                    added: addedCount,
                    updated: updatedCount,
                    errors: errorCount,
                    total: items.length
                }
            });
        } catch (error) {
            console.error("Error logging import:", error);
        }
    }
    
    // Show results
    progressBar.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
    progressBar.style.width = '100%';
    progressPercent.textContent = '100%';
    
    const results = [];
    if (addedCount > 0) results.push(`✅ ${addedCount} new items added`);
    if (updatedCount > 0) results.push(`🔄 ${updatedCount} existing items updated`);
    if (errorCount > 0) results.push(`❌ ${errorCount} items failed`);
    
    statusDiv.innerHTML = `<strong>Import Complete!</strong><br>${results.join('<br>')}`;
    
    // Force refresh after import
    setTimeout(async () => {
        try {
            const inventoryRef = ref(db, "inventory");
            const snapshot = await get(inventoryRef);
            inventoryData = snapshot.val() || {};
            
            updateInventoryDisplay();
            updateRequestItemOptions();
            checkExpiringItems(inventoryData);
            updateLowStockItems();
            
            showToast(`Bulk import complete: ${addedCount} added, ${updatedCount} updated, ${errorCount} errors`, 'success');
            
        } catch (error) {
            console.error("Error refreshing after import:", error);
            showToast(`Import completed but refresh failed: ${error.message}`, 'warning');
        } finally {
            // Reset and close modal
            setTimeout(() => {
                document.getElementById('bulkImportModal').style.display = 'none';
                document.body.classList.remove('modal-open');
                resetBulkImport();
                
                // Reload reports
                loadReports();
            }, 2000);
        }
    }, 1000);
};

// Reset bulk import
function resetBulkImport() {
    document.getElementById('bulkItemsTextarea').value = '';
    document.getElementById('bulkPreview').style.display = 'none';
    document.getElementById('bulkError').style.display = 'none';
    document.getElementById('bulkProgress').style.display = 'none';
    document.getElementById('bulkProgressBar').style.width = '0%';
    document.getElementById('bulkProgressPercent').textContent = '0%';
    document.getElementById('bulkStatus').textContent = '';
    
    const importBtn = document.getElementById('importBulkBtn');
    const validateBtn = document.getElementById('validateBulkBtn');
    if (importBtn) importBtn.disabled = true;
    if (validateBtn) validateBtn.disabled = false;
    
    window.bulkItemsToImport = [];
}

/* ================= STOCK EXPORT FUNCTION ================= */
document.getElementById('downloadStockBtn')?.addEventListener('click', () => {
    if (Object.keys(inventoryData).length === 0) {
        showToast("No inventory data to export", "error");
        return;
    }
    
    let csv = "ID,Item Name,Category,Quantity,Unit,Expiry Date,Status,Added Date\n";
    
    Object.keys(inventoryData).forEach(key => {
        const item = inventoryData[key];
        const rawName = item.name || "";
        const displayName = rawName.replace(/\s*\(PPE\)\s*$/i, '').trim();
        const lowerName = rawName.toLowerCase();
        const isPPE = lowerName.includes('(ppe)') || 
                      ['mask', 'gloves', 'gown', 'shield', 'ppe'].some(w => lowerName.includes(w));
        const category = isPPE ? 'PPE' : 'Medkit';
        
        let status = 'Good';
        const qty = parseFloat(item.quantity) || 0;
        if (qty <= 2) status = 'Critical';
        else if (qty <= 5) status = 'Low';
        
        let expiryStatus = '';
        if (!isPPE && item.expiryDate) {
            const status = getExpiryStatus(item.expiryDate);
            if (status.status === 'expired') expiryStatus = 'EXPIRED';
            else if (status.status === 'warning') expiryStatus = `Expiring in ${status.days} days`;
        }
        
        csv += `"${key}","${displayName}","${category}",${qty},"${item.unit || 'Pc'}","${item.expiryDate || ''}","${status} - ${expiryStatus}","${item.addedDate || ''}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Inventory_Stock_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showToast("Stock exported to CSV successfully!", "success");
});

/* ================= ADD FIRST ITEM BUTTON ================= */
document.getElementById('addFirstItemBtn')?.addEventListener('click', () => {
    document.querySelector('.card.admin-only').scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
    });
    document.getElementById('itemName').focus();
});

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
  
  const today = new Date().toISOString().split('T')[0];
  const expiryInput = document.getElementById('itemExpiry');
  if (expiryInput) {
    expiryInput.min = today;
  }
  
  const manualRequestModal = document.getElementById("manualRequestModal");
  const cancelManualBtn = document.getElementById("cancelManualRequestBtn");
  
  if (document.getElementById("addManualRequestBtn")) {
      document.getElementById("addManualRequestBtn").onclick = () => {
          resetManualRequestForm();
          populateManualRequestItems();
          manualRequestModal.style.display = "flex";
          document.body.classList.add("modal-open");
      };
  }
  
  if (cancelManualBtn) {
      cancelManualBtn.onclick = () => {
          manualRequestModal.style.display = "none";
          document.body.classList.remove("modal-open");
          resetManualRequestForm();
      };
  }
  
  if (manualRequestModal) {
      manualRequestModal.onclick = (e) => {
          if (e.target === manualRequestModal) {
              manualRequestModal.style.display = "none";
              document.body.classList.remove("modal-open");
              resetManualRequestForm();
          }
      };
  }
  
  const logTypeSelect = document.getElementById("logTypeSelect");
  const manualBtn = document.getElementById("addManualRequestBtn");
  
  if (logTypeSelect && manualBtn) {
    if (logTypeSelect.value === "requests") {
        manualBtn.style.display = "inline-flex";
    }
    
    logTypeSelect.onchange = function() {
        currentLogView = this.value;
        if (this.value === "requests") {
            manualBtn.style.display = "inline-flex";
        } else {
            manualBtn.style.display = "none";
        }
        loadReports();
    };
  }
  
  const dateInput = document.getElementById('manualReqDate');
  if (dateInput) {
      const today = new Date().toISOString().split('T')[0];
      dateInput.value = today;
      dateInput.max = today;
  }
  
  // Dynamic unit placeholder
  document.getElementById("itemQty")?.addEventListener("input", function() {
    const unit = document.getElementById("itemUnit").value;
    if (unit === 'ml') {
        this.step = "0.1";
    } else {
        this.step = "1";
    }
  });
  
  document.getElementById("itemUnit")?.addEventListener("change", function() {
    const qtyInput = document.getElementById("itemQty");
    const unit = this.value;
    switch(unit) {
        case 'Tablet':
            qtyInput.placeholder = "Number of tablets";
            break;
        case 'ml':
            qtyInput.placeholder = "Volume in ml";
            qtyInput.step = "0.1";
            break;
        case 'Box':
            qtyInput.placeholder = "Number of boxes";
            break;
        case 'Bottle':
            qtyInput.placeholder = "Number of bottles";
            break;
        case 'Pack':
            qtyInput.placeholder = "Number of packs";
            break;
        case 'Pair':
            qtyInput.placeholder = "Number of pairs";
            break;
        case 'Set':
            qtyInput.placeholder = "Number of sets";
            break;
        case 'Vial':
            qtyInput.placeholder = "Number of vials";
            break;
        case 'Tube':
            qtyInput.placeholder = "Number of tubes";
            break;
        case 'Can':
            qtyInput.placeholder = "Number of cans";
            break;
        case 'Carton':
            qtyInput.placeholder = "Number of cartons";
            break;
        default:
            qtyInput.placeholder = "Quantity";
            qtyInput.step = "1";
    }
  });
  
  // Initialize with default placeholder
  if (document.getElementById("itemUnit")) {
    document.getElementById("itemUnit").dispatchEvent(new Event('change'));
  }
  
  // Initialize bulk import
  initBulkImport();
  
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
    
    if (e.key === 'Escape' && manualRequestModal.style.display === 'flex') {
      manualRequestModal.style.display = "none";
      document.body.classList.remove("modal-open");
      resetManualRequestForm();
    }
  });
  
  window.addEventListener('online', () => {
    showToast("Back online. Syncing data...", "success");
    setTimeout(() => location.reload(), 1000);
  });
  
  window.addEventListener('offline', () => {
    showToast("You are offline. Some features may be limited.", "warning");
  });
  
  console.log("Medical Inventory System with Admin Logging initialized successfully");
});

// Initialize bulk import
function initBulkImport() {
    // Add sample data button
    const sampleBtn = document.createElement('button');
    sampleBtn.className = 'btn-text';
    sampleBtn.innerHTML = `
        <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" style="margin-right: 6px;">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
        Load Sample
    `;
    sampleBtn.style.cssText = 'margin-left: 10px; padding: 8px 16px; font-size: 14px;';
    sampleBtn.onclick = function() {
        const sampleData = `Paracetamol 500mg, 100, Tablet, Medkit, 2024-12-31
Surgical Masks, 500, Pc, PPE,
Hand Sanitizer, 50, ml, Medkit, 2024-10-15
Nitrile Gloves, 200, Pair, PPE,
Bandages, 150, Pc, Medkit, 2025-06-30
Antiseptic Wipes, 300, Pc, Medkit, 2024-09-30
Face Shield, 100, Pc, PPE,
Thermometer, 50, Pc, Medkit,
Syringe 5ml, 500, Pc, Medkit, 2024-11-30
Gauze Pads, 400, Pc, Medkit, 2025-03-15`;
        
        document.getElementById('bulkItemsTextarea').value = sampleData;
    };
    
    const modalContent = document.querySelector('#bulkImportModal .modal-content');
    const formatDiv = modalContent?.querySelector('div[style*="Format Instructions"]');
    if (formatDiv) {
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'margin-top: 10px;';
        buttonContainer.appendChild(sampleBtn);
        formatDiv.appendChild(buttonContainer);
    }
    
    // Auto-validate on paste
    const textarea = document.getElementById('bulkItemsTextarea');
    if (textarea) {
        textarea.addEventListener('paste', function(e) {
            setTimeout(() => {
                document.getElementById('validateBulkBtn').click();
            }, 100);
        });
        
        textarea.addEventListener('input', function() {
            if (this.value.trim() === '') {
                document.getElementById('bulkPreview').style.display = 'none';
                document.getElementById('bulkError').style.display = 'none';
                document.getElementById('importBulkBtn').disabled = true;
            }
        });
    }
}

/* ================= INACTIVITY TIMEOUT ================= */
let idleTimeout;
let logoutTimeout;
const IDLE_WARNING_TIME = 1 * 60 * 1000; // 4 minutes (warning)
const IDLE_LOGOUT_TIME = 2 * 60 * 1000; // 5 minutes (logout)

function resetIdleTimer() {
    clearTimeout(idleTimeout);
    clearTimeout(logoutTimeout);
    
    if (auth.currentUser) {
        // Set warning timeout (4 minutes)
        idleTimeout = setTimeout(() => {
            showIdleWarning();
        }, IDLE_WARNING_TIME);
        
        // Set logout timeout (5 minutes)
        logoutTimeout = setTimeout(() => {
            autoLogout();
        }, IDLE_LOGOUT_TIME);
    }
}

function showIdleWarning() {
    if (!auth.currentUser) return;
    
    // Check if a warning is already showing
    if (document.getElementById('idleWarningToast')) return;
    
    const warningToast = document.createElement('div');
    warningToast.id = 'idleWarningToast';
    warningToast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 8px 25px rgba(245, 158, 11, 0.3);
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 12px;
        animation: slideUp 0.3s ease;
        max-width: 350px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
    `;
    
    warningToast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
            <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
            <div style="flex: 1;">
                <div style="font-weight: 600; margin-bottom: 4px;">Session Timeout Warning</div>
                <div style="font-size: 14px; opacity: 0.9;">You will be logged out in 1 minute due to inactivity.</div>
            </div>
        </div>
        <button id="extendSessionBtn" style="
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.3);
            color: white;
            border-radius: 6px;
            padding: 8px 16px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            white-space: nowrap;
        ">Stay Logged In</button>
    `;
    
    document.body.appendChild(warningToast);
    
    // Add slideUp animation if not already defined
    if (!document.querySelector('#slideUpAnimation')) {
        const style = document.createElement('style');
        style.id = 'slideUpAnimation';
        style.textContent = `
            @keyframes slideUp {
                from { transform: translateY(100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            @keyframes slideDown {
                from { transform: translateY(0); opacity: 1; }
                to { transform: translateY(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Add event listener to extend button
    document.getElementById('extendSessionBtn').onclick = () => {
        resetIdleTimer();
        warningToast.style.animation = 'slideDown 0.3s ease';
        setTimeout(() => warningToast.remove(), 300);
        showToast("Session extended", "success");
    };
}

function autoLogout() {
    if (!auth.currentUser) return;
    
    // Remove warning toast if exists
    const warningToast = document.getElementById('idleWarningToast');
    if (warningToast) {
        warningToast.remove();
    }
    
    // Show logout notification
    showToast("Session timed out due to inactivity. You have been logged out.", "warning");
    
    // Perform logout
    signOut(auth).then(() => {
        // Reset states
        isPPEMode = false;
        currentStockFilter = 'medkit';
        
        document.body.classList.add("mode-medkit");
        document.body.classList.remove("mode-ppe");
        document.getElementById("formTitle").innerText = "💊 Medkit Request Form";
        document.getElementById("toggleIcon").innerText = "🛡️";
        
        applyStockFilter();
        
        // Clear all timeouts
        clearTimeout(idleTimeout);
        clearTimeout(logoutTimeout);
    }).catch(error => {
        console.error("Error during auto-logout:", error);
    });
}

// Reset timer on user activity
function setupActivityListeners() {
    // Mouse events
    ['click', 'mousemove', 'mousedown', 'scroll'].forEach(event => {
        document.addEventListener(event, resetIdleTimer, { passive: true });
    });
    
    // Keyboard events
    ['keypress', 'keydown'].forEach(event => {
        document.addEventListener(event, resetIdleTimer, { passive: true });
    });
    
    // Touch events for mobile
    ['touchstart', 'touchmove'].forEach(event => {
        document.addEventListener(event, resetIdleTimer, { passive: true });
    });
    
    // Input events for form interactions
    ['input', 'change', 'focus'].forEach(event => {
        document.addEventListener(event, resetIdleTimer, { passive: true });
    });
}

// Initialize idle timer when auth state changes
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
        
        // Clear idle timer when not admin
        clearTimeout(idleTimeout);
        clearTimeout(logoutTimeout);
        
        // Remove warning toast if exists
        const warningToast = document.getElementById('idleWarningToast');
        if (warningToast) warningToast.remove();
    } else {
        // Start idle timer when admin logs in
        setupActivityListeners();
        resetIdleTimer();
        
        loadReports();
        loadEmployees();
        currentStockFilter = 'all';
        updateStockFilterButtons();
        applyStockFilter();
        showToast(`Welcome back, ${user.email.split('@')[0]}!`, "success");
    }
    
    if (!isAdmin) {
        currentStockFilter = isPPEMode ? 'ppe' : 'medkit';
        applyStockFilter();
    }
});

// Also add this to the DOMContentLoaded event listener to ensure proper cleanup
document.addEventListener('DOMContentLoaded', () => {
    // ... existing initialization code ...
    
    // Clean up idle timer on page unload
    window.addEventListener('beforeunload', () => {
        clearTimeout(idleTimeout);
        clearTimeout(logoutTimeout);
    });
    
    // Clean up idle timer on manual logout
    const originalLogout = document.getElementById("logoutBtn").onclick;
    document.getElementById("logoutBtn").onclick = function() {
        clearTimeout(idleTimeout);
        clearTimeout(logoutTimeout);
        
        // Remove warning toast if exists
        const warningToast = document.getElementById('idleWarningToast');
        if (warningToast) warningToast.remove();
        
        // Call original logout function
        if (originalLogout) originalLogout.call(this);
    };
});
