/**
 * ============================================================
 * HOTEL.JS - Hotel Management Interactivity
 * ============================================================
 * GastroHub - SaaS pentru gestionarea hotelurilor
 * Versiune: 1.0.0
 * Funcționalități: notificări toast, gestionare camere,
 * gestionare rezervări, gestionare oaspeți, modaluri,
 * utilitare formatare, căutare și filtrare, calendar,
 * check-in/check-out, grafice dashboard
 * ============================================================
 */

(function () {
  'use strict';

  // ============================================================
  // CONFIGURAȚIE GLOBALĂ
  // ============================================================
  var CONFIG = {
    refreshInterval: 30000, // 30 secunde auto-refresh
    toastDuration: 4000,    // 4 secunde afișare toast
    apiBasePath: '/api/hotel',
    debug: false,
  };

  // ============================================================
  // STARE GLOBALĂ
  // ============================================================
  var state = {
    refreshTimer: null,
    currentHotelId: null,
    isRefreshing: false,
    currentPage: null,
    calendarDate: new Date(),
    calendarVisible: false,
    dashboardChart: null,
  };

  // Initialize state from DOM
  (function initState() {
    var params = new URLSearchParams(window.location.search);
    state.currentHotelId = params.get('hotelId') || null;
    var pathParts = window.location.pathname.split('/');
    state.currentPage = pathParts[pathParts.length - 1] || 'dashboard';
  })();

  // ============================================================
  // TOAST NOTIFICATIONS SYSTEM
  // ============================================================

  /**
   * Afișează o notificare toast
   * @param {string} message - Mesajul de afișat
   * @param {string} type - Tipul: 'success', 'error', 'warning', 'info'
   * @param {number} duration - Durata în ms (opțional)
   * @returns {HTMLElement} Elementul toast creat
   */
  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || CONFIG.toastDuration;

    var container = document.getElementById('toastContainer');
    if (!container) {
      // Creează containerul dacă nu există
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.style.animation = 'slideInRight 0.3s ease';

    var iconMap = {
      success: 'fa-check-circle',
      error: 'fa-exclamation-circle',
      warning: 'fa-exclamation-triangle',
      info: 'fa-info-circle',
    };
    var icon = iconMap[type] || iconMap.info;

    // Conținut toast
    toast.innerHTML =
      '<span class="toast-icon"><i class="fas ' + icon + '"></i></span>' +
      '<span class="toast-content"><span class="toast-title">' +
      message +
      '</span></span>' +
      '<button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';

    container.appendChild(toast);

    // Auto-eliminare după durată
    var timeoutId = setTimeout(function () {
      removeToast(toast);
    }, duration);

    // Salvează timeout-ul pe element pentru a putea fi anulat
    toast._timeoutId = timeoutId;

    // Eliminare la click pe butonul de închidere
    var closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        clearTimeout(timeoutId);
        removeToast(toast);
      });
    }

    return toast;
  }

  /**
   * Elimină un toast cu animație
   * @param {HTMLElement} toast - Elementul toast
   */
  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(function () {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  /**
   * Elimină toate toasterele active
   */
  function clearAllToasts() {
    var container = document.getElementById('toastContainer');
    if (container) {
      container.innerHTML = '';
    }
  }

  // ============================================================
  // FORMATARE DATE
  // ============================================================

  /**
   * Formatează o sumă ca monedă (lei)
   * @param {number} amount - Suma de formatat
   * @returns {string} Suma formatată (ex: "250.00 lei")
   */
  function formatCurrency(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return '0.00 lei';
    }
    return Number(amount).toFixed(2) + ' lei';
  }

  /**
   * Formatează o dată ISO în format local românesc
   * @param {string|Date} dateStr - Data de formatat
   * @returns {string} Data formatată
   */
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('ro-RO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      if (CONFIG.debug) console.warn('formatDate error:', e);
      return '—';
    }
  }

  /**
   * Formatează o dată doar ca dată (fără oră)
   * @param {string|Date} dateStr - Data de formatat
   * @returns {string} Data formatată
   */
  function formatDateShort(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('ro-RO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch (e) {
      if (CONFIG.debug) console.warn('formatDateShort error:', e);
      return '—';
    }
  }

  /**
   * Formatează statusul unei camere în badge HTML
   * @param {string} status - Statusul camerei
   * @returns {string} HTML-ul badge-ului
   */
  function formatRoomStatus(status) {
    var map = {
      available: { label: 'Disponibilă', class: 'room-status-badge available' },
      occupied: { label: 'Ocupată', class: 'room-status-badge occupied' },
      maintenance: { label: 'Mentenanță', class: 'room-status-badge maintenance' },
      cleaning: { label: 'Curățenie', class: 'room-status-badge cleaning' },
      reserved: { label: 'Rezervată', class: 'room-status-badge reserved' },
      'out-of-order': { label: 'Indisponibilă', class: 'room-status-badge out-of-order' },
    };
    var entry = map[status];
    if (!entry) return '<span class="room-status-badge">' + status + '</span>';
    return '<span class="' + entry.class + '">' + entry.label + '</span>';
  }

  /**
   * Formatează statusul unei rezervări în badge HTML
   * @param {string} status - Statusul rezervării
   * @returns {string} HTML-ul badge-ului
   */
  function formatReservationStatus(status) {
    var map = {
      pending: { label: 'În așteptare', class: 'reservation-status pending' },
      confirmed: { label: 'Confirmată', class: 'reservation-status confirmed' },
      'checked-in': { label: 'Check-in', class: 'reservation-status checked-in' },
      'checked-out': { label: 'Check-out', class: 'reservation-status checked-out' },
      cancelled: { label: 'Anulată', class: 'reservation-status cancelled' },
      'no-show': { label: 'No-show', class: 'reservation-status no-show' },
    };
    var entry = map[status];
    if (!entry) return '<span class="reservation-status">' + status + '</span>';
    return '<span class="' + entry.class + '">' + entry.label + '</span>';
  }

  /**
   * Formatează statusul unui oaspete în badge HTML
   * @param {string} status - Statusul oaspetelui
   * @returns {string} HTML-ul badge-ului
   */
  function formatGuestStatus(status) {
    var map = {
      'checked-in': { label: 'Check-in', class: 'guest-status-badge checked-in' },
      'checked-out': { label: 'Check-out', class: 'guest-status-badge checked-out' },
      pending: { label: 'În așteptare', class: 'guest-status-badge pending' },
      cancelled: { label: 'Anulat', class: 'guest-status-badge cancelled' },
    };
    var entry = map[status];
    if (!entry) return '<span class="guest-status-badge">' + status + '</span>';
    return '<span class="' + entry.class + '">' + entry.label + '</span>';
  }

  /**
   * Formatează o durată de nopți în text
   * @param {number} nopți - Numărul de nopți
   * @returns {string} Textul formatat
   */
  function formatNights(nopți) {
    if (!nopți && nopți !== 0) return '—';
    if (nopți === 1) return '1 noapte';
    return nopți + ' nopți';
  }

  /**
   * Formatează o adresă completă
   * @param {Object} adresă - Obiectul adresă
   * @returns {string} Adresa formatată
   */
  function formatAddress(adresă) {
    if (!adresă) return '—';
    var parts = [];
    if (adresă.stradă) parts.push(adresă.stradă);
    if (adresă.oraș) parts.push(adresă.oraș);
    if (adresă.județ) parts.push(adresă.județ);
    if (adresă.țară) parts.push(adresă.țară);
    if (adresă.codPoștal) parts.push(adresă.codPoștal);
    return parts.join(', ') || '—';
  }

  // ============================================================
  // API FETCH HELPER
  // ============================================================

  /**
   * Efectuează un request API cu gestionare uniformă a erorilor
   * @param {string} url - URL-ul request-ului
   * @param {Object} options - Opțiuni fetch (method, body, headers)
   * @returns {Promise<Object|null>} Răspunsul parsat sau null la eroare
   */
  async function apiFetch(url, options) {
    options = options || {};
    options.headers = options.headers || {};

    // Setează headers implicite
    if (!options.headers['Content-Type']) {
      options.headers['Content-Type'] = 'application/json';
    }
    if (!options.headers['Accept']) {
      options.headers['Accept'] = 'application/json';
    }

    // Adaugă hotelId din URL dacă există
    var urlObj = new URL(url, window.location.origin);
    var params = new URLSearchParams(window.location.search);
    var hotelId = params.get('hotelId');
    if (hotelId && !urlObj.searchParams.has('hotelId')) {
      urlObj.searchParams.set('hotelId', hotelId);
    }

    try {
      var response = await fetch(urlObj.toString(), options);
      var contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        var errorMsg = 'Eroare ' + response.status;
        try {
          var errorData = await response.json();
          if (errorData.error && errorData.error.message) {
            errorMsg = errorData.error.message;
          } else if (errorData.message) {
            errorMsg = errorData.message;
          }
        } catch (_e) {
          // Nu se poate parsa ca JSON
        }
        showToast(errorMsg, 'error');
        return null;
      }

      if (contentType.includes('application/json')) {
        var data = await response.json();
        if (data && data.success === false) {
          var msg =
            data.error && data.error.message
              ? data.error.message
              : 'Eroare necunoscută';
          showToast(msg, 'error');
          return null;
        }
        return data;
      }

      // Pentru răspunsuri non-JSON, returnăm textul
      var text = await response.text();
      return { success: true, data: text };
    } catch (err) {
      showToast('Eroare de rețea: ' + err.message, 'error');
      if (CONFIG.debug) console.error('apiFetch error:', err);
      return null;
    }
  }

  // ============================================================
  // MODAL SYSTEM
  // ============================================================

  /**
   * Deschide un modal cu conținut specificat
   * @param {Object} options - Configurația modalului
   * @param {string} options.title - Titlul modalului
   * @param {string} options.body - Conținutul HTML al corpului
   * @param {string} options.size - Dimensiunea: 'sm', 'md', 'lg'
   * @param {Function} options.onClose - Callback la închidere
   * @returns {HTMLElement} Elementul modal
   */
  function openModal(options) {
    options = options || {};
    var title = options.title || '';
    var body = options.body || '';
    var size = options.size || 'md';
    var onClose = options.onClose || null;

    // Elimină orice modal existent
    var existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    var sizeClass = '';
    if (size === 'sm') sizeClass = ' modal-sm';
    else if (size === 'lg') sizeClass = ' modal-lg';

    overlay.innerHTML =
      '<div class="modal' +
      sizeClass +
      '">' +
      '<div class="modal-header">' +
      '<h2>' +
      title +
      '</h2>' +
      '<button class="modal-close" aria-label="Închide">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
      body +
      '</div>' +
      '</div>';

    // Închide la click pe overlay
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        closeModal(overlay, onClose);
      }
    });

    // Închide la click pe butonul de close
    var closeBtn = overlay.querySelector('.modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        closeModal(overlay, onClose);
      });
    }

    document.body.appendChild(overlay);
    return overlay;
  }

  /**
   * Închide un modal
   * @param {HTMLElement} overlay - Elementul overlay al modalului
   * @param {Function} onClose - Callback la închidere
   */
  function closeModal(overlay, onClose) {
    if (!overlay) return;
    if (typeof onClose === 'function') {
      try {
        onClose();
      } catch (e) {
        if (CONFIG.debug) console.warn('closeModal callback error:', e);
      }
    }
    overlay.remove();
  }

  /**
   * Deschide un dialog de confirmare
   * @param {string} message - Mesajul de confirmare
   * @param {Function} onConfirm - Callback la confirmare
   * @param {Object} options - Opțiuni suplimentare
   */
  function confirmDialog(message, onConfirm, options) {
    options = options || {};
    var confirmText = options.confirmText || 'Confirmă';
    var cancelText = options.cancelText || 'Anulează';
    var title = options.title || 'Confirmare';

    var body =
      '<p style="margin-bottom: 20px; font-size: 15px;">' +
      message +
      '</p>' +
      '<div class="form-actions">' +
      '<button class="btn btn-secondary" id="confirmCancelBtn">' +
      cancelText +
      '</button>' +
      '<button class="btn btn-primary" id="confirmOkBtn">' +
      confirmText +
      '</button>' +
      '</div>';

    var overlay = openModal({
      title: title,
      body: body,
      size: 'sm',
      onClose: function () {
        // do nothing on close
      },
    });

    var okBtn = overlay.querySelector('#confirmOkBtn');
    var cancelBtn = overlay.querySelector('#confirmCancelBtn');

    if (okBtn) {
      okBtn.addEventListener('click', function () {
        closeModal(overlay);
        if (typeof onConfirm === 'function') {
          onConfirm();
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        closeModal(overlay);
      });
    }
  }

  // ============================================================
  // HOTEL SELECTOR
  // ============================================================

  /**
   * Comută hotelul selectat
   * @param {string} hotelId - ID-ul hotelului
   */
  function switchHotel(hotelId) {
    if (!hotelId) return;
    var url = new URL(window.location.href);
    url.searchParams.set('hotelId', hotelId);
    url.searchParams.delete('status');
    window.location.href = url.toString();
  }

  // ============================================================
  // ROOM MANAGEMENT
  // ============================================================

  /**
   * Deschide modalul pentru adăugarea unei camere noi
   */
  function openAddRoomModal() {
    var hotelSelect = document.getElementById('hotelSelect');
    var hotelId = hotelSelect ? hotelSelect.value : state.currentHotelId;
    if (!hotelId) {
      showToast('Selectează un hotel mai întâi', 'warning');
      return;
    }

    var html = {
      title: 'Adaugă cameră nouă',
      body: '<form id="addRoomForm" onsubmit="return false;">' +
        '<div class="form-group">' +
          '<label for="roomNumber">Număr cameră *</label>' +
          '<input type="number" id="roomNumber" name="număr" min="1" required placeholder="ex: 101" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="roomType">Tip cameră *</label>' +
          '<select id="roomType" name="tip" required>' +
            '<option value="">Selectează tipul</option>' +
            '<option value="single">Single</option>' +
            '<option value="double">Double</option>' +
            '<option value="twin">Twin</option>' +
            '<option value="triple">Triple</option>' +
            '<option value="suite">Suite</option>' +
            '<option value="junior suite">Junior Suite</option>' +
            '<option value="penthouse">Penthouse</option>' +
            '<option value="family room">Family Room</option>' +
            '<option value="apartament">Apartament</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="roomCapacity">Capacitate (persoane)</label>' +
          '<input type="number" id="roomCapacity" name="capacitate" min="1" max="20" placeholder="ex: 2" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="roomPrice">Preț sezon standard (lei)</label>' +
          '<input type="number" id="roomPrice" name="preț" min="0" step="0.01" placeholder="ex: 250.00" />' +
        '</div>' +
        '<div class="form-group">' +
          '<label for="roomDescription">Descriere</label>' +
          '<textarea id="roomDescription" name="descriere" rows="3" placeholder="Facilități, vedere, etc."></textarea>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-secondary" onclick="closeModal(this.closest(\'.modal-overlay\'))">Anulează</button>' +
          '<button type="submit" class="btn btn-primary" onclick="submitAddRoom()">Adaugă camera</button>' +
        '</div>' +
      '</form>'
    };
    openModal(html);
  }

  /**
   * Trimite datele pentru adăugarea unei camere noi
   */
  async function submitAddRoom() {
    var număr = document.getElementById('roomNumber').value;
    var tip = document.getElementById('roomType').value;
    var capacitate = document.getElementById('roomCapacity').value;
    var preț = document.getElementById('roomPrice').value;
    var descriere = document.getElementById('roomDescription').value;
    var hotelId = state.currentHotelId;

    if (!număr || !tip || !hotelId) {
      showToast('Completează toate câmpurile obligatorii', 'warning');
      return;
    }

    var data = {
      număr: parseInt(număr),
      tip: tip,
      hotelId: hotelId,
    };

    if (capacitate) {
      data.capacitate = parseInt(capacitate);
    }

    if (descriere) {
      data.descriere = descriere;
    }

    if (preț) {
      data.prețuriSezoniere = [{ sezon: 'standard', preț: parseFloat(preț) }];
    }

    var result = await apiFetch('/api/hotel/rooms', {
      method: 'POST',
      body: JSON.stringify(data),
    });

    if (result && result.success) {
      showToast('Camera a fost adăugată cu succes!', 'success');
      setTimeout(function () {
        location.reload();
      }, 1000);
    }
  }

  /**
   * Deschide modalul pentru editarea unei camere
   * @param {string} roomId - ID-ul camerei
   */
  async function openEditRoomModal(roomId) {
    if (!roomId) return;

    var result = await apiFetch('/api/hotel/rooms/' + roomId);
    if (!result || !result.success) return;

    var room = result.data.room;

    var body = '<form id="editRoomForm" onsubmit="return false;">' +
      '<div class="form-group">' +
        '<label for="editRoomNumber">Număr cameră *</label>' +
        '<input type="number" id="editRoomNumber" value="' + (room.număr || '') + '" min="1" required />' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="editRoomType">Tip cameră *</label>' +
        '<select id="editRoomType" required>' +
          '<option value="single"' + (room.tip === 'single' ? ' selected' : '') + '>Single</option>' +
          '<option value="double"' + (room.tip === 'double' ? ' selected' : '') + '>Double</option>' +
          '<option value="twin"' + (room.tip === 'twin' ? ' selected' : '') + '>Twin</option>' +
          '<option value="triple"' + (room.tip === 'triple' ? ' selected' : '') + '>Triple</option>' +
          '<option value="suite"' + (room.tip === 'suite' ? ' selected' : '') + '>Suite</option>' +
          '<option value="junior suite"' + (room.tip === 'junior suite' ? ' selected' : '') + '>Junior Suite</option>' +
          '<option value="penthouse"' + (room.tip === 'penthouse' ? ' selected' : '') + '>Penthouse</option>' +
          '<option value="family room"' + (room.tip === 'family room' ? ' selected' : '') + '>Family Room</option>' +
          '<option value="apartament"' + (room.tip === 'apartament' ? ' selected' : '') + '>Apartament</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="editRoomCapacity">Capacitate (persoane)</label>' +
        '<input type="number" id="editRoomCapacity" value="' + (room.capacitate || '') + '" min="1" max="20" />' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="editRoomStatus">Status</label>' +
        '<select id="editRoomStatus">' +
          '<option value="available"' + (room.status === 'available' ? ' selected' : '') + '>Disponibilă</option>' +
          '<option value="occupied"' + (room.status === 'occupied' ? ' selected' : '') + '>Ocupată</option>' +
          '<option value="maintenance"' + (room.status === 'maintenance' ? ' selected' : '') + '>Mentenanță</option>' +
          '<option value="cleaning"' + (room.status === 'cleaning' ? ' selected' : '') + '>Curățenie</option>' +
          '<option value="reserved"' + (room.status === 'reserved' ? ' selected' : '') + '>Rezervată</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="editRoomDescription">Descriere</label>' +
        '<textarea id="editRoomDescription" rows="3">' + (room.descriere || '') + '</textarea>' +
      '</div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal(this.closest(\'.modal-overlay\'))">Anulează</button>' +
        '<button type="submit" class="btn btn-primary" onclick="submitEditRoom(\'' + roomId + '\')">Salvează modificările</button>' +
      '</div>' +
    '</form>';

    openModal({
      title: 'Editează camera ' + room.număr,
      body: body,
      size: 'md',
    });
  }

  /**
   * Trimite datele pentru editarea unei camere
   * @param {string} roomId - ID-ul camerei
   */
  async function submitEditRoom(roomId) {
    var număr = document.getElementById('editRoomNumber').value;
    var tip = document.getElementById('editRoomType').value;
    var capacitate = document.getElementById('editRoomCapacity').value;
    var status = document.getElementById('editRoomStatus').value;
    var descriere = document.getElementById('editRoomDescription').value;

    if (!număr || !tip) {
      showToast('Completează toate câmpurile obligatorii', 'warning');
      return;
    }

    var data = {
      număr: parseInt(număr),
      tip: tip,
      status: status,
    };

    if (capacitate) data.capacitate = parseInt(capacitate);
    if (descriere) data.descriere = descriere;

    var result = await apiFetch('/api/hotel/rooms/' + roomId, {
      method: 'PUT',
      body: JSON.stringify(data),
    });

    if (result && result.success) {
      showToast('Camera a fost actualizată!', 'success');
      closeModal(document.querySelector('.modal-overlay'));
      setTimeout(function () {
        location.reload();
      }, 1000);
    }
  }

  /**
   * Vizualizează detaliile unei camere
   * @param {string} roomId - ID-ul camerei
   */
  async function viewRoomDetails(roomId) {
    var result = await apiFetch('/api/hotel/rooms/' + roomId);
    if (!result || !result.success) return;

    var room = result.data.room;
    var statusLabel = getRoomStatusLabel(room.status);

    var pricesHtml = '';
    if (room.prețuriSezoniere && room.prețuriSezoniere.length > 0) {
      pricesHtml = '<div class="seasonal-prices" style="margin-top:12px;">' +
        '<table style="width:100%;font-size:13px;">' +
          '<thead><tr><th style="font-size:11px;text-transform:uppercase;font-weight:600;color:var(--color-text-muted);padding:6px 8px;text-align:left;border-bottom:1px solid var(--color-border);">Sezon</th><th style="font-size:11px;text-transform:uppercase;font-weight:600;color:var(--color-text-muted);padding:6px 8px;text-align:left;border-bottom:1px solid var(--color-border);">Preț</th></tr></thead>' +
          '<tbody>';
      room.prețuriSezoniere.forEach(function (p) {
        pricesHtml += '<tr><td style="padding:6px 8px;border-bottom:1px solid var(--color-border);">' + p.sezon + '</td><td style="padding:6px 8px;border-bottom:1px solid var(--color-border);"><strong>' + Number(p.preț).toFixed(2) + ' lei</strong></td></tr>';
      });
      pricesHtml += '</tbody></table></div>';
    }

    var body = '<div class="room-detail-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">' +
      '<div class="room-detail-item" style="padding:10px;background:var(--color-bg);border-radius:var(--radius-sm);">' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--color-text-muted);margin-bottom:4px;">Status</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--color-text);">' + formatRoomStatus(room.status) + '</div>' +
      '</div>' +
      '<div class="room-detail-item" style="padding:10px;background:var(--color-bg);border-radius:var(--radius-sm);">' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--color-text-muted);margin-bottom:4px;">Tip</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--color-text);">' + (room.tip ? room.tip.charAt(0).toUpperCase() + room.tip.slice(1) : 'Nespecificat') + '</div>' +
      '</div>' +
      (room.capacitate ? '<div class="room-detail-item" style="padding:10px;background:var(--color-bg);border-radius:var(--radius-sm);">' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--color-text-muted);margin-bottom:4px;">Capacitate</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--color-text);">' + room.capacitate + ' persoane</div>' +
      '</div>' : '') +
      '<div class="room-detail-item" style="padding:10px;background:var(--color-bg);border-radius:var(--radius-sm);">' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--color-text-muted);margin-bottom:4px;">ID Cameră</div>' +
        '<div style="font-size:12px;font-weight:700;color:var(--color-text);font-family:monospace;">' + room._id + '</div>' +
      '</div>' +
    '</div>' +
    pricesHtml +
    (room.descriere ? '<div style="margin-top:8px;padding:10px;background:var(--color-bg);border-radius:var(--radius-sm);">' +
      '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--color-text-muted);margin-bottom:4px;">Descriere</div>' +
      '<div style="font-size:14px;color:var(--color-text);">' + room.descriere + '</div>' +
    '</div>' : '') +
    '<div style="display:flex;gap:8px;margin-top:16px;">' +
      '<button class="btn btn-primary btn-sm" onclick="closeModal(this.closest(\'.modal-overlay\'));openEditRoomModal(\'' + roomId + '\')"><i class="fas fa-edit"></i> Editează</button>' +
      '<button class="btn btn-secondary btn-sm" onclick="closeModal(this.closest(\'.modal-overlay\'))">Închide</button>' +
    '</div>';

    openModal({
      title: 'Camera ' + room.număr,
      body: body,
      size: 'md',
    });
  }

  /**
   * Returnează eticheta statusului unei camere
   * @param {string} status - Statusul camerei
   * @returns {string} Eticheta
   */
  function getRoomStatusLabel(status) {
    var labels = {
      available: 'Disponibilă',
      occupied: 'Ocupată',
      maintenance: 'Mentenanță',
      cleaning: 'Curățenie',
      reserved: 'Rezervată',
      'out-of-order': 'Indisponibilă',
    };
    return labels[status] || status;
  }

  /**
   * Efectuează check-in într-o cameră
   * @param {string} roomId - ID-ul camerei
   */
  async function checkinRoom(roomId) {
    if (!confirm('Ești sigur că vrei să faci check-in în această cameră?')) return;
    var result = await apiFetch('/api/hotel/