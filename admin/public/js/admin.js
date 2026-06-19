/**
 * ============================================================
 * admin/public/js/admin.js - Panou Administrare GastroHub
 * ============================================================
 *
 * JavaScript pentru interfața de administrare a platformei GastroHub.
 * Responsabilități principale:
 *  1. Navigare între secțiunile admin (Dashboard, Tenanți, Setări, Audit)
 *  2. Gestionare tenanți (listare, creare, editare, ștergere)
 *  3. Statistici globale (venituri, utilizatori, locații active)
 *  4. Gestionare utilizatori admin (creare, atribuire roluri)
 *  5. Jurnal de audit
 *  6. Configurare platformă
 *
 * Dependințe: Funcțiile showToast, formatCurrency, formatDate din layout.ejs
 *
 * ============================================================
 */

// ===================================================================
// STARE GLOBALĂ
// ===================================================================

const AdminState = {
  currentView: 'dashboard',
  tenants: [],
  users: [],
  auditLogs: [],
  globalStats: null,
  pagination: {
    tenants: { page: 1, perPage: 10, total: 0 },
    users: { page: 1, perPage: 10, total: 0 },
    audit: { page: 1, perPage: 20, total: 0 },
  },
  filters: {
    tenants: { search: '', status: 'all', plan: 'all' },
    users: { search: '', role: 'all' },
    audit: { search: '', action: 'all', dateFrom: '', dateTo: '' },
  },
};

// ===================================================================
// API HELPERS
// ===================================================================

const ADMIN_API = '/api/admin';

/**
 * Efectuează o cerere autentificată la API-ul de administrare.
 *
 * @param {string} endpoint - Calea endpoint (ex: '/tenants')
 * @param {Object} options - Opțiuni fetch (method, body, headers)
 * @returns {Promise<Object>} Răspunsul JSON
 */
async function adminApiRequest(endpoint, options = {}) {
  const config = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
    credentials: 'same-origin',
    ...options,
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(`${ADMIN_API}${endpoint}`, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Eroare necunoscută' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// ===================================================================
// NAVIGARE
// ===================================================================

/**
 * Navighează la o secțiune specifică din panoul admin.
 *
 * @param {string} view - Numele secțiunii (dashboard, tenants, users, settings, audit)
 */
function adminNavigate(view) {
  AdminState.currentView = view;

  // Ascunde toate secțiunile
  document.querySelectorAll('.admin-view').forEach(el => {
    el.classList.remove('admin-view--active');
    el.style.display = 'none';
  });

  // Afișează secțiunea target
  const targetView = document.getElementById(`admin-view-${view}`);
  if (targetView) {
    targetView.classList.add('admin-view--active');
    targetView.style.display = 'block';
  }

  // Actualizează link-ul activ din sidebar/nav
  document.querySelectorAll('.admin-nav-link').forEach(el => el.classList.remove('active'));
  const activeLink = document.querySelector(`.admin-nav-link[data-view="${view}"]`);
  if (activeLink) activeLink.classList.add('active');

  // Încarcă datele specifice secțiunii
  switch (view) {
    case 'dashboard':
      loadAdminDashboard();
      break;
    case 'tenants':
      loadTenants();
      break;
    case 'users':
      loadAdminUsers();
      break;
    case 'audit':
      loadAuditLogs();
      break;
    case 'settings':
      loadPlatformSettings();
      break;
  }
}

/**
 * Inițializează navigarea la încărcarea paginii.
 */
document.addEventListener('DOMContentLoaded', function () {
  // Determină view-ul inițial din URL hash sau default
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  adminNavigate(hash);

  // Ascultă modificările hash-ului
  window.addEventListener('hashchange', function () {
    const view = window.location.hash.replace('#', '') || 'dashboard';
    adminNavigate(view);
  });
});

// ===================================================================
// DASHBOARD ADMIN
// ===================================================================

/**
 * Încarcă datele pentru dashboard-ul admin.
 */
async function loadAdminDashboard() {
  showLoading(true);
  try {
    const data = await adminApiRequest('/dashboard');

    AdminState.globalStats = data.data || data;

    // Actualizează cardurile de statistici
    updateAdminStatCards(AdminState.globalStats);

    // Actualizează graficele (dacă există elemente grafice)
    renderAdminCharts(AdminState.globalStats);

    // Actualizează lista cu tenanți activi
    renderActiveTenantsList(AdminState.globalStats.recentTenants || []);

    // Actualizează activitatea recentă
    renderRecentActivity(AdminState.globalStats.recentActivity || []);

  } catch (error) {
    showToast(`Eroare la încărcarea dashboard-ului: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Actualizează cardurile de statistici din dashboard.
 *
 * @param {Object} stats - Datele cu statistici globale
 */
function updateAdminStatCards(stats) {
  const totalRevenue = document.getElementById('admin-stat-revenue');
  const totalUsers = document.getElementById('admin-stat-users');
  const totalTenants = document.getElementById('admin-stat-tenants');
  const activeLocations = document.getElementById('admin-stat-locations');
  const monthlyGrowth = document.getElementById('admin-stat-growth');
  const activeSubscriptions = document.getElementById('admin-stat-subscriptions');

  if (totalRevenue) {
    const revenue = stats.totalRevenue || stats.totalRevenueAll || 0;
    totalRevenue.textContent = typeof formatCurrency === 'function'
      ? formatCurrency(revenue)
      : `${Number(revenue).toFixed(2)} lei`;
  }

  if (totalUsers) {
    totalUsers.textContent = stats.totalUsers || 0;
  }

  if (totalTenants) {
    totalTenants.textContent = stats.totalTenants || 0;
  }

  if (activeLocations) {
    activeLocations.textContent = stats.activeLocations || 0;
  }

  if (monthlyGrowth) {
    monthlyGrowth.textContent = stats.monthlyGrowth != null
      ? `${stats.monthlyGrowth > 0 ? '+' : ''}${stats.monthlyGrowth}%`
      : '0%';
  }

  if (activeSubscriptions) {
    activeSubscriptions.textContent = stats.activeSubscriptions || 0;
  }
}

/**
 * Inițializează și actualizează graficele din dashboard.
 * Folosește Canvas API nativ pentru a evita dependințe externe.
 *
 * @param {Object} stats - Datele statistice
 */
function renderAdminCharts(stats) {
  const revenueChart = document.getElementById('admin-chart-revenue');
  const tenantChart = document.getElementById('admin-chart-tenants');

  if (revenueChart && stats.revenueHistory) {
    drawSimpleBarChart(revenueChart, stats.revenueHistory, 'Venituri lunare');
  }

  if (tenantChart && stats.tenantGrowth) {
    drawSimpleBarChart(tenantChart, stats.tenantGrowth, 'Creștere tenanți');
  }
}

/**
 * Desenează o diagramă cu bare simplă pe un canvas.
 *
 * @param {HTMLCanvasElement} canvas - Elementul canvas
 * @param {Array<{label: string, value: number}>} data - Datele pentru diagramă
 * @param {string} title - Titlul diagramei
 */
function drawSimpleBarChart(canvas, data, title) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width || canvas.clientWidth;
  const height = canvas.height || canvas.clientHeight;
  const padding = { top: 30, right: 20, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Curăță canvasul
  ctx.clearRect(0, 0, width, height);

  if (!data || data.length === 0) {
    ctx.fillStyle = '#999';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Nu există date suficiente', width / 2, height / 2);
    return;
  }

  const maxValue = Math.max(...data.map(d => d.value), 1);
  const barWidth = Math.min(chartWidth / data.length - 10, 40);
  const barSpacing = (chartWidth - barWidth * data.length) / (data.length + 1);

  // Desenează titlul
  ctx.fillStyle = '#333';
  ctx.font = 'bold 13px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, 18);

  // Desenează liniile de grid și axa Y
  ctx.strokeStyle = '#eee';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    // Etichetele axei Y
    const value = Math.round((maxValue / 4) * (4 - i));
    ctx.fillStyle = '#999';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(value.toString(), padding.left - 8, y + 4);
  }

  // Desenează barele
  data.forEach((item, index) => {
    const barHeight = (item.value / maxValue) * chartHeight;
    const x = padding.left + barSpacing + index * (barWidth + barSpacing);
    const y = padding.top + chartHeight - barHeight;

    // Gradient pentru bară
    const gradient = ctx.createLinearGradient(x, y, x, padding.top + chartHeight);
    gradient.addColorStop(0, '#e85d04');
    gradient.addColorStop(1, '#ff7b1a');
    ctx.fillStyle = gradient;

    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
    ctx.fill();

    // Eticheta sub bară
    ctx.fillStyle = '#666';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(item.label, x + barWidth / 2, padding.top + chartHeight + 18);

    // Valoarea deasupra barei
    if (item.value > 0) {
      ctx.fillStyle = '#333';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillText(item.value.toString(), x + barWidth / 2, y - 6);
    }
  });
}

/**
 * Afișează lista cu tenanți activi recent.
 *
 * @param {Array<Object>} tenants - Lista tenanților
 */
function renderActiveTenantsList(tenants) {
  const container = document.getElementById('admin-active-tenants');
  if (!container) return;

  if (!tenants || tenants.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-building"></i><p>Niciun tenant activ momentan.</p></div>';
    return;
  }

  container.innerHTML = tenants.map(tenant => `
    <div class="admin-tenant-item" onclick="adminNavigate('tenants'); showTenantDetail('${tenant._id || tenant.id}')">
      <div class="admin-tenant-icon">
        <i class="fas fa-store"></i>
      </div>
      <div class="admin-tenant-info">
        <div class="admin-tenant-name">${escapeHtml(tenant.name || 'N/A')}</div>
        <div class="admin-tenant-meta">
          <span class="badge ${tenant.status === 'active' ? 'badge-active' : 'badge-inactive'}">
            ${tenant.status === 'active' ? 'Activ' : 'Inactiv'}
          </span>
          <span>${tenant.plan || 'N/A'}</span>
          <span>${tenant.usersCount || 0} utilizatori</span>
        </div>
      </div>
      <div class="admin-tenant-revenue">
        ${typeof formatCurrency === 'function' ? formatCurrency(tenant.revenue || 0) : `${Number(tenant.revenue || 0).toFixed(2)} lei`}
      </div>
    </div>
  `).join('');
}

/**
 * Afișează activitatea recentă în platformă.
 *
 * @param {Array<Object>} activities - Lista activităților
 */
function renderRecentActivity(activities) {
  const container = document.getElementById('admin-recent-activity');
  if (!container) return;

  if (!activities || activities.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>Nicio activitate recentă.</p></div>';
    return;
  }

  container.innerHTML = activities.map(activity => `
    <div class="admin-activity-item">
      <div class="admin-activity-icon ${activity.type || 'info'}">
        <i class="fas fa-${getActivityIcon(activity.action || activity.type)}"></i>
      </div>
      <div class="admin-activity-content">
        <div class="admin-activity-text">${escapeHtml(activity.description || activity.message || 'Acțiune necunoscută')}</div>
        <div class="admin-activity-time">${typeof formatDate === 'function' ? formatDate(activity.createdAt || activity.timestamp) : (activity.createdAt || '')}</div>
      </div>
    </div>
  `).join('');
}

/**
 * Returnează iconița potrivită pentru un tip de activitate.
 *
 * @param {string} action - Tipul acțiunii
 * @returns {string} Numele iconiței Font Awesome
 */
function getActivityIcon(action) {
  const iconMap = {
    'create': 'plus-circle',
    'update': 'edit',
    'delete': 'trash',
    'login': 'sign-in-alt',
    'logout': 'sign-out-alt',
    'payment': 'credit-card',
    'subscription': 'crown',
    'error': 'exclamation-triangle',
    'warning': 'exclamation-circle',
    'info': 'info-circle',
    'user_create': 'user-plus',
    'tenant_create': 'building',
    'tenant_update': 'building',
    'order': 'receipt',
    'reservation': 'calendar-check',
  };
  return iconMap[action] || 'circle';
}

// ===================================================================
// GESTIONARE TENANȚI
// ===================================================================

/**
 * Încarcă lista de tenanți cu filtre și paginare.
 */
async function loadTenants() {
  showLoading(true);
  try {
    const params = new URLSearchParams();
    const f = AdminState.filters.tenants;
    if (f.search) params.set('search', f.search);
    if (f.status !== 'all') params.set('status', f.status);
    if (f.plan !== 'all') params.set('plan', f.plan);

    const p = AdminState.pagination.tenants;
    params.set('page', p.page);
    params.set('perPage', p.perPage);

    const response = await adminApiRequest(`/tenants?${params.toString()}`);
    const data = response.data || response;

    AdminState.tenants = data.items || data.tenants || [];
    AdminState.pagination.tenants.total = data.total || AdminState.tenants.length;

    renderTenantsTable();
    renderTenantsPagination();
    updateTenantsStats();
  } catch (error) {
    showToast(`Eroare la încărcarea tenanților: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Afișează tabelul cu tenanți.
 */
function renderTenantsTable() {
  const tbody = document.getElementById('admin-tenants-table-body');
  if (!tbody) return;

  if (AdminState.tenants.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nu există tenanți.</td></tr>';
    return;
  }

  tbody.innerHTML = AdminState.tenants.map(tenant => `
    <tr>
      <td>
        <strong>${escapeHtml(tenant.name || 'N/A')}</strong>
        <br><small class="text-muted">${escapeHtml(tenant.subdomain || tenant.domain || '-')}</small>
      </td>
      <td>${escapeHtml(tenant.ownerEmail || tenant.email || '-')}</td>
      <td>${tenant.usersCount || 0}</td>
      <td>
        <span class="badge ${tenant.status === 'active' ? 'bg-success' : tenant.status === 'suspended' ? 'bg-warning text-dark' : 'bg-secondary'}">
          ${tenant.status === 'active' ? 'Activ' : tenant.status === 'suspended' ? 'Suspendat' : 'Inactiv'}
        </span>
      </td>
      <td>${escapeHtml(tenant.plan || '-')}</td>
      <td>${typeof formatCurrency === 'function' ? formatCurrency(tenant.revenue || 0) : `${Number(tenant.revenue || 0).toFixed(2)} lei`}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary" onclick="editTenant('${tenant._id || tenant.id}')" title="Editează">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteTenant('${tenant._id || tenant.id}')" title="Șterge">
          <i class="fas fa-trash"></i>
        </button>
        <button class="btn btn-sm btn-outline-info" onclick="showTenantDetail('${tenant._id || tenant.id}')" title="Detalii">
          <i class="fas fa-info-circle"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

/**
 * Afișează paginarea pentru lista de tenanți.
 */
function renderTenantsPagination() {
  const container = document.getElementById('admin-tenants-pagination');
  if (!container) return;

  const p = AdminState.pagination.tenants;
  const totalPages = Math.ceil(p.total / p.perPage) || 1;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '<nav><ul class="pagination pagination-sm justify-content-center">';

  html += `<li class="page-item ${p.page <= 1 ? 'disabled' : ''}">
    <button class="page-link" onclick="changeTenantsPage(${p.page - 1})" aria-label="Previous">
      <i class="fas fa-chevron-left"></i>
    </button>
  </li>`;

  let startPage = Math.max(1, p.page - 2);
  let endPage = Math.min(totalPages, p.page + 2);

  if (startPage > 1) {
    html += `<li class="page-item"><button class="page-link" onclick="changeTenantsPage(1)">1</button></li>`;
    if (startPage > 2) {
      html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<li class="page-item ${i === p.page ? 'active' : ''}">
      <button class="page-link" onclick="changeTenantsPage(${i})">${i}</button>
    </li>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
    }
    html += `<li class="page-item"><button class="page-link" onclick="changeTenantsPage(${totalPages})">${totalPages}</button></li>`;
  }

  html += `<li class="page-item ${p.page >= totalPages ? 'disabled' : ''}">
    <button class="page-link" onclick="changeTenantsPage(${p.page + 1})" aria-label="Next">
      <i class="fas fa-chevron-right"></i>
    </button>
  </li>`;

  html += '</ul></nav>';
  container.innerHTML = html;
}

/**
 * Actualizează statisticile rapide pentru tenanți.
 */
function updateTenantsStats() {
  const totalEl = document.getElementById('admin-tenants-total');
  const activeEl = document.getElementById('admin-tenants-active');
  const suspendedEl = document.getElementById('admin-tenants-suspended');

  if (totalEl) totalEl.textContent = AdminState.pagination.tenants.total || AdminState.tenants.length;
  if (activeEl) activeEl.textContent = AdminState.tenants.filter(t => t.status === 'active').length;
  if (suspendedEl) suspendedEl.textContent = AdminState.tenants.filter(t => t.status === 'suspended').length;
}

/**
 * Schimbă pagina pentru lista de tenanți.
 *
 * @param {number} page - Numărul paginii
 */
function changeTenantsPage(page) {
  AdminState.pagination.tenants.page = page;
  loadTenants();
}

/**
 * Aplică filtrele pentru lista de tenanți.
 */
function applyTenantsFilters() {
  const searchInput = document.getElementById('admin-tenants-search');
  const statusSelect = document.getElementById('admin-tenants-status');
  const planSelect = document.getElementById('admin-tenants-plan');

  AdminState.filters.tenants.search = searchInput ? searchInput.value.trim() : '';
  AdminState.filters.tenants.status = statusSelect ? statusSelect.value : 'all';
  AdminState.filters.tenants.plan = planSelect ? planSelect.value : 'all';
  AdminState.pagination.tenants.page = 1;

  loadTenants();
}

/**
 * Resetează filtrele pentru lista de tenanți.
 */
function resetTenantsFilters() {
  AdminState.filters.tenants = { search: '', status: 'all', plan: 'all' };
  AdminState.pagination.tenants.page = 1;

  const searchInput = document.getElementById('admin-tenants-search');
  const statusSelect = document.getElementById('admin-tenants-status');
  const planSelect = document.getElementById('admin-tenants-plan');

  if (searchInput) searchInput.value = '';
  if (statusSelect) statusSelect.value = 'all';
  if (planSelect) planSelect.value = 'all';

  loadTenants();
}

/**
 * Deschide modalul pentru crearea unui tenant nou.
 */
function showNewTenantForm() {
  const modal = document.getElementById('admin-tenant-modal');
  if (!modal) return;

  // Resetează formularul
  document.getElementById('tenant-modal-title').textContent = 'Tenant Nou';
  document.getElementById('tenant-modal-id').value = '';
  document.getElementById('tenant-modal-name').value = '';
  document.getElementById('tenant-modal-subdomain').value = '';
  document.getElementById('tenant-modal-email').value = '';
  document.getElementById('tenant-modal-plan').value = 'basic';
  document.getElementById('tenant-modal-status').value = 'active';
  document.getElementById('tenant-modal-notes').value = '';

  modal.classList.add('modal-overlay--active');
  modal.style.display = 'flex';
}

/**
 * Deschide modalul pentru editarea unui tenant existent.
 *
 * @param {string} tenantId - ID-ul tenantului
 */
function editTenant(tenantId) {
  const tenant = AdminState.tenants.find(t => (t._id || t.id) === tenantId);
  if (!tenant) {
    showToast('Tenantul nu a fost găsit', 'error');
    return;
  }

  const modal = document.getElementById('admin-tenant-modal');
  if (!modal) return;

  document.getElementById('tenant-modal-title').textContent = 'Editează Tenant';
  document.getElementById('tenant-modal-id').value = tenant._id || tenant.id || '';
  document.getElementById('tenant-modal-name').value = tenant.name || '';
  document.getElementById('tenant-modal-subdomain').value = tenant.subdomain || '';
  document.getElementById('tenant-modal-email').value = tenant.ownerEmail || tenant.email || '';
  document.getElementById('tenant-modal-plan').value = tenant.plan || 'basic';
  document.getElementById('tenant-modal-status').value = tenant.status || 'active';
  document.getElementById('tenant-modal-notes').value = tenant.notes || '';

  modal.classList.add('modal-overlay--active');
  modal.style.display = 'flex';
}

/**
 * Salvează un tenant (creare sau actualizare).
 */
async function saveTenant() {
  const id = document.getElementById('tenant-modal-id').value;
  const formData = {
    name: document.getElementById('tenant-modal-name').value.trim(),
    subdomain: document.getElementById('tenant-modal-subdomain').value.trim(),
    ownerEmail: document.getElementById('tenant-modal-email').value.trim(),
    plan: document.getElementById('tenant-modal-plan').value,
    status: document.getElementById('tenant-modal-status').value,
    notes: document.getElementById('tenant-modal-notes').value.trim(),
  };

  // Validări
  if (!formData.name) {
    showToast('Numele tenantului este obligatoriu', 'error');
    return;
  }

  if (!formData.subdomain) {
    showToast('Subdomeniul este obligatoriu', 'error');
    return;
  }

  if (!formData.ownerEmail) {
    showToast('Email-ul proprietarului este obligatoriu', 'error');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.ownerEmail)) {
    showToast('Email-ul proprietarului nu este valid', 'error');
    return;
  }

  if (!/^[a-z0-9-]+$/.test(formData.subdomain)) {
    showToast('Subdomeniul poate conține doar litere mici, cifre și cratime', 'error');
    return;
  }

  closeModal('admin-tenant-modal');
  showLoading(true);

  try {
    if (id) {
      await adminApiRequest(`/tenants/${id}`, { method: 'PUT', body: formData });
      showToast('Tenant actualizat cu succes!', 'success');
    } else {
      await adminApiRequest('/tenants', { method: 'POST', body: formData });
      showToast('Tenant creat cu succes!', 'success');
    }
    loadTenants();
  } catch (error) {
    showToast(`Eroare la salvarea tenantului: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Șterge un tenant după confirmare.
 *
 * @param {string} tenantId - ID-ul tenantului de șters
 */
async function deleteTenant(tenantId) {
  const tenant = AdminState.tenants.find(t => (t._id || t.id) === tenantId);

  if (!confirm(`Sigur doriți să ștergeți tenantul "${tenant ? tenant.name : ''}" și toate datele asociate?\nAceastă acțiune este ireversibilă!`)) {
    return;
  }

  const doubleConfirm = prompt(`Confirmați ștergerea definitivă a tenantului "${tenant ? tenant.name : ''}"? Tastați "DA" pentru a confirma:`);
  if (doubleConfirm !== 'DA') {
    showToast('Ștergerea a fost anulată.', 'info');
    return;
  }

  showLoading(true);
  try {
    await adminApiRequest(`/tenants/${tenantId}`, { method: 'DELETE' });
    showToast('Tenant șters cu succes!', 'success');
    loadTenants();
  } catch (error) {
    showToast(`Eroare la ștergerea tenantului: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Afișează detaliile unui tenant într-un modal.
 *
 * @param {string} tenantId - ID-ul tenantului
 */
async function showTenantDetail(tenantId) {
  showLoading(true);
  try {
    const response = await adminApiRequest(`/tenants/${tenantId}`);
    const tenant = response.data || response;

    const modal = document.getElementById('admin-tenant-detail-modal');
    if (!modal) {
      showToast('Modalul de detalii nu este disponibil', 'error');
      return;
    }

    document.getElementById('tenant-detail-name').textContent = tenant.name || 'N/A';
    document.getElementById('tenant-detail-subdomain').textContent = tenant.subdomain || '-';
    document.getElementById('tenant-detail-email').textContent = tenant.ownerEmail || '-';
    document.getElementById('tenant-detail-plan').textContent = tenant.plan || '-';
    document.getElementById('tenant-detail-status').textContent = tenant.status || '-';
    document.getElementById('tenant-detail-created').textContent = typeof formatDate === 'function'
      ? formatDate(tenant.createdAt)
      : (tenant.createdAt || '-');
    document.getElementById('tenant-detail-users').textContent = tenant.usersCount || 0;
    document.getElementById('tenant-detail-revenue').textContent = typeof formatCurrency === 'function'
      ? formatCurrency(tenant.revenue || 0)
      : `${Number(tenant.revenue || 0).toFixed(2)} lei`;
    document.getElementById('tenant-detail-notes').textContent = tenant.notes || '-';

    modal.classList.add('modal-overlay--active');
    modal.style.display = 'flex';
  } catch (error) {
    showToast(`Eroare la încărcarea detaliilor: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ===================================================================
// GESTIONARE UTILIZATORI ADMIN
// ===================================================================

/**
 * Încarcă lista de utilizatori admin.
 */
async function loadAdminUsers() {
  showLoading(true);
  try {
    const params = new URLSearchParams();
    const f = AdminState.filters.users;
    if (f.search) params.set('search', f.search);
    if (f.role !== 'all') params.set('role', f.role);

    const p = AdminState.pagination.users;
    params.set('page', p.page);
    params.set('perPage', p.perPage);

    const response = await adminApiRequest(`/users?${params.toString()}`);
    const data = response.data || response;

    AdminState.users = data.items || data.users || [];
    AdminState.pagination.users.total = data.total || AdminState.users.length;

    renderUsersTable();
    renderUsersPagination();
  } catch (error) {
    showToast(`Eroare la încărcarea utilizatorilor: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Afișează tabelul cu utilizatori.
 */
function renderUsersTable() {
  const tbody = document.getElementById('admin-users-table-body');
  if (!tbody) return;

  if (AdminState.users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Nu există utilizatori.</td></tr>';
    return;
  }

  tbody.innerHTML = AdminState.users.map(user => `
    <tr>
      <td>
        <div class="admin-user-avatar">${(user.email || '?').charAt(0).toUpperCase()}</div>
      </td>
      <td>
        <strong>${escapeHtml(user.name || user.email || 'N/A')}</strong>
        <br><small class="text-muted">${escapeHtml(user.email || '')}</small>
      </td>
      <td>
        <span class="badge bg-${getRoleBadgeColor(user.role)}">${escapeHtml(user.role || 'N/A')}</span>
      </td>
      <td>${escapeHtml(user.tenantName || user.tenantId || '-')}</td>
      <td>${user.isActive !== false
        ? '<span class="badge bg-success">Activ</span>'
        : '<span class="badge bg-secondary">Inactiv</span>'}
      </td>
      <td>
        <button class="btn btn-sm btn-outline-primary" onclick="editAdminUser('${user._id || user.id}')" title="Editează">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteAdminUser('${user._id || user.id}')" title="Șterge">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

/**
 * Returnează culoarea badge-ului pentru un rol.
 *
 * @param {string} role - Rolul utilizatorului
 * @returns {string} Clasa de culoare Bootstrap
 */
function getRoleBadgeColor(role) {
  const colors = {
    'super_admin': 'danger',
    'owner': 'warning',
    'manager': 'primary',
    'recepție': 'info',
    'ospătar': 'success',
    'bucătar': 'secondary',
    'client': 'light',
  };
  return colors[role] || 'dark';
}

/**
 * Afișează paginarea pentru lista de utilizatori.
 */
function renderUsersPagination() {
  const container = document.getElementById('admin-users-pagination');
  if (!container) return;

  const p = AdminState.pagination.users;
  const totalPages = Math.ceil(p.total / p.perPage) || 1;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '<nav><ul class="pagination pagination-sm">';
  html += `<li class="page-item ${p.page <= 1 ? 'disabled' : ''}">
    <button class="page-link" onclick="changeUsersPage(${p.page - 1})">&laquo;</button>
  </li>`;

  for (let i = 1; i <= totalPages; i++) {
    html += `<li class="page-item ${i === p.page ? 'active' : ''}">
      <button class="page-link" onclick="changeUsersPage(${i})">${i}</button>
    </li>`;
  }

  html += `<li class="page-item ${p.page >= totalPages ? 'disabled' : ''}">
    <button class="page-link" onclick="changeUsersPage(${p.page + 1})">&raquo;</button>
  </li>`;
  html += '</ul></nav>';
  container.innerHTML = html;
}

/**
 * Schimbă pagina pentru lista de utilizatori.
 *
 * @param {number} page - Numărul paginii
 */
function changeUsersPage(page) {
  AdminState.pagination.users.page = page;
  loadAdminUsers();
}

/**
 * Aplică filtrele pentru utilizatori.
 */
function applyUsersFilters() {
  const searchInput = document.getElementById('admin-users-search');
  const roleSelect = document.getElementById('admin-users-role');

  AdminState.filters.users.search = search