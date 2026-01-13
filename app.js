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

/* ================= AUTH & UI STATE ================= */
onAuthStateChanged(auth, user => {
  const isAdmin = !!user;
  document.body.classList.toggle("is-admin", isAdmin);
  document.getElementById("logoutBtn").style.display = isAdmin ? "block" : "none";
  document.getElementById("loginTrigger").style.display = isAdmin ? "none" : "flex";
  
  const empTrigger = document.getElementById("employeeTrigger");
  if (empTrigger) empTrigger.style.display = isAdmin ? "flex" : "none";
  
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
  } else {
    // Initialize filter state for non-admin users
    currentStockFilter = isPPEMode ? 'ppe' : 'medkit';
    applyStockFilter();
  }
});

/* ================= MODAL CONTROLS ================= */
const setupModal = (triggerId, modalId, closeId, onCloseCallback = null) => {
  const trigger = document.getElementById(triggerId);
  const modal = document.getElementById(modalId);
  const close = document.getElementById(closeId);
  
  if (trigger && modal) {
    trigger.onclick = () => {
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";
    };
  }
  
  if (close && modal) {
    close.onclick = () => { 
      modal.style.display = "none"; 
      document.body.style.overflow = "auto";
      if(onCloseCallback) onCloseCallback();
    };
  }
  
  // Close modal when clicking outside
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
        document.body.style.overflow = "auto";
        if(onCloseCallback) onCloseCallback();
      }
    };
  }
};

setupModal("loginTrigger", "loginModal", "closeModal");
setupModal("employeeTrigger", "employeeModal", "closeEmployeeModal", () => {
  resetEmployeeForm();
});
setupModal("lowStockAlert", "lowStockModal", "closeLowStockModal");

/* ================= INVENTORY SYNC ================= */
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
    const itemName = item.name || "";
    
    if (isLow) {
      lowStockItems.push({ name: itemName, quantity: qty });
      lowStockList.innerHTML += `<li><strong>${itemName}</strong>: Only ${qty} left</li>`;
    }
    
    // Determine category
    const lowerName = itemName.toLowerCase();
    const isPPE = lowerName.includes('(ppe)') || 
                  ['mask', 'gloves', 'gown', 'shield', 'ppe', 'face shield', 'apron', 'coverall', 'safety', 'protective'].some(w => 
                    lowerName.includes(w)
                  ) ||
                  (item.category && item.category === 'ppe');
    
    const categoryClass = isPPE ? 'ppe' : 'medkit';
    const categoryIcon = isPPE ? '🛡️' : '💊';
    
    const tr = document.createElement("tr");
    tr.className = `cat-${categoryClass}`;
    tr.dataset.category = categoryClass;
    
    tr.innerHTML = `
      <td>
        <span class="category-badge ${categoryClass}">${categoryIcon} ${isPPE ? 'PPE' : 'Medkit'}</span>
        ${itemName}
      </td>
      <td style="text-align:center">
        <div class="stock-level">
          <span class="stock-indicator ${isLow ? 'low' : 'ok'}"></span>
          <span class="stock-qty">${qty}</span>
          ${isLow ? '<span style="color:#ef4444; font-size:0.8rem; margin-left:4px;">(Low)</span>' : ''}
        </div>
      </td>
      <td class="admin-only" style="text-align:center">
        <div class="table-actions">
          <button class="btn-table btn-edit-table btn-edit" data-id="${key}">Edit</button>
          <button class="btn-table btn-delete-table btn-delete" data-id="${key}">Delete</button>
        </div>
      </td>
    `;
    
    tbody.appendChild(tr);
    select.innerHTML += `<option value="${key}" class="cat-${categoryClass}">${itemName}</option>`;
  });
  
  // Apply current filter after inventory loads
  applyStockFilter();
  
  const bell = document.getElementById("lowStockAlert");
  if(bell) bell.style.display = (auth.currentUser && lowStockItems.length > 0) ? "flex" : "none";
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

/* ================= EMPLOYEE MANAGEMENT ================= */
function loadEmployees() {
  onValue(ref(db, "employees"), snapshot => {
    const data = snapshot.val() || {};
    const tbody = document.querySelector("#employeeTable tbody");
    if(!tbody) return;
    
    tbody.innerHTML = "";
    Object.keys(data).forEach(key => {
      const emp = data[key];
      tbody.innerHTML += `
        <tr>
          <td>${emp.name || ''}</td>
          <td>${emp.id || ''}</td>
          <td class="admin-only" style="white-space: nowrap;">
            <button class="btn-table btn-edit-table btn-edit-emp" data-key="${key}" data-name="${emp.name || ''}" data-id="${emp.id || ''}" style="background:var(--warning);">Edit</button>
            <button class="btn-table btn-delete-table btn-delete-emp" data-key="${key}">×</button>
          </td>
        </tr>
      `;
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
}

function deleteEmployee(key) {
  if(confirm("Remove this employee?")) {
    remove(ref(db, `employees/${key}`)).then(() => {
      console.log("Employee deleted");
    }).catch(error => {
      alert("Error deleting employee: " + error.message);
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
  
  if (!name || !id) {
    alert("Please fill both Name and ID fields");
    return;
  }
  
  try {
    if (key) {
      await update(ref(db, `employees/${key}`), { name, id });
    } else {
      await push(ref(db, "employees"), { name, id });
    }
    
    resetEmployeeForm();
    alert("Employee saved successfully!");
  } catch (error) {
    alert("Error saving employee: " + error.message);
  }
};

/* ================= REQUEST VALIDATION ================= */
document.getElementById("reqBtn").onclick = async () => {
  const itemId = document.getElementById("reqItemSelect").value;
  const inputName = document.getElementById("reqName").value.trim();
  const inputID = document.getElementById("reqID").value.trim();
  const qty = parseInt(document.getElementById("reqQty").value);
  const purpose = document.getElementById("reqPurpose").value.trim();
  
  if (!itemId || !inputName || !inputID || isNaN(qty) || qty <= 0) {
    alert("Please fill all required fields with valid values");
    return;
  }
  
  try {
    // Validate employee
    const empSnap = await get(ref(db, "employees"));
    const employees = empSnap.val() || {};
    const isValid = Object.values(employees).some(e => 
      e.name && e.id && 
      e.name.toLowerCase() === inputName.toLowerCase() && 
      e.id === inputID
    );
    
    if (!isValid) {
      alert("❌ Name and ID do not match any registered employee.");
      return;
    }
    
    // Check stock availability
    const itemRef = ref(db, `inventory/${itemId}`);
    const itemSnap = await get(itemRef);
    const itemData = itemSnap.val();
    
    if (!itemData) {
      alert("Selected item not found in inventory");
      return;
    }
    
    if (itemData.quantity < qty) {
      alert(`Insufficient stock! Only ${itemData.quantity} available.`);
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
      purpose: purpose || "General Issue",
      itemId: itemId
    });
    
    alert("✅ Request Granted!");
    
    // Clear form
    ["reqName", "reqID", "reqQty", "reqPurpose"].forEach(id => {
      document.getElementById(id).value = "";
    });
    document.getElementById("reqItemSelect").selectedIndex = 0;
    
  } catch (error) {
    alert("Error processing request: " + error.message);
    console.error(error);
  }
};

/* ================= REPORTS, FILTERING & CSV ================= */
function loadReports() {
  const path = currentLogView === "requests" ? "transactions" : "admin_logs";
  onValue(ref(db, path), snapshot => {
    const data = snapshot.val();
    if (data) {
      allLogs = Object.values(data);
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
    container.innerHTML = `<p style='text-align:center; padding:20px; color:#888;'>
      No ${currentStockFilter === 'all' ? '' : currentStockFilter.toUpperCase() + ' '}logs found${filter ? ' for this period' : ''}.
    </p>`;
    return;
  }

  let html = `<table style="width:100%"><thead><tr>
    <th style="width:20%">Date</th>
    <th style="width:15%">User</th>
    <th style="width:30%">Action/Item</th>
    <th style="width:35%">Detail</th>
  </tr></thead><tbody>`;
  
  filtered.slice().reverse().forEach(log => {
    const itemName = log.itemName || '';
    const isPPE = itemName.toLowerCase().includes('(ppe)');
    const categoryTag = isPPE ? ' 🛡️' : ' 💊';
    const date = new Date(log.date);
    const formattedDate = isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
    
    html += `
      <tr>
        <td><small>${formattedDate}</small></td>
        <td>${log.admin || log.requester || ''}</td>
        <td><strong>${log.action ? `[${log.action}]` : 'REQ'}</strong> ${itemName}${categoryTag}</td>
        <td>Qty: ${log.qty || 0} <br><small>${log.purpose || ''}</small></td>
      </tr>
    `;
  });
  
  html += "</tbody></table>";
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
    alert("No data to export");
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
    alert("No data matches the current filter");
    return;
  }
  
  let csv = "Date,User,Action,Item,Qty,Category,Purpose\n";
  
  filtered.forEach(log => {
    const itemName = log.itemName || '';
    const isPPE = itemName.toLowerCase().includes('(ppe)');
    const category = isPPE ? 'PPE' : 'Medkit';
    const date = new Date(log.date);
    const formattedDate = isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
    
    csv += `${formattedDate},${log.admin || log.requester || ''},${log.action || 'Request'},"${itemName}",${log.qty || 0},${category},"${(log.purpose || "").replace(/"/g, '""')}"\n`;
  });
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Report_${currentLogView}_${currentStockFilter}_${filter || 'All'}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/* ================= INVENTORY EDIT/DELETE ================= */
document.getElementById("inventoryBody").addEventListener("click", async e => {
  const btn = e.target;
  const id = btn.dataset.id;
  
  if (btn.classList.contains("btn-edit")) {
    const tr = btn.closest("tr");
    document.getElementById("editItemId").value = id;
    document.getElementById("itemName").value = tr.querySelector('td').innerText.replace(/^.*💊.*🛡️\s*/, '').trim();
    
    // Extract quantity from stock level
    const qtyText = tr.querySelector('.stock-qty').innerText;
    const qty = parseInt(qtyText) || 0;
    document.getElementById("itemQty").value = qty;
    
    document.getElementById("saveBtn").innerText = "Update Item";
    window.scrollTo({top: 0, behavior: 'smooth'});
  } else if (btn.classList.contains("btn-delete")) {
    const name = btn.closest("tr").querySelector('td').innerText.replace(/^.*💊.*🛡️\s*/, '').trim();
    if(confirm(`Delete "${name}" from inventory?`)) {
      try {
        // Log the deletion
        await push(ref(db, "admin_logs"), {
          date: new Date().toISOString(),
          admin: auth.currentUser.email,
          action: "Delete",
          itemName: name,
          qty: 0
        });
        
        // Remove from inventory
        await remove(ref(db, `inventory/${id}`));
        
        alert("Item deleted successfully");
      } catch (error) {
        alert("Error deleting item: " + error.message);
      }
    }
  }
});

/* ================= ADD/SAVE INVENTORY ================= */
document.getElementById("saveBtn").onclick = async () => {
  const id = document.getElementById("editItemId").value;
  const name = document.getElementById("itemName").value.trim();
  const qty = parseInt(document.getElementById("itemQty").value);
  
  if (!name) {
    alert("Item name is required");
    return;
  }
  
  if (isNaN(qty) || qty < 0) {
    alert("Please enter a valid quantity (0 or higher)");
    return;
  }
  
  try {
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
        qty: qty
      });
      
      // Reset form
      ["editItemId", "itemName", "itemQty"].forEach(i => {
        document.getElementById(i).value = "";
      });
      document.getElementById("saveBtn").innerText = "Add / Update";
      
      alert("Inventory Updated Successfully!");
    } else {
      // New item - show category selection
      pendingItemData = { name, qty };
      document.getElementById("categoryModal").style.display = "flex";
    }
  } catch (error) {
    alert("Error saving item: " + error.message);
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
    const finalName = category === "PPE" ? 
      `${pendingItemData.name}${pendingItemData.name.toLowerCase().includes('(ppe)') ? '' : ' (PPE)'}` : 
      pendingItemData.name;
    
    const newKey = push(ref(db, "inventory")).key;
    
    await update(ref(db, `inventory/${newKey}`), {
      name: finalName,
      quantity: pendingItemData.qty,
      category: category.toLowerCase()
    });
    
    await push(ref(db, "admin_logs"), {
      date: new Date().toISOString(),
      admin: auth.currentUser.email,
      action: "Add",
      itemName: finalName,
      qty: pendingItemData.qty
    });
    
    document.getElementById("categoryModal").style.display = "none";
    
    // Reset form
    ["itemName", "itemQty"].forEach(i => {
      document.getElementById(i).value = "";
    });
    
    alert("Item Added Successfully!");
    pendingItemData = null;
  } catch (error) {
    alert("Error adding item: " + error.message);
  }
}

/* ================= AUTH ACTIONS ================= */
document.getElementById("loginBtn").onclick = async () => {
  const email = document.getElementById("adminEmail").value;
  const password = document.getElementById("adminPass").value;
  
  if (!email || !password) {
    alert("Please enter email and password");
    return;
  }
  
  try {
    await signInWithEmailAndPassword(auth, email, password);
    document.getElementById("loginModal").style.display = "none";
    // Clear credentials
    document.getElementById("adminEmail").value = "";
    document.getElementById("adminPass").value = "";
  } catch (error) {
    alert("Login failed: " + error.message);
    // Clear password on failed login
    document.getElementById("adminPass").value = "";
  }
};

document.getElementById("logoutBtn").onclick = () => {
  signOut(auth).then(() => {
    // Reset to medkit mode when logging out
    isPPEMode = false;
    currentStockFilter = 'medkit'; // Non-admin default
    
    document.body.classList.add("mode-medkit");
    document.body.classList.remove("mode-ppe");
    document.getElementById("formTitle").innerText = "💊 Medkit Request Form";
    document.getElementById("toggleIcon").innerText = "🛡️";
    
    applyStockFilter();
    alert("Logged out successfully");
  }).catch(error => {
    alert("Error logging out: " + error.message);
  });
};

/* ================= INITIALIZE PAGE STATE ================= */
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
});
