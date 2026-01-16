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
    .replace(/[<>"'&]/g, '') // Remove dangerous characters
    .trim()
    .substring(0, maxLength); // Limit length
}

/* ================= AUTH & UI STATE ================= */
onAuthStateChanged(auth, user => {
  const isAdmin = !!user;
  document.body.classList.toggle("is-admin", isAdmin);
  
  // Show/hide logout button
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.style.display = isAdmin ? "block" : "none";
  
  // Show/hide login trigger
  const loginTrigger = document.getElementById("loginTrigger");
  if (loginTrigger) loginTrigger.style.display = isAdmin ? "none" : "flex";
  
  // Show/hide employee trigger
  const empTrigger = document.getElementById("employeeTrigger");
  if (empTrigger) empTrigger.style.display = isAdmin ? "flex" : "none";
  
  // Handle admin-only elements
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => {
    if (isAdmin) {
      // Remove the inline style if it was hiding the element
      if (el.style.display === 'none') {
        el.style.display = '';
      }
    }
  });
  
  // Handle public-only elements
  const publicElements = document.querySelectorAll('.public-only');
  publicElements.forEach(el => {
    el.style.display = isAdmin ? 'none' : '';
  });
  
  // Show/hide admin filter buttons
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
    // Initialize filter state for non-admin users
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
      document.body.style.overflow = "hidden";
      modal.style.animation = "modalFadeIn 0.3s ease";
    };
  }
  
  if (close && modal) {
    close.onclick = () => { 
      closeModal(modal, clearFieldsOnClose, onCloseCallback);
    };
  }
  
  // Close modal when clicking outside
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeModal(modal, clearFieldsOnClose, onCloseCallback);
      }
    };
  }
  
  // Escape key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal(modal, clearFieldsOnClose, onCloseCallback);
    }
  });
};

function closeModal(modal, clearFieldsOnClose, onCloseCallback) {
  modal.style.display = "none"; 
  document.body.style.overflow = "auto";
  
  if (clearFieldsOnClose) {
    document.getElementById("adminEmail").value = "";
    document.getElementById("adminPass").value = "";
  }
  
  if (onCloseCallback) onCloseCallback();
}

// Setup modals
setupModal("loginTrigger", "loginModal", "closeModal", null, true);
setupModal("employeeTrigger", "employeeModal", "closeEmployeeModal", () => {
  resetEmployeeForm();
});
setupModal("lowStockAlert", "lowStockModal", "closeLowStockModal");



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
  
 Object.keys(data).forEach(key => {
    const item = data[key];
    const qty = parseInt(item.quantity) || 0;
    const isLow = qty <= 5;
    const isCritical = qty <= 2;
    const rawItemName = item.name || "";
    
    // Remove (PPE) extension from display name
    const displayName = rawItemName.replace(/\s*\(PPE\)\s*$/i, '').trim();
    
    // Determine category - check if original name had (PPE) or other PPE indicators
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
    
    const categoryClass = isPPE ? 'ppe' : 'medkit';
    const categoryIcon = isPPE ? '🛡️' : '💊';
    
    const tr = document.createElement("tr");
    tr.className = `cat-${categoryClass}`;
    tr.dataset.category = categoryClass;
    tr.dataset.quantity = qty;
    
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
    // Use displayName in dropdown too
    select.innerHTML += `<option value="${key}" class="cat-${categoryClass}">${displayName} (${qty} available)</option>`;
});
  
  // Apply current filter after inventory loads
  applyStockFilter();
  
  const bell = document.getElementById("lowStockAlert");
  if(bell) {
    bell.style.display = (auth.currentUser && lowStockItems.length > 0) ? "flex" : "none";
    
    // Add notification badge
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
  
  // Apply filter to table rows
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
  
  // Apply filter to dropdown options
  if (!auth.currentUser) { // Only for non-admin users
    options.forEach(option => {
      if (option.value === "") return; // Skip the default option
      
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
    
    // Update body class for CSS filtering
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
    
    // Update filter for non-admin users
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
    
    // Attach event listeners to employee action buttons
    attachEmployeeEventListeners();
  });
}

function attachEmployeeEventListeners() {
  // Edit buttons
  document.querySelectorAll('.btn-edit-emp').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const name = btn.dataset.name;
      const id = btn.dataset.id;
      editEmployee(key, name, id);
    };
  });
  
  // Delete buttons
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
  
  // Scroll to form
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
  
  // Validate input
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
  
  // Validate all fields
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
    
    // Validate employee
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
    
    // Check stock availability
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
    
    // Update inventory
    await update(itemRef, { 
      quantity: itemData.quantity - qty 
    });
    
    // Log transaction
    await push(ref(db, "transactions"), {
      date: new Date().toISOString(),
      requester: inputName,
      empID: inputID,
      itemName: itemData.name,
      qty: qty,
      purpose: purpose,
      itemId: itemId,
      timestamp: Date.now()
    });
    
    showToast("✅ Request Granted! Item issued successfully.", "success");
    
    // Clear form with animation
    const form = document.getElementById("requestFields");
    form.style.opacity = "0.5";
    setTimeout(() => {
      ["reqName", "reqID", "reqQty", "reqPurpose"].forEach(id => {
        document.getElementById(id).value = "";
      });
      document.getElementById("reqItemSelect").selectedIndex = 0;
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
  
  // Filter by date first
  let filtered = allLogs.filter(log => {
    if (!log.date) return false;
    if (!filter) return true;
    return log.date.startsWith(filter);
  });
  
  // Apply stock filter to logs
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
    <th style="width:25%">Action/Item</th>
    <th style="width:45%">Detail</th>
  </tr></thead><tbody>`;
  
  filtered.slice(0, 100).forEach(log => { // Limit to 100 logs for performance
    const itemName = log.itemName || '';
    const isPPE = itemName.toLowerCase().includes('(ppe)');
    const categoryTag = isPPE ? ' 🛡️' : ' 💊';
    const date = new Date(log.date || log.timestamp);
    const formattedDate = isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
    const formattedTime = isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    // Determine action type
    const action = log.action || 'REQUEST';
    const actionClass = action === 'Add' ? 'add' : 
                       action === 'Edit' ? 'edit' : 
                       action === 'Delete' ? 'delete' : 'req';
    
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

// Update log event listeners
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
  
  // Filter by date first
  let filtered = allLogs.filter(log => {
    if (!log.date) return false;
    if (!filter) return true;
    return log.date.startsWith(filter);
  });
  
  // Apply stock filter to logs
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
  
  let csv = "Date,Time,User,User ID,Action,Item,Quantity,Category,Purpose\n";
  
  filtered.forEach(log => {
    const itemName = log.itemName || '';
    const isPPE = itemName.toLowerCase().includes('(ppe)');
    const category = isPPE ? 'PPE' : 'Medkit';
    const date = new Date(log.date || log.timestamp);
    const formattedDate = isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
    const formattedTime = isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
    
    csv += `"${formattedDate}","${formattedTime}","${log.admin || log.requester || ''}","${log.empID || ''}",`;
    csv += `"${log.action || 'Request'}","${itemName}",${log.qty || 0},${category},"${(log.purpose || "").replace(/"/g, '""')}"\n`;
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
    
    // Get the original item data from Firebase to preserve the actual stored name
    try {
      showLoading(true);
      const itemRef = ref(db, `inventory/${id}`);
      const itemSnap = await get(itemRef);
      const itemData = itemSnap.val();
      
      if (itemData) {
        // Use the actual stored name from Firebase
        const rawName = itemData.name || '';
        // Remove any existing "(PPE)" suffix for editing (it will be re-added if needed)
        const displayName = rawName.replace(/\s*\(PPE\)\s*$/i, '').trim();
        
        document.getElementById("itemName").value = displayName;
        document.getElementById("itemQty").value = parseInt(itemData.quantity) || 0;
        document.getElementById("saveBtn").innerText = "Update Item";
      }
    } catch (error) {
      showToast("Error loading item data: " + error.message, "error");
    } finally {
      showLoading(false);
    }
    
    // Scroll to form with smooth animation
    document.querySelector('.card.admin-only').scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center' 
    });
    
  } else if (btn.classList.contains("btn-delete")) {
    // Get the item name from Firebase to ensure we have the correct name
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
      // Remove "(PPE)" suffix for confirmation message
      const displayName = rawName.replace(/\s*\(PPE\)\s*$/i, '').trim();
      
      if (confirm(`Are you sure you want to delete "${displayName}" from inventory?`)) {
        // Log the deletion first
        await push(ref(db, "admin_logs"), {
          date: new Date().toISOString(),
          admin: auth.currentUser?.email || "Unknown",
          action: "Delete",
          itemName: rawName, // Log the full name including (PPE) if present
          qty: 0,
          timestamp: Date.now()
        });
        
        // Remove from inventory
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
  
  try {
    showLoading(true);
    
    if (id) {
      // Update existing item
      await update(ref(db, `inventory/${id}`), { 
        name, 
        quantity: qty 
      });
      
      await push(ref(db, "admin_logs"), {
        date: new Date().toISOString(),
        admin: auth.currentUser.email,
        action: "Edit",
        itemName: name,
        qty: qty,
        timestamp: Date.now()
      });
      
      // Reset form
      ["editItemId", "itemName", "itemQty"].forEach(i => {
        document.getElementById(i).value = "";
      });
      document.getElementById("saveBtn").innerText = "Add / Update";
      
      showToast("Inventory Updated Successfully!", "success");
      
    } else {
      // New item - show category selection
      pendingItemData = { name, qty };
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
    
    await update(ref(db, `inventory/${newKey}`), {
      name: finalName,
      quantity: pendingItemData.qty,
      category: category.toLowerCase(),
      addedDate: new Date().toISOString()
    });
    
    await push(ref(db, "admin_logs"), {
      date: new Date().toISOString(),
      admin: auth.currentUser.email,
      action: "Add",
      itemName: finalName,
      qty: pendingItemData.qty,
      timestamp: Date.now()
    });
    
    document.getElementById("categoryModal").style.display = "none";
    
    // Reset form
    ["itemName", "itemQty"].forEach(i => {
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
    // Clear credentials
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
    // Clear password on failed login
    document.getElementById("adminPass").value = "";
  } finally {
    showLoading(false);
  }
};

document.getElementById("logoutBtn").onclick = () => {
  if(confirm("Are you sure you want to logout?")) {
    showLoading(true);
    signOut(auth).then(() => {
      // Reset to medkit mode when logging out
      isPPEMode = false;
      currentStockFilter = 'medkit'; // Non-admin default
      
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
  // Start in medkit mode by default
  document.body.classList.add("mode-medkit");
  document.getElementById("formTitle").innerText = "💊 Medkit Request Form";
  document.getElementById("toggleIcon").innerText = "🛡️";
  if (toggleBtn) toggleBtn.title = "Switch to PPE Request";
  
  // Initialize stock filter buttons if admin
  if (auth.currentUser) {
    updateStockFilterButtons();
  }
  
  // Add enter key support for login
  document.getElementById("adminPass")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      document.getElementById("loginBtn").click();
    }
  });
  
  // Add enter key support for employee form
  document.getElementById("empIDAdmin")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      document.getElementById("saveEmpBtn").click();
    }
  });
  
  // Add enter key support for inventory form
  document.getElementById("itemQty")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      document.getElementById("saveBtn").click();
    }
  });
  
  // Auto-focus first input in modal when opened
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('shown', () => {
      const input = modal.querySelector('input:not([type="hidden"])');
      if (input) input.focus();
    });
  });
  
  // Add keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + F to focus search/filter
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      const searchInput = document.querySelector('input[type="search"], input[placeholder*="search"]');
      if (searchInput) searchInput.focus();
    }
    
    // Ctrl/Cmd + L to open login modal (when not logged in)
    if ((e.ctrlKey || e.metaKey) && e.key === 'l' && !auth.currentUser) {
      e.preventDefault();
      document.getElementById("loginModal").style.display = "flex";
    }
  });
  
  // Add offline detection
  window.addEventListener('online', () => {
    showToast("Back online. Syncing data...", "success");
    // Reload data when coming back online
    setTimeout(() => location.reload(), 1000);
  });
  
  window.addEventListener('offline', () => {
    showToast("You are offline. Some features may be limited.", "warning");
  });
  
  console.log("Medical Inventory System initialized successfully");
});
