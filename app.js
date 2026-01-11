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
let currentStockFilter = 'all'; // 'all', 'medkit', 'ppe' - Global filter state
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
  const filterButtons = document.querySelectorAll('#filterAllBtn, #filterMedkitBtn, #filterPPEBtn');
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
    // Initialize stock filter to "all" when admin logs in
    currentStockFilter = 'all';
    updateStockFilterButtons();
    applyStockFilter();
  }
  
  applyStockFilter(); // For non-admin mode
});

/* ================= MODAL CONTROLS ================= */
const setupModal = (triggerId, modalId, closeId) => {
  const trigger = document.getElementById(triggerId);
  const modal = document.getElementById(modalId);
  const close = document.getElementById(closeId);
  
  if (trigger && modal) trigger.onclick = () => modal.style.display = "flex";
  if (close && modal) close.onclick = () => { 
    modal.style.display = "none"; 
    if(modalId === "employeeModal") resetEmployeeForm();
  };
};

setupModal("loginTrigger", "loginModal", "closeModal");
setupModal("employeeTrigger", "employeeModal", "closeEmployeeModal");
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
    
    if (isLow) {
      lowStockItems.push({ name: item.name, quantity: qty });
      lowStockList.innerHTML += `<li><strong>${item.name}</strong>: Only ${qty} left</li>`;
    }
    
    // Determine category
    const isPPE = item.name.toLowerCase().includes('(ppe)') || 
                  ['mask', 'gloves', 'gown', 'shield', 'ppe', 'face shield', 'apron', 'coverall'].some(w => 
                    item.name.toLowerCase().includes(w)
                  );
    
    const tr = document.createElement("tr");
    if (isPPE) {
      tr.className = "cat-ppe";
    } else {
      tr.className = "cat-medkit";
    }
    
    tr.innerHTML = `
      <td>${item.name}</td>
      <td style="text-align:center"><span class="stock-tag ${isLow ? 'low' : 'ok'}">${qty}</span></td>
      <td class="admin-only">
        <button class="btn-edit btn-primary" data-id="${key}" style="background:var(--warning);padding:5px 10px;">Edit</button>
        <button class="btn-delete btn-danger" data-id="${key}" style="padding:5px 10px;">Del</button>
      </td>
    `;
    
    tbody.appendChild(tr);
    select.innerHTML += `<option value="${key}">${item.name}</option>`;
  });
  
  // Apply current filter after inventory loads
  if (auth.currentUser) {
    applyStockFilter();
  }
  
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
  
  // Apply filter to stock table
  applyStockFilter();
  
  // Update button styles
  updateStockFilterButtons();
  
  // Automatically filter logs to match stock selection
  applyLogFilter();
}

function applyStockFilter() {
  const rows = document.querySelectorAll('#inventoryBody tr');
  
  rows.forEach(tr => {
    switch(currentStockFilter) {
      case 'all':
        tr.style.display = 'table-row';
        break;
      case 'medkit':
        if (tr.classList.contains('cat-medkit')) {
          tr.style.display = 'table-row';
        } else {
          tr.style.display = 'none';
        }
        break;
      case 'ppe':
        if (tr.classList.contains('cat-ppe')) {
          tr.style.display = 'table-row';
        } else {
          tr.style.display = 'none';
        }
        break;
    }
  });
}

function updateStockFilterButtons() {
  const allBtn = document.getElementById('filterAllBtn');
  const medkitBtn = document.getElementById('filterMedkitBtn');
  const ppeBtn = document.getElementById('filterPPEBtn');
  
  // Reset all buttons
  [allBtn, medkitBtn, ppeBtn].forEach(btn => {
    if (btn) {
      btn.classList.remove('btn-success', 'active');
      btn.classList.add('btn-primary');
    }
  });
  
  // Set active button
  let activeBtn;
  switch(currentStockFilter) {
    case 'all': activeBtn = allBtn; break;
    case 'medkit': activeBtn = medkitBtn; break;
    case 'ppe': activeBtn = ppeBtn; break;
  }
  
  if (activeBtn) {
    activeBtn.classList.remove('btn-primary');
    activeBtn.classList.add('btn-success', 'active');
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
    } else {
      document.body.classList.add("mode-medkit");
      document.body.classList.remove("mode-ppe");
      document.getElementById("formTitle").innerText = "💊 Medkit Request Form";
      document.getElementById("toggleIcon").innerText = "🛡️";
    }
    
    applyStockFilter();
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
          <td>${emp.name}</td>
          <td>${emp.id}</td>
          <td class="admin-only">
            <button class="btn-primary" onclick="window.editEmployee('${key}', '${emp.name}', '${emp.id}')" style="padding:2px 8px; background:var(--warning); margin-right:5px;">Edit</button>
            <button class="btn-danger" onclick="window.deleteEmployee('${key}')" style="padding:2px 8px;">×</button>
          </td>
        </tr>
      `;
    });
  });
}

window.editEmployee = (key, name, id) => {
  document.getElementById("editEmpId").value = key;
  document.getElementById("empNameAdmin").value = name;
  document.getElementById("empIDAdmin").value = id;
  document.getElementById("saveEmpBtn").innerText = "Update Employee";
};

window.deleteEmployee = (key) => {
  if(confirm("Remove this employee?")) remove(ref(db, `employees/${key}`));
};

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
  
  if (!name || !id) return alert("Fill Name and ID");
  
  if (key) {
    await update(ref(db, `employees/${key}`), { name, id });
  } else {
    await push(ref(db, "employees"), { name, id });
  }
  
  resetEmployeeForm();
};

/* ================= REQUEST VALIDATION ================= */
document.getElementById("reqBtn").onclick = async () => {
  const itemId = document.getElementById("reqItemSelect").value;
  const inputName = document.getElementById("reqName").value.trim();
  const inputID = document.getElementById("reqID").value.trim();
  const qty = parseInt(document.getElementById("reqQty").value);
  const purpose = document.getElementById("reqPurpose").value.trim();
  
  if (!itemId || !inputName || !inputID || isNaN(qty)) return alert("Fill all fields");
  
  try {
    const empSnap = await get(ref(db, "employees"));
    const employees = empSnap.val() || {};
    const isValid = Object.values(employees).some(e => 
      e.name.toLowerCase() === inputName.toLowerCase() && e.id === inputID
    );
    
    if (!isValid) return alert("❌ Name and ID do not match registered employees.");
    
    const itemRef = ref(db, `inventory/${itemId}`);
    const itemSnap = await get(itemRef);
    const itemData = itemSnap.val();
    
    if (itemData.quantity < qty) return alert("Insufficient stock!");
    
    await update(itemRef, { quantity: itemData.quantity - qty });
    
    await push(ref(db, "transactions"), {
      date: new Date().toISOString(),
      requester: inputName,
      empID: inputID,
      itemName: itemData.name,
      qty: qty,
      purpose: purpose || "General Issue"
    });
    
    alert("✅ Request Granted!");
    ["reqName", "reqID", "reqQty", "reqPurpose"].forEach(i => document.getElementById(i).value = "");
  } catch (e) {
    alert("Error: " + e.message);
  }
};

/* ================= REPORTS, FILTERING & CSV ================= */
function loadReports() {
  const path = currentLogView === "requests" ? "transactions" : "admin_logs";
  onValue(ref(db, path), snapshot => {
    allLogs = snapshot.val() ? Object.values(snapshot.val()) : [];
    applyLogFilter(); // Apply current stock filter to logs
  });
}

function applyLogFilter() {
  const filter = document.getElementById("logFilterMonth")?.value || "";
  const container = document.getElementById("reportTableContainer");
  
  if (!container) return;
  
  // Filter by date first
  let filtered = allLogs.filter(l => !filter || (l.date && l.date.startsWith(filter)));
  
  // Apply stock filter to logs (sync with current stock selection)
  filtered = filtered.filter(log => {
    // Skip logs that don't have itemName
    if (!log.itemName) return false;
    
    const itemName = log.itemName.toLowerCase();
    const isPPE = itemName.includes('(ppe)') || 
                  ['mask', 'gloves', 'gown', 'shield', 'ppe', 'face shield', 'apron', 'coverall'].some(w => 
                    itemName.includes(w)
                  );
    
    switch(currentStockFilter) {
      case 'all':
        return true; // Show all logs
      case 'medkit':
        return !isPPE; // Show only non-PPE (Medkit) logs
      case 'ppe':
        return isPPE; // Show only PPE logs
      default:
        return true;
    }
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p style='text-align:center; padding:20px; color:#888;'>
      No ${currentStockFilter === 'all' ? '' : currentStockFilter.toUpperCase() + ' '}logs found${filter ? ' for this period' : ''}.
    </p>`;
    return;
  }

  let html = `<table><thead><tr><th>Date</th><th>User</th><th>Action/Item</th><th>Detail</th></tr></thead><tbody>`;
  
  filtered.slice().reverse().forEach(l => {
    const itemName = l.itemName || '';
    const isPPE = itemName.toLowerCase().includes('(ppe)');
    const categoryTag = isPPE ? ' 🛡️' : ' 💊';
    
    html += `
      <tr>
        <td><small>${new Date(l.date).toLocaleDateString()}</small></td>
        <td>${l.admin || l.requester || ''}</td>
        <td><strong>${l.action ? `[${l.action}]` : 'REQ'}</strong> ${itemName}${categoryTag}</td>
        <td>Qty: ${l.qty} <br><small>${l.purpose || ''}</small></td>
      </tr>
    `;
  });
  
  container.innerHTML = html + "</tbody></table>";
}

// Update existing log event listeners
document.getElementById("logTypeSelect").onchange = e => {
  currentLogView = e.target.value;
  loadReports();
};

document.getElementById("logFilterMonth").onchange = applyLogFilter;

document.getElementById("downloadCsvBtn").onclick = () => {
  if (allLogs.length === 0) return alert("No data to export");
  
  const filter = document.getElementById("logFilterMonth")?.value || "";
  
  // Filter by date first
  let filtered = allLogs.filter(l => !filter || (l.date && l.date.startsWith(filter)));
  
  // Apply stock filter to logs
  filtered = filtered.filter(log => {
    if (!log.itemName) return false;
    
    const itemName = log.itemName.toLowerCase();
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
  
  if (filtered.length === 0) return alert("No data matches the current filter");
  
  let csv = "Date,User,Action,Item,Qty,Category,Purpose\n";
  
  filtered.forEach(l => {
    const itemName = l.itemName || '';
    const isPPE = itemName.toLowerCase().includes('(ppe)');
    const category = isPPE ? 'PPE' : 'Medkit';
    
    csv += `${new Date(l.date).toLocaleDateString()},${l.admin || l.requester || ''},${l.action || 'Request'},"${itemName}",${l.qty},${category},"${(l.purpose || "").replace(/"/g, '""')}"\n`;
  });
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Report_${currentLogView}_${currentStockFilter}_${filter || 'All'}.csv`;
  link.click();
};

/* ================= INVENTORY EDIT/DELETE ================= */
document.getElementById("inventoryBody").addEventListener("click", async e => {
  const btn = e.target;
  const id = btn.dataset.id;
  
  if (btn.classList.contains("btn-edit")) {
    const tr = btn.closest("tr");
    document.getElementById("editItemId").value = id;
    document.getElementById("itemName").value = tr.cells[0].innerText;
    document.getElementById("itemQty").value = tr.cells[1].innerText.replace(/\D/g, "");
    document.getElementById("saveBtn").innerText = "Update Item";
    window.scrollTo({top: 0, behavior: 'smooth'});
  } else if (btn.classList.contains("btn-delete")) {
    const name = btn.closest("tr").cells[0].innerText;
    if(confirm(`Delete ${name}?`)) {
      await push(ref(db, "admin_logs"), {
        date: new Date().toISOString(),
        admin: auth.currentUser.email,
        action: "Delete",
        itemName: name,
        qty: 0
      });
      await remove(ref(db, `inventory/${id}`));
    }
  }
});

/* ================= ADD/SAVE INVENTORY ================= */
document.getElementById("saveBtn").onclick = async () => {
  const id = document.getElementById("editItemId").value;
  const name = document.getElementById("itemName").value.trim();
  const qty = parseInt(document.getElementById("itemQty").value);
  
  if (!name || isNaN(qty)) return alert("Invalid entry");
  
  if (id) {
    await update(ref(db, `inventory/${id}`), { name, quantity: qty });
    await push(ref(db, "admin_logs"), {
      date: new Date().toISOString(),
      admin: auth.currentUser.email,
      action: "Edit",
      itemName: name,
      qty: qty
    });
    
    ["editItemId", "itemName", "itemQty"].forEach(i => document.getElementById(i).value = "");
    document.getElementById("saveBtn").innerText = "Add / Update";
    alert("Inventory Updated");
  } else {
    pendingItemData = { name, qty };
    document.getElementById("categoryModal").style.display = "flex";
  }
};

document.getElementById("chooseMedkit").onclick = () => finalizeAddition("Medkit");
document.getElementById("choosePPE").onclick = () => finalizeAddition("PPE");
document.getElementById("cancelCategory").onclick = () => document.getElementById("categoryModal").style.display = "none";

async function finalizeAddition(category) {
  const finalName = category === "PPE" ? `${pendingItemData.name} (PPE)` : pendingItemData.name;
  const newKey = push(ref(db, "inventory")).key;
  
  await update(ref(db, `inventory/${newKey}`), {
    name: finalName,
    quantity: pendingItemData.qty
  });
  
  await push(ref(db, "admin_logs"), {
    date: new Date().toISOString(),
    admin: auth.currentUser.email,
    action: "Add",
    itemName: finalName,
    qty: pendingItemData.qty
  });
  
  document.getElementById("categoryModal").style.display = "none";
  pendingItemData = null;
}

/* ================= AUTH ACTIONS ================= */
document.getElementById("loginBtn").onclick = async () => {
  try {
    await signInWithEmailAndPassword(
      auth, 
      document.getElementById("adminEmail").value, 
      document.getElementById("adminPass").value
    );
    document.getElementById("loginModal").style.display = "none";
    // Clear credentials after successful login
    document.getElementById("adminEmail").value = "";
    document.getElementById("adminPass").value = "";
  } catch {
    alert("Login failed");
    // Clear credentials on failed login too
    document.getElementById("adminPass").value = "";
  }
};

document.getElementById("logoutBtn").onclick = () => {
  signOut(auth).then(() => {
    // Reset to medkit mode when logging out
    isPPEMode = false;
    currentStockFilter = 'all'; // Reset filter state
    document.body.classList.add("mode-medkit");
    document.body.classList.remove("mode-ppe");
    document.getElementById("formTitle").innerText = "💊 Medkit Request Form";
    document.getElementById("toggleIcon").innerText = "🛡️";
    applyStockFilter();
  });
};

/* ================= INITIALIZE PAGE STATE ================= */
document.addEventListener('DOMContentLoaded', () => {
  // Start in medkit mode by default
  document.body.classList.add("mode-medkit");
  document.getElementById("formTitle").innerText = "💊 Medkit Request Form";
  document.getElementById("toggleIcon").innerText = "🛡️";
  
  // Initialize stock filter buttons
  updateStockFilterButtons();
});
