/**
 * ============================================================
 * customer/public/js/customer.js
 * Portal Client — GastroHub
 * Interactivitate principală pentru interfața client
 * ============================================================
 *
 * Acest fișier conține funcționalitățile comune și specifice
 * paginilor portalului client:
 *   - Sidebar toggle (mobile)
 *   - Toast notifications
 *   - API Fetch helper
 *   - Format helpers (currency, date, status)
 *   - Modal management
 *   - Order management (view, cancel, repeat)
 *   - Reservation management (CRUD)
 *   - Loyalty management (points, coupons)
 *   - Address management
 *   - Profile management
 *   - Favorites management
 *   - Search & filter
 */

(function () {
  'use strict';

  // ============================================================
  // CONFIG
  // ============================================================
  var CONFIG = {
    TOAST_DURATION: 4000,
    API_TIMEOUT: 15000,
    MAX_GUESTS: 50,
    MIN_GUESTS: 1,
    MIN_POINTS_FOR_COUPON: 100,
    MAX_ACTIVE_COUPONS: 5,
    DEFAULT_DISCOUNT_PERCENTS: [5, 10, 15, 20, 25, 30],
  };

  // ============================================================
  // STATE
  // ============================================================
  var state = {
    currentOrderId: null,
    selectedReservationId: null,
    currentCouponCode: null,
    currentAddressId: null,
    isSubmitting: false,
    isGenerating: false,
    currentReservations: [],
    currentOrders: [],
    currentCoupons: [],
  };

  // ============================================================
  // DOM READY
  // ============================================================
  document.addEventListener('DOMContentLoaded', function () {
    initSidebar();
    initGlobalListeners();
    initPageSpecific();
  });

  // ============================================================
  // SIDEBAR
  // ============================================================
  function initSidebar() {
    var hamburger = document.getElementById('hamburger');
    var sidebar = document.getElementById('sidebar');

    if (!hamburger || !sidebar) return;

    hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });

    document.addEventListener('click', function (e) {
      if (window.innerWidth <= 768) {
        var isClickInside = sidebar.contains(e.target) || hamburger.contains(e.target);
        if (!isClickInside && sidebar.classList.contains('open')) {
          sidebar.classList.remove('open');
        }
      }
    });
  }

  // ============================================================
  // GLOBAL LISTENERS
  // ============================================================
  function initGlobalListeners() {
    // Close modals on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeAllModals();
      }
    });

    // Close modals on overlay click (delegated)
    document.addEventListener('click', function (e) {
      if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
      }
    });
  }

  // ============================================================
  // PAGE-SPECIFIC INIT
  // ============================================================
  function initPageSpecific() {
    var page = document.querySelector('[data-page]');
    if (!page) return;

    var pageName = page.getAttribute('data-page');

    switch (pageName) {
      case 'customer-orders':
        initOrdersPage(page);
        break;
      case 'customer-reservations':
        initReservationsPage(page);
        break;
      case 'customer-loyalty':
        initLoyaltyPage(page);
        break;
      case 'customer-profile':
        initProfilePage(page);
        break;
      case 'customer-addresses':
        initAddressesPage(page);
        break;
      case 'customer-favorites':
        initFavoritesPage(page);
        break;
      case 'customer-dashboard':
        initDashboardPage(page);
        break;
      default:
        break;
    }
  }

  // ============================================================
  // TOAST SYSTEM
  // ============================================================
  function showToast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;

    var iconMap = {
      success: 'fa-check-circle',
      error: 'fa-exclamation-circle',
      warning: 'fa-exclamation-triangle',
      info: 'fa-info-circle',
    };
    var icon = iconMap[type] || iconMap.info;

    toast.innerHTML = '<i class="fas ' + icon + '"></i> ' + escapeHtml(message);
    container.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, CONFIG.TOAST_DURATION);
  }

  // Expose globally for inline scripts
  window.showToast = showToast;

  // ============================================================
  // API FETCH HELPER
  // ============================================================
  async function apiFetch(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    options.headers['Content-Type'] = 'application/json';
    options.headers['Accept'] = 'application/json';

    // Add timeout via AbortController
    var controller = new AbortController();
    options.signal = controller.signal;
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, CONFIG.API_TIMEOUT);

    try {
      var response = await fetch(url, options);
      clearTimeout(timeoutId);

      if (!response.ok) {
        var errorText = await response.text();
        var errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (_) {
          errorData = null;
        }

        var errorMsg = 'Eroare ' + response.status;
        if (errorData && errorData.error && errorData.error.message) {
          errorMsg = errorData.error.message;
        } else if (errorData && errorData.message) {
          errorMsg = errorData.message;
        }

        showToast(errorMsg, 'error');
        return {
          success: false,
          error: { message: errorMsg },
          statusCode: response.status,
        };
      }

      var data = await response.json();

      if (!data.success) {
        var msg =
          data.error && data.error.message
            ? data.error.message
            : 'Eroare necunoscută';
        showToast(msg, 'error');
        return null;
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        showToast('Cererea a expirat (timeout).', 'error');
      } else {
        showToast('Eroare de rețea: ' + err.message, 'error');
      }
      return null;
    }
  }

  window.apiFetch = apiFetch;

  // ============================================================
  // FORMAT HELPERS
  // ============================================================
  function formatCurrency(amount) {
    return Number(amount).toFixed(2) + ' lei';
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  function formatStatus(status) {
    var map = {
      active: { label: 'Activ', class: 'badge-active' },
      inactive: { label: 'Inactiv', class: 'badge-inactive' },
      pending: { label: 'În așteptare', class: 'badge-pending' },
      confirmed: { label: 'Confirmat', class: 'badge-active' },
      processing: { label: 'În procesare', class: 'badge-info' },
      preparing: { label: 'În preparare', class: 'badge-pending' },
      ready: { label: 'Gata', class: 'badge-info' },
      delivered: { label: 'Livrat', class: 'badge-active' },
      completed: { label: 'Finalizat', class: 'badge-active' },
      cancelled: { label: 'Anulat', class: 'badge-closed' },
      refunded: { label: 'Rambursat', class: 'badge-info' },
      'checked_in': { label: 'Check-in', class: 'badge-info' },
      'no-show': { label: 'Neprezentare', class: 'badge-closed' },
      deschisă: { label: 'Deschisă', class: 'badge-pending' },
      'în preparare': { label: 'În preparare', class: 'badge-pending' },
      finalizată: { label: 'Finalizată', class: 'badge-active' },
      livrată: { label: 'Livrată', class: 'badge-active' },
      achitată: { label: 'Achitată', class: 'badge-active' },
      anulată: { label: 'Anulată', class: 'badge-closed' },
    };

    var entry = map[status] || {
      label: status || 'Necunoscut',
      class: 'badge-pending',
    };
    return '<span class="badge ' + entry.class + '">' + escapeHtml(entry.label) + '</span>';
  }

  function formatStatusLabel(status) {
    var map = {
      pending: { label: 'În așteptare', class: 'badge-pending' },
      confirmată: { label: 'Confirmată', class: 'badge-active' },
      'check-in': { label: 'Check-in', class: 'badge-info' },
      finalizată: { label: 'Finalizată', class: 'badge-closed' },
      anulată: { label: 'Anulată', class: 'badge-inactive' },
      cancelled: { label: 'Anulată', class: 'badge-inactive' },
      confirmed: { label: 'Confirmată', class: 'badge-active' },
      completed: { label: 'Finalizată', class: 'badge-closed' },
      checked_in: { label: 'Check-in', class: 'badge-info' },
      'no-show': { label: 'Neprezentare', class: 'badge-closed' },
    };
    var entry = map[status];
    if (!entry)
      return '<span class="badge badge-pending">' + escapeHtml(status) + '</span>';
    return '<span class="badge ' + entry.class + '">' + entry.label + '</span>';
  }

  // ============================================================
  // ESCAPE HTML
  // ============================================================
  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

  // ============================================================
  // MODAL MANAGEMENT
  // ============================================================
  function closeAllModals() {
    var modals = document.querySelectorAll('.modal-overlay');
    modals.forEach(function (m) {
      m.style.display = 'none';
    });
  }

  function openModal(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  function closeModal(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
      modal.style.display = 'none';
    }
  }

  // ============================================================
  // ORDERS PAGE
  // ============================================================
  function initOrdersPage(page) {
    var customerId = page.getAttribute('data-customer-id') || '';
    var tenantId = page.getAttribute('data-tenant-id') || '';

    // Expose functions globally for inline onclick handlers
    window.toggleOrderDetail = function (orderId) {
      var detail = document.getElementById('detail-' + orderId);
      if (detail) {
        detail.classList.toggle('open');
      }
    };

    window.viewOrderDetailModal = async function (orderId) {
      state.currentOrderId = orderId;
      var modal = document.getElementById('orderDetailModal');
      var body = document.getElementById('orderDetailBody');
      if (!modal || !body) return;

      modal.style.display = 'flex';
      body.innerHTML = '<div class="spinner"></div>';

      try {
        var data = await apiFetch(
          '/api/orders/' + orderId + '?tenantId=' + tenantId
        );
        if (data && data.success && data.data) {
          var order = data.data.order || data.data;
          renderOrderDetail(order, body);
        } else {
          body.innerHTML =
            '<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:var(--color-warning);"></i><h3>Comanda nu a fost găsită</h3><p>Detaliile comenzii nu sunt disponibile.</p></div>';
        }
      } catch (err) {
        body.innerHTML =
          '<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:var(--color-danger);"></i><h3>Eroare</h3><p>' +
          escapeHtml(err.message) +
          '</p></div>';
      }
    };

    window.repeatOrder = async function (orderId) {
      try {
        var data = await apiFetch('/api/orders/' + orderId + '/repeat', {
          method: 'POST',
          body: JSON.stringify({ tenantId: tenantId }),
        });
        if (data && data.success) {
          showToast(
            'Comanda a fost reprogramată! Ești redirecționat…',
            'success'
          );
          setTimeout(function () {
            window.location.href = '/customer/orders/' + data.data.order._id;
          }, 1500);
        }
      } catch (err) {
        showToast('Eroare la reprogramarea comenzii.', 'error');
      }
    };

    window.cancelCustomerOrder = async function (orderId) {
      if (!confirm('Ești sigur că vrei să anulezi această comandă?')) return;

      try {
        var data = await apiFetch('/api/orders/' + orderId + '/cancel', {
          method: 'PUT',
          body: JSON.stringify({ tenantId: tenantId }),
        });
        if (data && data.success) {
          showToast('Comanda a fost anulată.', 'success');
          setTimeout(function () {
            window.location.reload();
          }, 1500);
        }
      } catch (err) {
        showToast('Eroare la anularea comenzii.', 'error');
      }
    };

    // Search handler
    var searchInput = document.getElementById('orderSearchInput');
    if (searchInput) {
      searchInput.addEventListener('keyup', function (e) {
        if (e.key === 'Enter') {
          handleOrderSearch(e);
        }
      });
    }
  }

  window.handleOrderSearch = function (e) {
    var query = document.getElementById('orderSearchInput')
      ? document.getElementById('orderSearchInput').value
      : '';
    var currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('search', query);
    currentUrl.searchParams.set('page', '1');
    window.location.href = currentUrl.toString();
  };

  window.changeOrdersPage = function (direction) {
    var currentUrl = new URL(window.location.href);
    var currentPage = parseInt(currentUrl.searchParams.get('page') || '1', 10);
    var newPage = currentPage + direction;
    if (newPage < 1) newPage = 1;
    currentUrl.searchParams.set('page', newPage.toString());
    window.location.href = currentUrl.toString();
  };

  function renderOrderDetail(order, container) {
    if (!order || !container) return;

    var status = order.status || 'pending';
    var restaurantName =
      order.restaurantId && order.restaurantId.name
        ? order.restaurantId.name
        : order.restaurantName || 'Restaurant';
    var items = order.articole || order.items || [];
    var total = order.total || 0;
    var dateStr = order.createdAt || order.date || '';
    var formattedDate = dateStr ? formatDate(dateStr) : '—';

    var html =
      '<div class="detail-grid" style="grid-template-columns:1fr 1fr;gap:12px;">' +
      '<div class="detail-item"><label>Restaurant</label><div class="value"><i class="fas fa-store"></i> ' +
      escapeHtml(restaurantName) +
      '</div></div>' +
      '<div class="detail-item"><label>Status</label><div class="value">' +
      formatStatus(status) +
      '</div></div>' +
      '<div class="detail-item"><label>Data</label><div class="value"><i class="far fa-clock"></i> ' +
      formattedDate +
      '</div></div>' +
      '<div class="detail-item"><label>Total</label><div class="value" style="font-weight:700;font-size:18px;">' +
      formatCurrency(total) +
      '</div></div>';

    if (order.masa && order.masa > 0) {
      html +=
        '<div class="detail-item"><label>Masă</label><div class="value"><i class="fas fa-chair"></i> Masa ' +
        order.masa +
        '</div></div>';
    }

    if (order.notite) {
      html +=
        '<div class="detail-item" style="grid-column:1/-1;"><label>Notițe</label><div class="value">' +
        escapeHtml(order.notite) +
        '</div></div>';
    }

    html += '</div>';

    if (items && items.length > 0) {
      html +=
        '<table class="items-table" style="margin-top:14px;"><thead><tr><th>Articol</th><th>Cant.</th><th>Preț</th><th>Total</th></tr></thead><tbody>';
      items.forEach(function (item) {
        var nume = item.nume || item.name || 'Articol';
        var cantitate = item.cantitate || item.quantity || 1;
        var pret = item.pret || item.price || 0;
        html +=
          '<tr><td>' +
          escapeHtml(nume) +
          '</td><td>' +
          cantitate +
          '</td><td>' +
          formatCurrency(pret) +
          '</td><td style="font-weight:600;">' +
          formatCurrency(pret * cantitate) +
          '</td></tr>';
      });
      html += '</tbody></table>';
    }

    if (order.tipLivrare) {
      html +=
        '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--color-border);font-size:13px;color:var(--color-text-muted);">' +
        '<i class="fas fa-truck"></i> ' +
        (order.tipLivrare === 'curier'
          ? 'Livrare la domiciliu'
          : 'Ridicare din restaurant');
      if (order.adresaLivrare) {
        html += ': ' + escapeHtml(order.adresaLivrare);
      }
      html += '</div>';
    }

    container.innerHTML = html;
  }

  window.closeOrderDetailModal = function () {
    closeModal('orderDetailModal');
    state.currentOrderId = null;
  };

  // ============================================================
  // RESERVATIONS PAGE
  // ============================================================
  function initReservationsPage(page) {
    var form = document.getElementById('reservationForm');
    var submitBtn = document.getElementById('submitBtn');
    var notesEl = document.getElementById('notes');
    var notesCountEl = document.getElementById('notesCount');

    // Character counter
    if (notesEl && notesCountEl) {
      notesEl.addEventListener('input', function () {
        notesCountEl.textContent = this.value.length;
      });
    }

    // Set min date
    var reservationDateEl = document.getElementById('reservationDate');
    if (reservationDateEl) {
      setMinDateForInput(reservationDateEl);
    }

    // Submit handler
    if (form) {
      form.addEventListener('submit', handleReservationSubmit);
    }

    // Load restaurants
    loadRestaurantsForSelect();

    // Load reservations
    loadReservations();

    // Expose functions globally
    window.loadReservations = loadReservations;
    window.resetForm = resetReservationForm;
    window.viewReservationDetails = viewReservationDetails;
    window.closeDetailModal = function () {
      closeModal('detailModal');
      state.selectedReservationId = null;
    };
    window.cancelReservation = cancelReservation;
  }

  function setMinDateForInput(inputEl) {
    if (!inputEl) return;
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var hours = String(now.getHours()).padStart(2, '0');
    var minutes = String(now.getMinutes()).padStart(2, '0');
    var min = year + '-' + month + '-' + day + 'T' + hours + ':' + minutes;
    inputEl.setAttribute('min', min);
  }

  async function loadRestaurantsForSelect() {
    var select = document.getElementById('restaurantId');
    if (!select) return;

    try {
      var tenantId = getTenantId();
      var data = await apiFetch('/api/restaurants?tenantId=' + tenantId);
      if (data && data.success && data.data && data.data.restaurants) {
        select.innerHTML =
          '<option value="">— Selectează restaurantul —</option>';
        data.data.restaurants.forEach(function (r) {
          var opt = document.createElement('option');
          opt.value = r._id;
          opt.textContent = r.name;
          select.appendChild(opt);
        });
      }
    } catch (err) {
      console.error('Eroare la încărcarea restaurantelor:', err);
    }
  }

  function getCustomerId() {
    var el = document.querySelector('[data-customer-id]');
    return el ? el.getAttribute('data-customer-id') : '';
  }

  function getTenantId() {
    var el = document.querySelector('[data-tenant-id]');
    return el ? el.getAttribute('data-tenant-id') : '';
  }

  function getUserId() {
    // Fallback: look for user data embedded in page
    var meta = document.querySelector('meta[name="user-id"]');
    return meta ? meta.getAttribute('content') : '';
  }

  async function loadReservations() {
    var spinner = document.getElementById('reservationsSpinner');
    var emptyState = document.getElementById('reservationsEmpty');
    var tableWrapper = document.getElementById('reservationsTableWrapper');
    var tbody = document.getElementById('reservationsTableBody');

    if (spinner) spinner.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';
    if (tableWrapper) tableWrapper.style.display = 'none';

    try {
      var customerId = getCustomerId() || getUserId();
      var tenantId = getTenantId();

      if (!customerId || !tenantId) {
        if (spinner) spinner.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        return;
      }

      var data = await apiFetch(
        '/api/reservations/customer/' +
          customerId +
          '?tenantId=' +
          tenantId +
          '&limit=50'
      );
      if (spinner) spinner.style.display = 'none';

      if (data && data.success) {
        var reservations =
          data.data && data.data.reservations ? data.data.reservations : [];
        state.currentReservations = reservations;
        renderReservationsTable(reservations);
      } else {
        state.currentReservations = [];
        if (emptyState) emptyState.style.display = 'block';
      }
    } catch (err) {
      console.error('Eroare la încărcarea rezervărilor:', err);
      if (spinner) spinner.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
    }
  }

  function renderReservationsTable(reservations) {
    var tbody = document.getElementById('reservationsTableBody');
    var emptyState = document.getElementById('reservationsEmpty');
    var tableWrapper = document.getElementById('reservationsTableWrapper');

    if (!reservations || reservations.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      if (tableWrapper) tableWrapper.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (tableWrapper) tableWrapper.style.display = 'block';

    tbody.innerHTML = '';
    reservations.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.style.cursor = 'pointer';

      var restaurantName =
        r.restaurantId && r.restaurantId.name
          ? r.restaurantId.name
          : r.restaurantName || '—';
      var dateStr = r.date || r.reservationDate || r.createdAt;
      var formattedDate = dateStr ? formatDate(dateStr) : '—';
      var guests = r.guests || r.numberOfGuests || '—';
      var status = r.status || 'pending';

      tr.innerHTML =
        '<td>' +
        escapeHtml(restaurantName) +
        '</td>' +
        '<td>' +
        formattedDate +
        '</td>' +
        '<td>' +
        guests +
        '</td>' +
        '<td>' +
        formatStatusLabel(status) +
        '</td>' +
        '<td><button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); viewReservationDetails(\'' +
        r._id +
        '\')"><i class="fas fa-eye"></i></button></td>';

      tr.addEventListener('click', function () {
        viewReservationDetails(r._id);
      });

      tbody.appendChild(tr);
    });
  }

  function viewReservationDetails(reservationId) {
    state.selectedReservationId = reservationId;
    var r = state.currentReservations.find(function (item) {
      return item._id === reservationId;
    });
    if (!r) {
      showToast('Rezervarea nu a fost găsită.', 'error');
      return;
    }

    var restaurantName =
      r.restaurantId && r.restaurantId.name
        ? r.restaurantId.name
        : r.restaurantName || '—';
    var dateStr = r.date || r.reservationDate || r.createdAt;
    var formattedDate = dateStr ? formatDate(dateStr) : '—';
    var guests = r.guests || r.numberOfGuests || '—';
    var status = r.status || 'pending';
    var tablePref = r.tablePreference || '—';
    var notes = r.notes || '—';
    var createdAt = r.createdAt ? formatDate(r.createdAt) : '—';

    var canCancel = status === 'pending' || status === 'confirmată';
    var cancelBtn = document.getElementById('cancelReservationBtn');
    if (cancelBtn) {
      cancelBtn.style.display = canCancel ? 'inline-flex' : 'none';
    }

    var body = document.getElementById('detailModalBody');
    body.innerHTML =
      '<div class="grid-2" style="gap:12px;">' +
      '<div><strong>Restaurant:</strong><br>' +
      escapeHtml(restaurantName) +
      '</div>' +
      '<div><strong>Data & ora:</strong><br>' +
      formattedDate +
      '</div>' +
      '<div><strong>Nr. persoane:</strong><br>' +
      guests +
      '</div>' +
      '<div><strong>Status:</strong><br>' +
      formatStatusLabel(status) +
      '</div>' +
      '<div><strong>Preferință masă:</strong><br>' +
      escapeHtml(tablePref) +
      '</div>' +
      '<div><strong>Creată la:</strong><br>' +
      createdAt +
      '</div>' +
      '</div>' +
      '<div class="mt-2"><strong>Solicitări speciale:</strong><br>' +
      escapeHtml(notes) +
      '</div>';

    openModal('detailModal');
  }

  async function cancelReservation() {
    if (!state.selectedReservationId) return;
    if (!confirm('Ești sigur că vrei să anulezi această rezervare?')) return;

    try {
      var tenantId = getTenantId();
      var data = await apiFetch(
        '/api/reservations/' + state.selectedReservationId + '/cancel',
        {
          method: 'PUT',
          body: JSON.stringify({ tenantId: tenantId }),
        }
      );

      if (data && data.success) {
        showToast('Rezervarea a fost anulată cu succes.', 'success');
        closeModal('detailModal');
        loadReservations();
      }
    } catch (err) {
      showToast('Eroare la anularea rezervării.', 'error');
    }
  }

  async function handleReservationSubmit(e) {
    e.preventDefault();

    if (state.isSubmitting) return;

    var errors = validateReservationForm();
    if (errors.length > 0) {
      errors.forEach(function (err) {
        showToast(err, 'error');
      });
      return;
    }

    state.isSubmitting = true;
    var submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.querySelector('span').textContent = 'Se trimite…';

    var reservationIdEl = document.getElementById('reservationId');
    var restaurantIdEl = document.getElementById('restaurantId');
    var reservationDateEl = document.getElementById('reservationDate');
    var guestsEl = document.getElementById('guests');
    var tablePreferenceEl = document.getElementById('tablePreference');
    var notesEl = document.getElementById('notes');

    var isUpdate = !!reservationIdEl.value;
    var url = isUpdate
      ? '/api/reservations/' + reservationIdEl.value
      : '/api/reservations';
    var method = isUpdate ? 'PUT' : 'POST';

    var payload = {
      tenantId: getTenantId(),
      customerId: getCustomerId() || getUserId(),
      restaurantId: restaurantIdEl.value,
      date: reservationDateEl.value,
      guests: parseInt(guestsEl.value, 10),
      tablePreference: tablePreferenceEl.value || undefined,
      notes: notesEl.value || undefined,
    };

    try {
      var data = await apiFetch(url, {
        method: method,
        body: JSON.stringify(payload),
      });

      if (data && data.success) {
        showToast(
          isUpdate
            ? 'Rezervarea a fost actualizată.'
            : 'Rezervarea a fost creată cu succes!',
          'success'
        );
        resetReservationForm();
        loadReservations();
      }
    } catch (err) {
      showToast('Eroare la trimiterea rezervării.', 'error');
    } finally {
      state.isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = isUpdate
        ? 'Actualizează rezervarea'
        : 'Confirmă rezervarea';
    }
  }

  function validateReservationForm() {
    var errors = [];
    var restaurantIdEl = document.getElementById('restaurantId');
    var reservationDateEl = document.getElementById('reservationDate');
    var guestsEl = document.getElementById('guests');

    if (!restaurantIdEl.value) {
      errors.push('Selectează un restaurant.');
      document.getElementById('restaurantIdError').textContent =
        'Câmp obligatoriu';
    } else {
      document.getElementById('restaurantIdError').textContent = '';
    }

    if (!reservationDateEl.value) {
      errors.push('Selectează data și ora rezervării.');
      document.getElementById('reservationDateError').textContent =
        'Câmp obligatoriu';
    } else {
      document.getElementById('reservationDateError').textContent = '';
      var selectedDate = new Date(reservationDateEl.value);
      if (selectedDate <= new Date()) {
        errors.push('Data și ora trebuie să fie în viitor.');
        document.getElementById('reservationDateError').textContent =
          'Trebuie să fie în viitor';
      }
    }

    var guests = parseInt(guestsEl.value, 10);
    if (!guests || guests < CONFIG.MIN_GUESTS) {
      errors.push('Numărul de persoane trebuie să fie cel puțin 1.');
      document.getElementById('guestsError').textContent = 'Minimum 1 persoană';
    } else if (guests > CONFIG.MAX_GUESTS) {
      errors.push('Numărul maxim de persoane este 50.');
      document.getElementById('guestsError').textContent = 'Maximum 50';
    } else {
      document.getElementById('guestsError').textContent = '';
    }

    return errors;
  }

  function resetReservationForm() {
    var form = document.getElementById('reservationForm');
    if (form) form.reset();
    document.getElementById('reservationId').value = '';
    var submitBtn = document.getElementById('submitBtn');
    if (submitBtn)
      submitBtn.querySelector('span').textContent = 'Confirmă rezervarea';
    var guestsEl = document.getElementById('guests');
    if (guestsEl) guestsEl.value = 2;
    var notesCountEl = document.getElementById('notesCount');
    if (notesCountEl) notesCountEl.textContent = '0';
    document.querySelectorAll('.form-error').forEach(function (el) {
      el.textContent = '';
    });
  }

  // ============================================================
  // LOYALTY PAGE
  // ============================================================
  function initLoyaltyPage(page) {
    // Preview discount on order amount input
    var orderAmountInput = document.getElementById('orderAmount');
    if (orderAmountInput) {
      orderAmountInput.addEventListener('input', function () {
        previewDiscount();
      });
    }

    // Expose globally
    window.createLoyaltyAccount = createLoyaltyAccount;
    window.generateCoupon = generateCoupon;
    window.useCoupon = useCoupon;
    window.closeUseCouponModal = function () {
      closeModal('useCouponModal');
      state.currentCouponCode = null;
    };
    window.confirmUseCoupon = confirmUseCoupon;
    window.cancelCoupon = cancelCoupon;
    window.refreshCoupons = function () {
      window.location.reload();
    };
    window.loadAllCoupons = function () {
      window.location.reload();
    };
  }

  async function createLoyaltyAccount() {
    try {
      var customerId = getCustomerId() || getUserId();
      var tenantId = getTenantId();
      var data = await apiFetch('/api/loyalty/account', {
        method: 'POST',
        body: JSON.stringify({ userId: customerId, tenantId: tenantId }),
      });
      if (data && data.success) {
        showToast('Contul de loialitate a fost creat cu succes!', 'success');
        setTimeout(function () {
          window.location.reload();
        }, 1000);
      }
    } catch (err) {
      showToast('Eroare la crearea contului de loialitate.', 'error');
    }
  }

  async function generateCoupon() {
    try {
      var customerId = getCustomerId() || getUserId();
      var tenantId = getTenantId();
      var pointsToUse = parseInt(
        document.getElementById('pointsToUse')?.value || '100',
        10
      );

      if (isNaN(pointsToUse) || pointsToUse < CONFIG.MIN_POINTS_FOR_COUPON) {
        showToast(
          'Ai nevoie de minimum ' +
            CONFIG.MIN_POINTS_FOR_COUPON +
            ' puncte pentru a genera un cupon.',
          'warning'
        );
        return;
      }

      var data = await apiFetch('/api/loyalty/coupons/create', {
        method: 'POST',
        body: JSON.stringify({
          userId: customerId,
          tenantId: tenantId,
          points: pointsToUse,
        }),
      });

      if (data && data.success) {
        showToast('Cuponul a fost generat cu succes!', 'success');
        setTimeout(function () {
          window.location.reload();
        }, 1000);
      }
    } catch (err) {
      showToast('Eroare la generarea cuponului.', 'error');
    }
  }

  async function useCoupon(couponCode) {
    state.currentCouponCode = couponCode;
    var modal = document.getElementById('useCouponModal');
    if (modal) {
      document.getElementById('couponCodeDisplay').textContent = couponCode;
      modal.style.display = 'flex';
    }
  }

  async function confirmUseCoupon() {
    if (!state.currentCouponCode) return;

    try {
      var orderId = document.getElementById('couponOrderId')?.value || '';
      var tenantId = getTenantId();
      var data = await apiFetch('/api/loyalty/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({
          code: state.currentCouponCode,
          tenantId: tenantId,
          orderId: orderId || undefined,
        }),
      });

      if (data && data.success) {
        var discount = data.data?.discount || 0;
        showToast(
          'Cupon aplicat! Discount: ' + formatCurrency(discount),
          'success'
        );
        closeModal('useCouponModal');
        state.currentCouponCode = null;
        setTimeout(function () {
          window.location.reload();
        }, 1500);
      }
    } catch (err) {
      showToast('Eroare la aplicarea cuponului.', 'error');
    }
  }

  async function cancelCoupon(couponId) {
    if (!confirm('Ești sigur că vrei să anulezi acest cupon?')) return;

    try {
      var tenantId = getTenantId();
      var data = await apiFetch('/api/loyalty/coupons/' + couponId + '/cancel', {
        method: 'PUT',
        body: JSON.stringify({ tenantId: tenantId }),
      });

      if (data && data.success) {
        showToast('Cuponul a fost anulat și punctele returnate.', 'success');
        setTimeout(function () {
          window.location.reload();
        }, 1000);
      }
    } catch (err) {
      showToast('Eroare la anularea cuponului.', 'error');
    }
  }

  function previewDiscount() {
    var orderAmountEl = document.getElementById('orderAmount');
    var pointsEl = document.getElementById('pointsToUse');
    var previewEl = document.getElementById('discountPreview');

    if (!orderAmountEl || !pointsEl || !previewEl) return;

    var amount = parseFloat(orderAmountEl.value) || 0;
    var points = parseInt(pointsEl.value, 10) || 0;

    if (amount <= 0 || points < CONFIG.MIN_POINTS_FOR_COUPON) {
      previewEl.textContent = '—';
      return;
    }

    var discountPercent = Math.min(Math.floor(points / 100) * 5, 30);
    var discountValue = (amount * discountPercent) / 100;
    previewEl.textContent =
      discountPercent + '% (' + formatCurrency(discountValue) + ')';
  }

  // ============================================================
  // PROFILE PAGE
  // ============================================================
  function initProfilePage(page) {
    var form = document.getElementById('profileForm');
    if (form) {
      form.addEventListener('submit', handleProfileSubmit);
    }

    window.handleProfileSubmit = handleProfileSubmit;
  }

  async function handleProfileSubmit(e) {
    e.preventDefault();

    if (state.isSubmitting) return;
    state.isSubmitting = true;

    var submitBtn = document.getElementById('profileSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.querySelector('span').textContent = 'Se salvează…';
    }

    var nameEl = document.getElementById('profileName');
    var phoneEl = document.getElementById('profilePhone');
    var customerId = getCustomerId() || getUserId();
    var tenantId = getTenantId();

    var payload = {
      name: nameEl?.value?.trim() || undefined,
      phone: phoneEl?.value?.trim() || undefined,
      tenantId: tenantId,
    };

    try {
      var data = await apiFetch('/api/customers/' + customerId, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (data && data.success) {
        showToast('Profilul a fost actualizat cu succes!', 'success');
      }
    } catch (err) {
      showToast('Eroare la actualizarea profilului.', 'error');
    } finally {
      state.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.querySelector('span').textContent = 'Salvează modificările';
      }
    }
  }

  // ============================================================
  // ADDRESSES PAGE
  // ============================================================
  function initAddressesPage(page) {
    window.addAddress = addAddress;
    window.editAddress = editAddress;
    window.deleteAddress = deleteAddress;
    window.saveAddress = saveAddress;
  }

  function openAddressModal(addressId) {
    var modal = document.getElementById('addressModal');
    if (!modal) return;

    if (addressId) {
      document.getElementById('addressModalTitle').textContent =
        'Editează adresa';
      document.getElementById('addressId').value = addressId;
      // Populate fields from state or fetch
      var addr = (state.currentAddresses || []).find(function (a) {
        return a._id === addressId;
      });
      if (addr) {
        document.getElementById('addressLabel').value = addr.label || '';
        document.getElementById('addressStreet').value = addr.street || '';
        document.getElementById('addressCity').value = addr.city || '';
        document.getElementById('addressPostalCode').value =
          addr.postalCode || '';
        document.getElementById('addressPhone').value = addr.phone || '';
        document.getElementById('addressDefault').checked =
          addr.isDefault || false;
      }
    } else {
      document.getElementById('addressModalTitle').textContent =
        'Adaugă adresă nouă';
      document.getElementById('addressId').value = '';
      document.getElementById('addressLabel').value = '';
      document.getElementById('addressStreet').value = '';
      document.getElementById('addressCity').value = '';
      document.getElementById('addressPostalCode').value = '';
      document.getElementById('addressPhone').value = '';
      document.getElementById('addressDefault').checked = false;
    }

    modal.style.display = 'flex';
  }

  function addAddress() {
    openAddressModal(null);
  }

  function editAddress(addressId) {
    openAddressModal(addressId);
  }

  async function deleteAddress(addressId) {
    if (!confirm('Ești sigur că vrei să ștergi această adresă?')) return;

    try {
      var customerId = getCustomerId() || getUserId();
      var tenantId = getTenantId();
      var data = await apiFetch(
        '/api/customers/' + customerId + '/addresses/' + addressId,
        {
          method: 'DELETE',
          body: JSON.stringify({ tenantId: tenantId }),
        }
      );

      if (data && data.success) {
        showToast('Adresa a fost ștearsă.', 'success');
        setTimeout(function () {
          window.location.reload();
        }, 1000);
      }
    } catch (err) {
      showToast('Eroare la ștergerea adresei.', 'error');
    }
  }

  async function saveAddress() {
    var addressId = document.getElementById('addressId')?.value;
    var label = document.getElementById('addressLabel')?.value?.trim();
    var street = document.getElementById('addressStreet')?.value?.trim();
    var city = document.getElementById('addressCity')?.value?.trim();
    var postalCode = document.getElementById('addressPostalCode')?.value?.trim();
    var phone = document.getElementById('addressPhone')?.value?.trim();
    var isDefault = document.getElementById('addressDefault')?.checked;

    if (!label || !street || !city) {
      showToast(
        'Eticheta, strada și orașul sunt obligatorii.',
        'error'
      );
      return;
    }

    var customerId = getCustomerId() || getUserId();
    var tenantId = getTenantId();
    var payload = {
      label: label,
      street: street,
      city: city,
      postalCode: postalCode || undefined,
      phone: phone || undefined,
      isDefault: !!isDefault,
      tenantId: tenantId,
    };

    try {
      var url = addressId
        ? '/api/customers/' + customerId + '/addresses/' + addressId
        : '/api/customers/' + customerId + '/addresses';
      var method = addressId ? 'PUT' : 'POST';

      var data = await apiFetch(url, {
        method: method,
        body: JSON.stringify(payload),
      });

      if (data && data.success) {
        showToast(
          addressId
            ? 'Adresa a fost actualizată.'
            : 'Adresa a fost adăugată cu succes!',
          'success'
        );
        closeModal('addressModal');
        setTimeout(function () {
          window.location.reload();
        }, 1000);
      }
    } catch (err) {
      showToast('Eroare la salvarea adresei.', 'error');
    }
  }

  // ============================================================
  // FAVORITES PAGE
  // ============================================================
  function initFavoritesPage(page) {
    window.removeFavorite = removeFavorite;
    window.addFavorite = addFavorite;
  }

  async function removeFavorite(restaurantId) {
    if (!confirm('Ești sigur că vrei să elimini acest restaurant din favorite?'))
      return;

    try {
      var customerId = getCustomerId() || getUserId();
      var tenantId = getTenantId();
      var data = await apiFetch(
        '/api/customers/' + customerId + '/favorites/' + restaurantId,
        {
          method: 'DELETE',
          body: JSON.stringify({ tenantId: tenantId }),
        }
      );

      if (data && data.success) {
        showToast('Restaurantul a fost eliminat din favorite.', 'success');
        setTimeout(function () {
          window.location.reload();
        }, 1000);
      }
    } catch (err) {
      showToast('Eroare la eliminarea din favorite.', 'error');
    }
  }

  async function addFavorite(restaurantId) {
    try {
      var customerId = getCustomerId() || getUserId();
      var tenantId = getTenantId();
      var data = await apiFetch(
        '/api/customers/' + customerId + '/favorites',
        {
          method: 'POST',
          body: JSON.stringify({
            restaurantId: restaurantId,
            tenantId: tenantId,
          }),
        }
      );

      if (data && data.success) {
        showToast('Restaurantul a fost adăugat la favorite!', 'success');
        setTimeout(function () {
          window.location.reload();
        }, 1000);
      }
    } catch (err) {
      showToast('Eroare la adăugarea la favorite.', 'error');
    }
  }

  // ============================================================
  // DASHBOARD PAGE
  // ============================================================
  function initDashboardPage(page) {
    loadCustomerDashboard();
    window.loadCustomerDashboard = loadCustomerDashboard;
  }

  async function loadCustomerDashboard() {
    try {
      var customerId = getCustomerId() || getUserId();
      var tenantId = getTenantId();
      var data = await apiFetch(
        '/api/customers/' + customerId + '/dashboard?tenantId=' + tenantId
      );

      if (data && data.success) {
        var stats = data.data || {};

        // Update stat cards
        var totalOrders = document.getElementById('cust-stat-orders');
        var totalPoints = document.getElementById('cust-stat-points');
        var activeCoupons = document.getElementById('cust-stat-coupons');
        var recentActivity = document.getElementById('cust-stat-activity');

        if (totalOrders)
          totalOrders.textContent = stats.totalOrders || 0;
        if (totalPoints)
          totalPoints.textContent = stats.loyaltyPoints || 0;
        if (activeCoupons)
          activeCoupons.textContent = stats.activeCoupons || 0;

        // Render recent orders
        if (stats.recentOrders && stats.recentOrders.length > 0) {
          var recentContainer = document.getElementById(
            'cust-recent-orders'
          );
          if (recentContainer) {
            recentContainer.innerHTML = stats.recentOrders
              .map(function (order) {
                return (
                  '<div class="activity-item">' +
                  '<div class="activity-icon order">' +
                  '<i class="fas fa-receipt"></i>' +
                  '</div>' +
                  '<div class="activity-content">' +
                  '<div class="activity-text">Comandă #' +
                  (order._id || '').substring(0, 8) +
                  '</div>' +
                  '<div class="activity-time">' +
                  formatDate(order.createdAt) +
                  ' • ' +
                  formatCurrency(order.total || 0) +
                  '</div>' +
                  '</div>' +
                  '</div>'
                );
              })
              .join('');
          }
        }
      }
    } catch (err) {
      console.error('Eroare la încărcarea dashboard-ului client:', err);
    }
  }

  // ============================================================
  // EXPOSE PUBLIC API
  // ============================================================
  window.formatCurrency = formatCurrency;
  window.formatDate = formatDate;
  window.formatShortDate = formatShortDate;
  window.formatStatus = formatStatus;
  window.formatStatusLabel = formatStatusLabel;
  window.escapeHtml = escapeHtml;
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.closeAllModals = closeAllModals;
  window.addAddress = addAddress;
  window.editAddress = editAddress;
  window.deleteAddress = deleteAddress;
  window.saveAddress = saveAddress;
  window.removeFavorite = removeFavorite;
  window.addFavorite = addFavorite;

  // ============================================================
  // INIT ON DOM READY (already called above, this ensures
  // event listeners are registered)
  // ============================================================
})();