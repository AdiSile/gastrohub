/**
 * Restaurant Management System - Core JavaScript
 * Handles inventory, suppliers, deliveries, orders, and transactions
 */

// ========== STATE ==========
const state = {
    currentView: 'dashboard',
    inventory: [],
    suppliers: [],
    deliveries: [],
    orders: [],
    transactions: [],
    filters: {
        inventory: { search: '', category: 'all', lowStock: false },
        suppliers: { search: '', status: 'all' },
        orders: { search: '', status: 'all', dateFrom: '', dateTo: '' },
        deliveries: { search: '', status: 'all', dateFrom: '', dateTo: '' },
        transactions: { search: '', type: 'all', dateFrom: '', dateTo: '' }
    },
    pagination: {
        inventory: { page: 1, perPage: 10, total: 0 },
        suppliers: { page: 1, perPage: 10, total: 0 },
        deliveries: { page: 1, perPage: 10, total: 0 },
        orders: { page: 1, perPage: 10, total: 0 },
        transactions: { page: 1, perPage: 10, total: 0 }
    }
};

// ========== API HELPERS ==========
const API_BASE = '/api';

async function apiRequest(endpoint, options = {}) {
    const config = {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    };
    
    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, config);
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(error.message || `HTTP ${response.status}`);
    }
    
    return response.json();
}

// ========== UTILITY FUNCTIONS ==========
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ro-RO', { 
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit' 
    });
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'RON' }).format(amount || 0);
}

function debounce(fn, delay = 300) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    container.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) notification.remove();
    }, 5000);
}

function showLoading(show = true) {
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.style.display = show ? 'flex' : 'none';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

// ========== NAVIGATION ==========
function navigateTo(view) {
    state.currentView = view;
    
    // Hide all views
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    
    // Show target view
    const targetView = document.getElementById(`view-${view}`);
    if (targetView) targetView.style.display = 'block';
    
    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-link[data-view="${view}"]`);
    if (activeLink) activeLink.classList.add('active');
    
    // Load data for the view
    switch (view) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'inventory':
            loadInventory();
            break;
        case 'suppliers':
            loadSuppliers();
            break;
        case 'deliveries':
            loadDeliveries();
            break;
        case 'orders':
            loadOrders();
            break;
        case 'transactions':
            loadTransactions();
            break;
    }
}

// ========== DASHBOARD FUNCTIONS ==========
async function loadDashboard() {
    showLoading(true);
    try {
        const data = await apiRequest('/dashboard');
        
        // Update summary cards
        const totalInventory = document.getElementById('dash-total-inventory');
        const totalSuppliers = document.getElementById('dash-total-suppliers');
        const totalOrders = document.getElementById('dash-total-orders');
        const totalRevenue = document.getElementById('dash-total-revenue');
        
        if (totalInventory) totalInventory.textContent = data.totalInventoryItems || 0;
        if (totalSuppliers) totalSuppliers.textContent = data.totalSuppliers || 0;
        if (totalOrders) totalOrders.textContent = data.totalOrders || 0;
        if (totalRevenue) totalRevenue.textContent = formatCurrency(data.totalRevenue || 0);
        
        // Low stock alerts
        const alertsContainer = document.getElementById('dash-low-stock-alerts');
        if (alertsContainer && data.lowStockItems && data.lowStockItems.length > 0) {
            alertsContainer.innerHTML = data.lowStockItems.map(item => `
                <div class="alert alert-warning alert-dismissible fade show" role="alert">
                    <strong>Stoc scăzut:</strong> ${escapeHtml(item.name)} - ${item.quantity} ${item.unit || 'buc'} 
                    (minim: ${item.minStock})
                    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            `).join('');
        } else if (alertsContainer) {
            alertsContainer.innerHTML = '<div class="alert alert-success">Nu există produse cu stoc scăzut.</div>';
        }
        
        // Recent orders
        const recentOrders = document.getElementById('dash-recent-orders');
        if (recentOrders && data.recentOrders) {
            if (data.recentOrders.length === 0) {
                recentOrders.innerHTML = '<tr><td colspan="5" class="text-center">Nu există comenzi recente.</td></tr>';
            } else {
                recentOrders.innerHTML = data.recentOrders.map(order => `
                    <tr>
                        <td>#${order.id || '-'}</td>
                        <td>${formatDate(order.createdAt)}</td>
                        <td>${escapeHtml(order.supplierName || '-')}</td>
                        <td>${formatCurrency(order.totalAmount)}</td>
                        <td>
                            <span class="badge ${getOrderStatusBadge(order.status)}">
                                ${getOrderStatusLabel(order.status)}
                            </span>
                        </td>
                    </tr>
                `).join('');
            }
        }
        
        // Recent deliveries
        const recentDeliveries = document.getElementById('dash-recent-deliveries');
        if (recentDeliveries && data.recentDeliveries) {
            if (data.recentDeliveries.length === 0) {
                recentDeliveries.innerHTML = '<tr><td colspan="5" class="text-center">Nu există livrări recente.</td></tr>';
            } else {
                recentDeliveries.innerHTML = data.recentDeliveries.map(delivery => `
                    <tr>
                        <td>${escapeHtml(delivery.supplierName || '-')}</td>
                        <td>${formatDate(delivery.deliveryDate)}</td>
                        <td>${escapeHtml(delivery.productName || '-')}</td>
                        <td>${delivery.quantity || 0}</td>
                        <td>
                            <span class="badge ${getDeliveryStatusBadge(delivery.status)}">
                                ${getDeliveryStatusLabel(delivery.status)}
                            </span>
                        </td>
                    </tr>
                `).join('');
            }
        }
    } catch (error) {
        showNotification(`Eroare la încărcarea dashboard-ului: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

// ========== INVENTORY FUNCTIONS ==========
async function loadInventory() {
    showLoading(true);
    try {
        const params = new URLSearchParams();
        const f = state.filters.inventory;
        if (f.search) params.set('search', f.search);
        if (f.category !== 'all') params.set('category', f.category);
        if (f.lowStock) params.set('lowStock', 'true');
        
        const p = state.pagination.inventory;
        params.set('page', p.page);
        params.set('perPage', p.perPage);
        
        const data = await apiRequest(`/inventory?${params.toString()}`);
        
        state.inventory = data.items || [];
        state.pagination.inventory.total = data.total || 0;
        
        renderInventoryTable();
        renderInventoryPagination();
        updateInventoryStats();
    } catch (error) {
        showNotification(`Eroare la încărcarea inventarului: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

function renderInventoryTable() {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;
    
    if (state.inventory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">Nu există produse în inventar.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = state.inventory.map(item => `
        <tr>
            <td>${escapeHtml(item.name || '')}</td>
            <td>${escapeHtml(item.category || '')}</td>
            <td class="${(item.quantity || 0) <= (item.minStock || 0) ? 'text-danger fw-bold' : ''}">
                ${item.quantity || 0}
            </td>
            <td>${item.unit || 'buc'}</td>
            <td>${formatCurrency(item.price)}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick="editInventoryItem(${item.id})" title="Editează">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteInventoryItem(${item.id})" title="Șterge">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function renderInventoryPagination() {
    const container = document.getElementById('inventory-pagination');
    if (!container) return;
    
    const p = state.pagination.inventory;
    const totalPages = Math.ceil(p.total / p.perPage) || 1;
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '<nav><ul class="pagination pagination-sm">';
    
    html += `<li class="page-item ${p.page <= 1 ? 'disabled' : ''}">
        <button class="page-link" onclick="changeInventoryPage(${p.page - 1})">&laquo;</button>
    </li>`;
    
    for (let i = 1; i <= totalPages; i++) {
        html += `<li class="page-item ${i === p.page ? 'active' : ''}">
            <button class="page-link" onclick="changeInventoryPage(${i})">${i}</button>
        </li>`;
    }
    
    html += `<li class="page-item ${p.page >= totalPages ? 'disabled' : ''}">
        <button class="page-link" onclick="changeInventoryPage(${p.page + 1})">&raquo;</button>
    </li>`;
    
    html += '</ul></nav>';
    container.innerHTML = html;
}

function updateInventoryStats() {
    const totalItems = document.getElementById('inventory-total-items');
    const lowStockItems = document.getElementById('inventory-low-stock');
    const totalValue = document.getElementById('inventory-total-value');
    
    if (totalItems) totalItems.textContent = state.inventory.length;
    
    const lowStock = state.inventory.filter(item => (item.quantity || 0) <= (item.minStock || 0));
    if (lowStockItems) {
        lowStockItems.textContent = lowStock.length;
        lowStockItems.className = lowStock.length > 0 ? 'text-danger fw-bold' : '';
    }
    
    const value = state.inventory.reduce((sum, item) => sum + (item.quantity || 0) * (item.price || 0), 0);
    if (totalValue) totalValue.textContent = formatCurrency(value);
}

function changeInventoryPage(page) {
    state.pagination.inventory.page = page;
    loadInventory();
}

function applyInventoryFilters() {
    const searchInput = document.getElementById('inventory-search');
    const categorySelect = document.getElementById('inventory-category');
    const lowStockCheck = document.getElementById('inventory-low-stock');
    
    state.filters.inventory.search = searchInput ? searchInput.value : '';
    state.filters.inventory.category = categorySelect ? categorySelect.value : 'all';
    state.filters.inventory.lowStock = lowStockCheck ? lowStockCheck.checked : false;
    state.pagination.inventory.page = 1;
    
    loadInventory();
}

function resetInventoryFilters() {
    state.filters.inventory = { search: '', category: 'all', lowStock: false };
    state.pagination.inventory.page = 1;
    
    const searchInput = document.getElementById('inventory-search');
    const categorySelect = document.getElementById('inventory-category');
    const lowStockCheck = document.getElementById('inventory-low-stock');
    
    if (searchInput) searchInput.value = '';
    if (categorySelect) categorySelect.value = 'all';
    if (lowStockCheck) lowStockCheck.checked = false;
    
    loadInventory();
}

async function addInventoryItem(formData) {
    showLoading(true);
    try {
        await apiRequest('/inventory', {
            method: 'POST',
            body: formData
        });
        showNotification('Produs adăugat în inventar cu succes!', 'success');
        loadInventory();
    } catch (error) {
        showNotification(`Eroare la adăugare: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function editInventoryItem(id) {
    const item = state.inventory.find(i => i.id === id);
    if (!item) {
        showNotification('Produsul nu a fost găsit', 'error');
        return;
    }
    
    const modal = document.getElementById('inventory-modal');
    if (!modal) return;
    
    document.getElementById('inventory-modal-id').value = item.id || '';
    document.getElementById('inventory-modal-name').value = item.name || '';
    document.getElementById('inventory-modal-category').value = item.category || '';
    document.getElementById('inventory-modal-quantity').value = item.quantity || 0;
    document.getElementById('inventory-modal-min-stock').value = item.minStock || 0;
    document.getElementById('inventory-modal-unit').value = item.unit || 'buc';
    document.getElementById('inventory-modal-price').value = item.price || 0;
    
    modal.style.display = 'block';
}

async function deleteInventoryItem(id) {
    if (!confirm('Sigur doriți să ștergeți acest produs?')) return;
    
    showLoading(true);
    try {
        await apiRequest(`/inventory/${id}`, { method: 'DELETE' });
        showNotification('Produs șters cu succes!', 'success');
        loadInventory();
    } catch (error) {
        showNotification(`Eroare la ștergere: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function saveInventoryItem() {
    const id = document.getElementById('inventory-modal-id').value;
    const formData = {
        name: document.getElementById('inventory-modal-name').value,
        category: document.getElementById('inventory-modal-category').value,
        quantity: parseFloat(document.getElementById('inventory-modal-quantity').value) || 0,
        minStock: parseFloat(document.getElementById('inventory-modal-min-stock').value) || 0,
        unit: document.getElementById('inventory-modal-unit').value,
        price: parseFloat(document.getElementById('inventory-modal-price').value) || 0
    };
    
    if (!formData.name) {
        showNotification('Numele produsului este obligatoriu', 'error');
        return;
    }
    
    closeModal('inventory-modal');
    
    if (id) {
        showLoading(true);
        try {
            await apiRequest(`/inventory/${id}`, { method: 'PUT', body: formData });
            showNotification('Produs actualizat cu succes!', 'success');
            loadInventory();
        } catch (error) {
            showNotification(`Eroare la actualizare: ${error.message}`, 'error');
        } finally {
            showLoading(false);
        }
    } else {
        await addInventoryItem(formData);
    }
}

// ========== SUPPLIERS FUNCTIONS ==========
async function loadSuppliers() {
    showLoading(true);
    try {
        const params = new URLSearchParams();
        const f = state.filters.suppliers;
        if (f.search) params.set('search', f.search);
        if (f.status !== 'all') params.set('status', f.status);
        
        const p = state.pagination.suppliers;
        params.set('page', p.page);
        params.set('perPage', p.perPage);
        
        const data = await apiRequest(`/suppliers?${params.toString()}`);
        
        state.suppliers = data.items || [];
        state.pagination.suppliers.total = data.total || 0;
        
        renderSuppliersTable();
        renderSuppliersPagination();
        updateSuppliersStats();
    } catch (error) {
        showNotification(`Eroare la încărcarea furnizorilor: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

function renderSuppliersTable() {
    const tbody = document.getElementById('suppliers-table-body');
    if (!tbody) return;
    
    if (state.suppliers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">Nu există furnizori.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = state.suppliers.map(supplier => `
        <tr>
            <td>${escapeHtml(supplier.name || '')}</td>
            <td>${escapeHtml(supplier.contactPerson || '-')}</td>
            <td>${escapeHtml(supplier.email || '-')}</td>
            <td>${escapeHtml(supplier.phone || '-')}</td>
            <td>
                <span class="badge ${supplier.isActive ? 'bg-success' : 'bg-secondary'}">
                    ${supplier.isActive ? 'Activ' : 'Inactiv'}
                </span>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick="editSupplier(${supplier.id})" title="Editează">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteSupplier(${supplier.id})" title="Șterge">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function renderSuppliersPagination() {
    const container = document.getElementById('suppliers-pagination');
    if (!container) return;
    
    const p = state.pagination.suppliers;
    const totalPages = Math.ceil(p.total / p.perPage) || 1;
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '<nav><ul class="pagination pagination-sm">';
    
    html += `<li class="page-item ${p.page <= 1 ? 'disabled' : ''}">
        <button class="page-link" onclick="changeSuppliersPage(${p.page - 1})">&laquo;</button>
    </li>`;
    
    for (let i = 1; i <= totalPages; i++) {
        html += `<li class="page-item ${i === p.page ? 'active' : ''}">
            <button class="page-link" onclick="changeSuppliersPage(${i})">${i}</button>
        </li>`;
    }
    
    html += `<li class="page-item ${p.page >= totalPages ? 'disabled' : ''}">
        <button class="page-link" onclick="changeSuppliersPage(${p.page + 1})">&raquo;</button>
    </li>`;
    
    html += '</ul></nav>';
    container.innerHTML = html;
}

function updateSuppliersStats() {
    const total = document.getElementById('suppliers-total');
    const active = document.getElementById('suppliers-active');
    const inactive = document.getElementById('suppliers-inactive');
    
    if (total) total.textContent = state.suppliers.length;
    if (active) active.textContent = state.suppliers.filter(s => s.isActive).length;
    if (inactive) inactive.textContent = state.suppliers.filter(s => !s.isActive).length;
}

function changeSuppliersPage(page) {
    state.pagination.suppliers.page = page;
    loadSuppliers();
}

function applySuppliersFilters() {
    const searchInput = document.getElementById('suppliers-search');
    const statusSelect = document.getElementById('suppliers-status');
    
    state.filters.suppliers.search = searchInput ? searchInput.value : '';
    state.filters.suppliers.status = statusSelect ? statusSelect.value : 'all';
    state.pagination.suppliers.page = 1;
    
    loadSuppliers();
}

function resetSuppliersFilters() {
    state.filters.suppliers = { search: '', status: 'all' };
    state.pagination.suppliers.page = 1;
    
    const searchInput = document.getElementById('suppliers-search');
    const statusSelect = document.getElementById('suppliers-status');
    
    if (searchInput) searchInput.value = '';
    if (statusSelect) statusSelect.value = 'all';
    
    loadSuppliers();
}

async function addSupplier(formData) {
    showLoading(true);
    try {
        await apiRequest('/suppliers', {
            method: 'POST',
            body: formData
        });
        showNotification('Furnizor adăugat cu succes!', 'success');
        loadSuppliers();
    } catch (error) {
        showNotification(`Eroare la adăugare: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function editSupplier(id) {
    const supplier = state.suppliers.find(s => s.id === id);
    if (!supplier) {
        showNotification('Furnizorul nu a fost găsit', 'error');
        return;
    }
    
    const modal = document.getElementById('supplier-modal');
    if (!modal) return;
    
    document.getElementById('supplier-modal-id').value = supplier.id || '';
    document.getElementById('supplier-modal-name').value = supplier.name || '';
    document.getElementById('supplier-modal-contact').value = supplier.contactPerson || '';
    document.getElementById('supplier-modal-email').value = supplier.email || '';
    document.getElementById('supplier-modal-phone').value = supplier.phone || '';
    document.getElementById('supplier-modal-address').value = supplier.address || '';
    document.getElementById('supplier-modal-active').checked = supplier.isActive !== false;
    
    modal.style.display = 'block';
}

async function deleteSupplier(id) {
    if (!confirm('Sigur doriți să ștergeți acest furnizor?')) return;
    
    showLoading(true);
    try {
        await apiRequest(`/suppliers/${id}`, { method: 'DELETE' });
        showNotification('Furnizor șters cu succes!', 'success');
        loadSuppliers();
    } catch (error) {
        showNotification(`Eroare la ștergere: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function saveSupplier() {
    const id = document.getElementById('supplier-modal-id').value;
    const formData = {
        name: document.getElementById('supplier-modal-name').value,
        contactPerson: document.getElementById('supplier-modal-contact').value,
        email: document.getElementById('supplier-modal-email').value,
        phone: document.getElementById('supplier-modal-phone').value,
        address: document.getElementById('supplier-modal-address').value,
        isActive: document.getElementById('supplier-modal-active').checked
    };
    
    if (!formData.name) {
        showNotification('Numele furnizorului este obligatoriu', 'error');
        return;
    }
    
    closeModal('supplier-modal');
    
    if (id) {
        showLoading(true);
        try {
            await apiRequest(`/suppliers/${id}`, { method: 'PUT', body: formData });
            showNotification('Furnizor actualizat cu succes!', 'success');
            loadSuppliers();
        } catch (error) {
            showNotification(`Eroare la actualizare: ${error.message}`, 'error');
        } finally {
            showLoading(false);
        }
    } else {
        await addSupplier(formData);
    }
}

// ========== DELIVERIES FUNCTIONS ==========
async function loadDeliveries() {
    showLoading(true);
    try {
        const params = new URLSearchParams();
        const f = state.filters.deliveries;
        if (f.search) params.set('search', f.search);
        if (f.status !== 'all') params.set('status', f.status);
        if (f.dateFrom) params.set('dateFrom', f.dateFrom);
        if (f.dateTo) params.set('dateTo', f.dateTo);
        
        const p = state.pagination.deliveries;
        params.set('page', p.page);
        params.set('perPage', p.perPage);
        
        const data = await apiRequest(`/deliveries?${params.toString()}`);
        
        state.deliveries = data.items || [];
        state.pagination.deliveries.total = data.total || 0;
        
        renderDeliveriesTable();
        renderDeliveriesPagination();
        updateDeliveriesStats();
    } catch (error) {
        showNotification(`Eroare la încărcarea livrărilor: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

function renderDeliveriesTable() {
    const tbody = document.getElementById('deliveries-table-body');
    if (!tbody) return;
    
    if (state.deliveries.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">Nu există livrări.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = state.deliveries.map(delivery => `
        <tr>
            <td>${escapeHtml(delivery.supplierName || '-')}</td>
            <td>${formatDate(delivery.deliveryDate)}</td>
            <td>${escapeHtml(delivery.productName || '-')}</td>
            <td>${delivery.quantity || 0} ${escapeHtml(delivery.unit || 'buc')}</td>
            <td>
                <span class="badge ${getDeliveryStatusBadge(delivery.status)}">
                    ${getDeliveryStatusLabel(delivery.status)}
                </span>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick="editDelivery(${delivery.id})" title="Editează">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteDelivery(${delivery.id})" title="Șterge">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function getDeliveryStatusBadge(status) {
    const badges = {
        pending: 'bg-warning text-dark',
        confirmed: 'bg-info',
        in_transit: 'bg-primary',
        delivered: 'bg-success',
        cancelled: 'bg-danger'
    };
    return badges[status] || 'bg-secondary';
}

function getDeliveryStatusLabel(status) {
    const labels = {
        pending: 'În așteptare',
        confirmed: 'Confirmată',
        in_transit: 'În tranzit',
        delivered: 'Livrată',
        cancelled: 'Anulată'
    };
    return labels[status] || status;
}

function renderDeliveriesPagination() {
    const container = document.getElementById('deliveries-pagination');
    if (!container) return;
    
    const p = state.pagination.deliveries;
    const totalPages = Math.ceil(p.total / p.perPage) || 1;
    
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    
    let html = '<nav><ul class="pagination pagination-sm">';
    
    html += `<li class="page-item ${p.page <= 1 ? 'disabled' : ''}">
        <button class="page-link" onclick="changeDeliveriesPage(${p.page - 1})">&laquo;</button>
    </li>`;
    
    for (let i = 1; i <= totalPages; i++) {
        html += `<li class="page-item ${i === p.page ? 'active' : ''}">
            <button class="page-link" onclick="changeDeliveriesPage(${i})">${i}</button>
        </li>`;
    }
    
    html += `<li class="page-item ${p.page >= totalPages ? 'disabled' : ''}">
        <button class="page-link" onclick="changeDeliveriesPage(${p.page + 1})">&raquo;</button>
    </li>`;
    
    html += '</ul></nav>';
    container.innerHTML = html;
}

function updateDeliveriesStats() {
    const total = document.getElementById('deliveries-total');
    const pending = document.getElementById('deliveries-pending');
    const delivered = document.getElementById('deliveries-delivered');
    
    if (total) total.textContent = state.deliveries.length;
    if (pending) pending.textContent = state.deliveries.filter(d => d.status === 'pending' || d.status === 'confirmed').length;
    if (delivered) delivered.textContent = state.deliveries.filter(d => d.status === 'delivered').length;
}

function changeDeliveriesPage(page) {
    state.pagination.deliveries.page = page;
    loadDeliveries();
}

function applyDeliveriesFilters() {
    const searchInput = document.getElementById('deliveries-search');
    const statusSelect = document.getElementById('deliveries-status');
    const dateFrom = document.getElementById('deliveries-date-from');
    const dateTo = document.getElementById('deliveries-date-to');
    
    state.filters.deliveries.search = searchInput ? searchInput.value : '';
    state.filters.deliveries.status = statusSelect ? statusSelect.value : 'all';
    state.filters.deliveries.dateFrom = dateFrom ? dateFrom.value : '';
    state.filters.deliveries.dateTo = dateTo ? dateTo.value : '';
    state.pagination.deliveries.page = 1;
    
    loadDeliveries();
}

function resetDeliveriesFilters() {
    state.filters.deliveries = { search: '', status: 'all', dateFrom: '', dateTo: '' };
    state.pagination.deliveries.page = 1;
    
    const searchInput = document.getElementById('deliveries-search');
    const statusSelect = document.getElementById('deliveries-status');
    const dateFrom = document.getElementById('deliveries-date-from');
    const dateTo = document.getElementById('deliveries-date-to');
    
    if (searchInput) searchInput.value = '';
    if (statusSelect) statusSelect.value = 'all';
    if (dateFrom) dateFrom.value = '';
    if (dateTo) dateTo.value = '';
    
    loadDeliveries();
}

async function saveDelivery() {
    const id = document.getElementById('delivery-modal-id').value;
    const formData = {
        supplierId: parseInt(document.getElementById('delivery-modal-supplier').value) || null,
        productId: parseInt(document.getElementById('delivery-modal-product').value) || null,
        quantity: parseFloat(document.getElementById('delivery-modal-quantity').value) || 0,
        deliveryDate: document.getElementById('delivery-modal-date').value || null,
        status: document.getElementById('delivery-modal-status').value || 'pending',
        notes: document.getElementById('delivery-modal-notes').value || ''
    };
    
    if (!formData.supplierId || !formData.productId || !formData.quantity) {
        showNotification('Toate câmpurile obligatorii trebuie completate', 'error');
        return;
    }
    
    closeModal('delivery-modal');
    showLoading(true);
    
    try {
        const method = id ? 'PUT' : 'POST';
        const endpoint = id ? `/deliveries/${id}` : '/deliveries';
        await apiRequest(endpoint, { method, body: formData });
        showNotification(id ? 'Livrare actualizată cu succes!' : 'Livrare adăugată cu succes!', 'success');
        loadDeliveries();
    } catch (error) {
        showNotification(`Eroare la salvare: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function editDelivery(id) {
    const delivery = state.deliveries.find(d => d.id === id);
    if (!delivery) {
        showNotification('Livrarea nu a fost găsită', 'error');
        return;
    }
    
    const modal = document.getElementById('delivery-modal');
    if (!modal) return;
    
    document.getElementById('delivery-modal-id').value = delivery.id || '';
    document.getElementById('delivery-modal-supplier').value = delivery.supplierId || '';
    document.getElementById('delivery-modal-product').value = delivery.productId || '';
    document.getElementById('delivery-modal-quantity').value = delivery.quantity || 0;
    document.getElementById('delivery-modal-date').value = delivery.deliveryDate ? delivery.deliveryDate.split('T')[0] : '';
    document.getElementById('delivery-modal-status').value = delivery.status || 'pending';
    document.getElementById('delivery-modal-notes').value = delivery.notes || '';
    
    modal.style.display = 'block';
}

async function deleteDelivery(id) {
    if (!confirm('Sigur doriți să ștergeți această livrare?')) return;
    
    showLoading(true);
    try {
        await apiRequest(`/deliveries/${id}`, { method: 'DELETE' });
        showNotification('Livrare ștearsă cu succes!', 'success');
        loadDeliveries();
    } catch (error) {
        showNotification(`Eroare la ștergere: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

// ========== ORDERS FUNCTIONS ==========
async function loadOrders() {
    showLoading(true);
    try {
        const params = new URLSearchParams();
        const f = state.filters.orders;
        if