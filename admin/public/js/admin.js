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

  AdminState.filters.users.search = searchInput ? searchInput.value.trim() : '';
  AdminState.filters.users.role = roleSelect ? roleSelect.value : 'all';
  AdminState.pagination.users.page = 1;

  loadAdminUsers();
}

/**
 * Resetează filtrele pentru utilizatori.
 */
function resetUsersFilters() {
  AdminState.filters.users = { search: '', role: 'all' };
  AdminState.pagination.users.page = 1;

  const searchInput = document.getElementById('admin-users-search');
  const roleSelect = document.getElementById('admin-users-role');

  if (searchInput) searchInput.value = '';
  if (roleSelect) roleSelect.value = 'all';

  loadAdminUsers();
}

/**
 * Deschide modalul pentru crearea unui utilizator nou.
 */
function showNewUserForm() {
  const modal = document.getElementById('admin-user-modal');
  if (!modal) return;

  document.getElementById('user-modal-title').textContent = 'Utilizator Nou';
  document.getElementById('user-modal-id').value = '';
  document.getElementById('user-modal-name').value = '';
  document.getElementById('user-modal-email').value = '';
  document.getElementById('user-modal-password').value = '';
  document.getElementById('user-modal-role').value = 'client';
  document.getElementById('user-modal-tenant').value = '';

  modal.classList.add('modal-overlay--active');
  modal.style.display = 'flex';
}

/**
 * Deschide modalul pentru editarea unui utilizator.
 *
 * @param {string} userId - ID-ul utilizatorului
 */
async function editAdminUser(userId) {
  const user = AdminState.users.find(u => (u._id || u.id) === userId);
  if (!user) {
    showToast('Utilizatorul nu a fost găsit', 'error');
    return;
  }

  const modal = document.getElementById('admin-user-modal');
  if (!modal) return;

  document.getElementById('user-modal-title').textContent = 'Editează Utilizator';
  document.getElementById('user-modal-id').value = user._id || user.id || '';
  document.getElementById('user-modal-name').value = user.name || '';
  document.getElementById('user-modal-email').value = user.email || '';
  document.getElementById('user-modal-password').value = '';
  document.getElementById('user-modal-role').value = user.role || 'client';
  document.getElementById('user-modal-tenant').value = user.tenantId || '';

  modal.classList.add('modal-overlay--active');
  modal.style.display = 'flex';
}

/**
 * Salvează un utilizator (creare sau actualizare).
 */
async function saveAdminUser() {
  const id = document.getElementById('user-modal-id').value;
  const formData = {
    name: document.getElementById('user-modal-name').value.trim(),
    email: document.getElementById('user-modal-email').value.trim(),
    password: document.getElementById('user-modal-password').value,
    role: document.getElementById('user-modal-role').value,
    tenantId: document.getElementById('user-modal-tenant').value.trim() || undefined,
  };

  if (!formData.email) {
    showToast('Email-ul este obligatoriu', 'error');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
    showToast('Email-ul nu este valid', 'error');
    return;
  }

  if (!id && !formData.password) {
    showToast('Parola este obligatorie pentru utilizatorii noi', 'error');
    return;
  }

  closeModal('admin-user-modal');
  showLoading(true);

  try {
    if (id) {
      const updateData = { ...formData };
      if (!updateData.password) delete updateData.password;
      await adminApiRequest(`/users/${id}`, { method: 'PUT', body: updateData });
      showToast('Utilizator actualizat cu succes!', 'success');
    } else {
      await adminApiRequest('/users', { method: 'POST', body: formData });
      showToast('Utilizator creat cu succes!', 'success');
    }
    loadAdminUsers();
  } catch (error) {
    showToast(`Eroare la salvarea utilizatorului: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Șterge un utilizator după confirmare.
 *
 * @param {string} userId - ID-ul utilizatorului
 */
async function deleteAdminUser(userId) {
  const user = AdminState.users.find(u => (u._id || u.id) === userId);
  if (!confirm(`Sigur doriți să ștergeți utilizatorul "${user ? (user.name || user.email) : ''}"?\nAceastă acțiune este ireversibilă!`)) {
    return;
  }

  showLoading(true);
  try {
    await adminApiRequest(`/users/${userId}`, { method: 'DELETE' });
    showToast('Utilizator șters cu succes!', 'success');
    loadAdminUsers();
  } catch (error) {
    showToast(`Eroare la ștergerea utilizatorului: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// ===================================================================
// JURNAL AUDIT
// ===================================================================

/**
 * Încarcă jurnalul de audit.
 */
async function loadAuditLogs() {
  showLoading(true);
  try {
    const params = new URLSearchParams();
    const f = AdminState.filters.audit;
    if (f.search) params.set('search', f.search);
    if (f.action !== 'all') params.set('action', f.action);
    if (f.dateFrom) params.set('dateFrom', f.dateFrom);
    if (f.dateTo) params.set('dateTo', f.dateTo);

    const p = AdminState.pagination.audit;
    params.set('page', p.page);
    params.set('perPage', p.perPage);

    const response = await adminApiRequest(`/audit?${params.toString()}`);
    const data = response.data || response;

    AdminState.auditLogs = data.items || data.logs || [];
    AdminState.pagination.audit.total = data.total || AdminState.auditLogs.length;

    renderAuditLogsTable();
    renderAuditLogsPagination();
  } catch (error) {
    showToast(`Eroare la încărcarea jurnalului de audit: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Afișează tabelul cu jurnalul de audit.
 */
function renderAuditLogsTable() {
  const tbody = document.getElementById('admin-audit-table-body');
  if (!tbody) return;

  if (AdminState.auditLogs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Nu există înregistrări de audit.</td></tr>';
    return;
  }

  tbody.innerHTML = AdminState.auditLogs.map(log => `
    <tr>
      <td>${typeof formatDate === 'function' ? formatDate(log.createdAt || log.timestamp) : (log.createdAt || '-')}</td>
      <td>
        <span class="badge badge-${getAuditActionBadge(log.action)}">${escapeHtml(log.action || 'N/A')}</span>
      </td>
      <td>${escapeHtml(log.user || log.userEmail || 'Sistem')}</td>
      <td>${escapeHtml(log.details || log.description || '-')}</td>
      <td>${escapeHtml(log.tenantId || log.ip || '-')}</td>
    </tr>
  `).join('');
}

/**
 * Returnează clasa badge-ului pentru o acțiune de audit.
 *
 * @param {string} action - Acțiunea
 * @returns {string} Clasa badge
 */
function getAuditActionBadge(action) {
  const map = {
    'create': 'success',
    'update': 'info',
    'delete': 'danger',
    'login': 'info',
    'logout': 'secondary',
    'error': 'danger',
    'warning': 'warning',
  };
  return map[action] || 'info';
}

/**
 * Afișează paginarea pentru jurnalul de audit.
 */
function renderAuditLogsPagination() {
  const container = document.getElementById('admin-audit-pagination');
  if (!container) return;

  const p = AdminState.pagination.audit;
  const totalPages = Math.ceil(p.total / p.perPage) || 1;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '<nav><ul class="pagination pagination-sm">';
  html += `<li class="page-item ${p.page <= 1 ? 'disabled' : ''}">
    <button class="page-link" onclick="changeAuditPage(${p.page - 1})">&laquo;</button>
  </li>`;

  for (let i = 1; i <= totalPages; i++) {
    html += `<li class="page-item ${i === p.page ? 'active' : ''}">
      <button class="page-link" onclick="changeAuditPage(${i})">${i}</button>
    </li>`;
  }

  html += `<li class="page-item ${p.page >= totalPages ? 'disabled' : ''}">
    <button class="page-link" onclick="changeAuditPage(${p.page + 1})">&raquo;</button>
  </li>`;
  html += '</ul></nav>';
  container.innerHTML = html;
}

/**
 * Schimbă pagina pentru jurnalul de audit.
 *
 * @param {number} page - Numărul paginii
 */
function changeAuditPage(page) {
  AdminState.pagination.audit.page = page;
  loadAuditLogs();
}

/**
 * Aplică filtrele pentru jurnalul de audit.
 */
function applyAuditFilters() {
  const searchInput = document.getElementById('admin-audit-search');
  const actionSelect = document.getElementById('admin-audit-action');
  const dateFrom = document.getElementById('admin-audit-date-from');
  const dateTo = document.getElementById('admin-audit-date-to');

  AdminState.filters.audit.search = searchInput ? searchInput.value.trim() : '';
  AdminState.filters.audit.action = actionSelect ? actionSelect.value : 'all';
  AdminState.filters.audit.dateFrom = dateFrom ? dateFrom.value : '';
  AdminState.filters.audit.dateTo = dateTo ? dateTo.value : '';
  AdminState.pagination.audit.page = 1;

  loadAuditLogs();
}

/**
 * Resetează filtrele pentru jurnalul de audit.
 */
function resetAuditFilters() {
  AdminState.filters.audit = { search: '', action: 'all', dateFrom: '', dateTo: '' };
  AdminState.pagination.audit.page = 1;

  const searchInput = document.getElementById('admin-audit-search');
  const actionSelect = document.getElementById('admin-audit-action');
  const dateFrom = document.getElementById('admin-audit-date-from');
  const dateTo = document.getElementById('admin-audit-date-to');

  if (searchInput) searchInput.value = '';
  if (actionSelect) actionSelect.value = 'all';
  if (dateFrom) dateFrom.value = '';
  if (dateTo) dateTo.value = '';

  loadAuditLogs();
}

// ===================================================================
// SETĂRI PLATFORMĂ
// ===================================================================

/**
 * Încarcă setările platformei.
 */
async function loadPlatformSettings() {
  showLoading(true);
  try {
    const data = await adminApiRequest('/settings');
    const settings = data.data || data || {};

    // Populează câmpurile cu valorile din setări
    const fields = {
      'settings-platform-name': settings.platformName || 'GastroHub',
      'settings-platform-url': settings.platformUrl || 'https://gastrohub.ro',
      'settings-platform-email': settings.supportEmail || 'suport@gastrohub.ro',
      'settings-platform-phone': settings.supportPhone || '+40 731 234 567',
      'settings-platform-description': settings.description || '',
      'settings-default-language': settings.defaultLanguage || 'ro',
      'settings-default-currency': settings.defaultCurrency || 'RON',
      'settings-timezone': settings.timezone || 'Europe/Bucharest',
      'settings-date-format': settings.dateFormat || 'DD/MM/YYYY',
      'settings-max-tenants': settings.maxTenants || 1000,
      'settings-max-users-per-tenant': settings.maxUsersPerTenant || 500,
      'settings-trial-days': settings.trialDays || 14,
      'settings-session-timeout': settings.sessionTimeout || 120,
      'settings-max-file-size': settings.maxFileSize || 10,
      'settings-api-rate-limit': settings.apiRateLimit || 60,
      'settings-billing-cycle': settings.billingCycle || 'monthly',
      'settings-currency-symbol': settings.currencySymbol || 'lei',
      'settings-tax-rate': settings.taxRate || 19,
      'settings-tax-label': settings.taxLabel || 'TVA',
      'settings-brand-primary-color': settings.brandPrimaryColor || '#6f42c1',
      'settings-brand-primary-color-hex': settings.brandPrimaryColor || '#6f42c1',
      'settings-brand-secondary-color': settings.brandSecondaryColor || '#0d1117',
      'settings-brand-secondary-color-hex': settings.brandSecondaryColor || '#0d1117',
      'settings-brand-accent-color': settings.brandAccentColor || '#8b5cf6',
      'settings-brand-accent-color-hex': settings.brandAccentColor || '#8b5cf6',
      'settings-brand-logo': settings.brandLogo || '/admin/img/logo.png',
      'settings-brand-favicon': settings.brandFavicon || '/favicon.ico',
      'settings-brand-footer-text': settings.brandFooterText || '© 2025 GastroHub. Toate drepturile rezervate.',
      'settings-brand-custom-css': settings.customCss || '',
      'settings-custom-terms-url': settings.customTermsUrl || '/terms',
      'settings-custom-privacy-url': settings.customPrivacyUrl || '/privacy',
      'settings-custom-cookies-url': settings.customCookiesUrl || '/cookies',
    };

    Object.entries(fields).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) {
        if (el.type === 'checkbox') {
          el.checked = !!value;
        } else if (el.type === 'color') {
          el.value = value || '#000000';
        } else {
          el.value = value;
        }
      }
    });

    // Checkbox-uri
    const checkboxFields = {
      'settings-tax-enabled': settings.taxEnabled !== false,
      'settings-auto-invoice': settings.autoInvoice !== false,
      'settings-feature-self-registration': settings.selfRegistration !== false,
      'settings-feature-multi-language': settings.multiLanguage !== false,
      'settings-feature-export-data': settings.exportData !== false,
      'settings-feature-api-access': settings.apiAccess !== false,
      'settings-feature-webhooks': !!settings.webhooks,
      'settings-feature-analytics': settings.analytics !== false,
    };

    Object.entries(checkboxFields).forEach(([id, checked]) => {
      const el = document.getElementById(id);
      if (el) el.checked = checked;
    });

    // Feature toggles
    document.querySelectorAll('.feature-toggle').forEach(toggle => {
      const feature = toggle.getAttribute('data-feature');
      if (feature && settings.features && settings.features[feature] !== undefined) {
        toggle.checked = settings.features[feature];
      }
    });

  } catch (error) {
    showToast(`Eroare la încărcarea setărilor: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Salvează setările platformei.
 */
async function savePlatformSettings() {
  const settings = {
    platformName: document.getElementById('settings-platform-name')?.value,
    platformUrl: document.getElementById('settings-platform-url')?.value,
    supportEmail: document.getElementById('settings-platform-email')?.value,
    supportPhone: document.getElementById('settings-platform-phone')?.value,
    description: document.getElementById('settings-platform-description')?.value,
    defaultLanguage: document.getElementById('settings-default-language')?.value,
    defaultCurrency: document.getElementById('settings-default-currency')?.value,
    timezone: document.getElementById('settings-timezone')?.value,
    dateFormat: document.getElementById('settings-date-format')?.value,
    maxTenants: parseInt(document.getElementById('settings-max-tenants')?.value) || 0,
    maxUsersPerTenant: parseInt(document.getElementById('settings-max-users-per-tenant')?.value) || 0,
    trialDays: parseInt(document.getElementById('settings-trial-days')?.value) || 14,
    sessionTimeout: parseInt(document.getElementById('settings-session-timeout')?.value) || 120,
    maxFileSize: parseInt(document.getElementById('settings-max-file-size')?.value) || 10,
    apiRateLimit: parseInt(document.getElementById('settings-api-rate-limit')?.value) || 60,
    billingCycle: document.getElementById('settings-billing-cycle')?.value,
    currencySymbol: document.getElementById('settings-currency-symbol')?.value,
    taxRate: parseFloat(document.getElementById('settings-tax-rate')?.value) || 0,
    taxLabel: document.getElementById('settings-tax-label')?.value,
    taxEnabled: document.getElementById('settings-tax-enabled')?.checked,
    autoInvoice: document.getElementById('settings-auto-invoice')?.checked,
    selfRegistration: document.getElementById('settings-feature-self-registration')?.checked,
    multiLanguage: document.getElementById('settings-feature-multi-language')?.checked,
    exportData: document.getElementById('settings-feature-export-data')?.checked,
    apiAccess: document.getElementById('settings-feature-api-access')?.checked,
    webhooks: document.getElementById('settings-feature-webhooks')?.checked,
    analytics: document.getElementById('settings-feature-analytics')?.checked,
    brandPrimaryColor: document.getElementById('settings-brand-primary-color')?.value,
    brandSecondaryColor: document.getElementById('settings-brand-secondary-color')?.value,
    brandAccentColor: document.getElementById('settings-brand-accent-color')?.value,
    brandLogo: document.getElementById('settings-brand-logo')?.value,
    brandFavicon: document.getElementById('settings-brand-favicon')?.value,
    brandFooterText: document.getElementById('settings-brand-footer-text')?.value,
    customCss: document.getElementById('settings-brand-custom-css')?.value,
    customTermsUrl: document.getElementById('settings-custom-terms-url')?.value,
    customPrivacyUrl: document.getElementById('settings-custom-privacy-url')?.value,
    customCookiesUrl: document.getElementById('settings-custom-cookies-url')?.value,
    features: {},
  };

  // Colectează feature toggles
  document.querySelectorAll('.feature-toggle').forEach(toggle => {
    const feature = toggle.getAttribute('data-feature');
    if (feature) {
      settings.features[feature] = toggle.checked;
    }
  });

  showLoading(true);
  try {
    await adminApiRequest('/settings', { method: 'PUT', body: settings });
    showToast('Setările au fost salvate cu succes!', 'success');
  } catch (error) {
    showToast(`Eroare la salvarea setărilor: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Resetează setările la valorile implicite.
 */
async function resetPlatformSettings() {
  if (!confirm('Sigur doriți să resetați toate setările la valorile implicite?\nAceastă acțiune nu poate fi anulată!')) {
    return;
  }

  showLoading(true);
  try {
    await adminApiRequest('/settings/reset', { method: 'POST' });
    showToast('Setările au fost resetate la valorile implicite!', 'success');
    loadPlatformSettings();
  } catch (error) {
    showToast(`Eroare la resetarea setărilor: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Comută între tab-urile de setări.
 *
 * @param {string} tabName - Numele tab-ului
 */
function switchSettingsTab(tabName) {
  // Ascunde toate tab-urile
  document.querySelectorAll('.settings-tab').forEach(el => {
    el.style.display = 'none';
  });

  // Afișează tab-ul selectat
  const targetTab = document.getElementById(`settings-tab-${tabName}`);
  if (targetTab) {
    targetTab.style.display = 'block';
  }

  // Actualizează butoanele active
  document.querySelectorAll('#settingsTabs .tab').forEach(el => el.classList.remove('active'));
  const activeTab = document.querySelector(`#settingsTabs .tab[data-tab="${tabName}"]`);
  if (activeTab) activeTab.classList.add('active');
}

/**
 * Comută o funcționalitate on/off.
 *
 * @param {HTMLInputElement} checkbox - Elementul checkbox
 */
function toggleFeature(checkbox) {
  const feature = checkbox.getAttribute('data-feature');
  if (!feature) return;
  // Actualizarea se face doar vizual; salvarea se face prin savePlatformSettings
}

// ===================================================================
// FUNCȚII UTILITARE GLOBALE
// ===================================================================

/**
 * Afișează un toast de notificare.
 *
 * @param {string} message - Mesajul
 * @param {string} type - Tipul (success, error, warning, info)
 */
function showToast(message, type) {
  type = type || 'info';
  const container = document.getElementById('toastContainer');
  if (!container) {
    console.warn('Toast container not found');
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle',
  };
  const icon = iconMap[type] || iconMap.info;

  toast.innerHTML = `<i class="fas ${icon}"></i> ${escapeHtml(message)}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 4000);
}

/**
 * Afișează sau ascunde overlay-ul de încărcare.
 *
 * @param {boolean} show - true pentru afișare, false pentru ascundere
 */
function showLoading(show) {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.style.display = show ? 'flex' : 'none';
  }
}

/**
 * Închide un modal după ID.
 *
 * @param {string} modalId - ID-ul modalului
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('modal-overlay--active');
    modal.style.display = 'none';
  }
}

/**
 * Formatează o sumă ca monedă.
 *
 * @param {number} amount - Suma
 * @returns {string} Suma formatată
 */
function formatCurrency(amount) {
  return Number(amount || 0).toFixed(2) + ' lei';
}

/**
 * Formatează o dată ISO.
 *
 * @param {string} dateStr - Data ISO
 * @returns {string} Data formatată
 */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ro-RO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Escape pentru HTML.
 *
 * @param {string} text - Textul
 * @returns {string} Textul escapet
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

/**
 * Inițializează toggle-ul sidebar-ului.
 */
document.addEventListener('DOMContentLoaded', function () {
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('adminSidebar');

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', function () {
      sidebar.classList.toggle('open');
    });
  }
});