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
    var result = await apiFetch('/api/hotel/rooms/' + roomId + '/checkin', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (result && result.success) {
      showToast('Check-in efectuat cu succes!', 'success');
      setTimeout(function () {
        location.reload();
      }, 1000);
    }
  }

  /**
   * Efectuează check-out dintr-o cameră
   * @param {string} roomId - ID-ul camerei
   */
  async function checkoutRoom(roomId) {
    if (!confirm('Ești sigur că vrei să faci check-out din această cameră?')) return;
    var result = await apiFetch('/api/hotel/rooms/' + roomId + '/checkout', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (result && result.success) {
      showToast('Check-out efectuat cu succes!', 'success');
      setTimeout(function () {
        location.reload();
      }, 1000);
    }
  }

  /**
   * Schimbă statusul unei camere
   * @param {string} roomId - ID-ul camerei
   * @param {string} newStatus - Noul status
   */
  async function changeRoomStatus(roomId, newStatus) {
    var result = await apiFetch('/api/hotel/rooms/' + roomId, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus }),
    });

    if (result && result.success) {
      showToast('Statusul camerei a fost actualizat!', 'success');
      setTimeout(function () {
        location.reload();
      }, 1000);
    }
  }

  /**
   * Șterge o cameră
   * @param {string} roomId - ID-ul camerei
   */
  async function deleteRoom(roomId) {
    if (!confirm('Ești sigur că vrei să ștergi această cameră? Această acțiune este ireversibilă.')) return;

    var result = await apiFetch('/api/hotel/rooms/' + roomId, {
      method: 'DELETE',
    });

    if (result && result.success) {
      showToast('Camera a fost ștearsă!', 'success');
      setTimeout(function () {
        location.reload();
      }, 1000);
    }
  }

  // ============================================================
  // RESERVATION MANAGEMENT
  // ============================================================

  /**
   * Încarcă lista de rezervări
   */
  async function loadReservations() {
    var container = document.getElementById('reservationsTableBody');
    if (!container) return;

    showLoading(true);
    try {
      var result = await apiFetch('/api/hotel/reservations');
      var reservations = [];

      if (result && result.success) {
        reservations = result.data?.reservations || result.data || [];
      }

      if (reservations.length === 0) {
        container.innerHTML =
          '<tr><td colspan="8" class="text-center">Nu există rezervări.</td></tr>';
        return;
      }

      container.innerHTML = reservations
        .map(function (r) {
          return (
            '<tr>' +
            '<td>' +
            escapeHtml(r.guestName || r.numeClient || '—') +
            '</td>' +
            '<td>' +
            escapeHtml(r.roomNumber || r.camera || '—') +
            '</td>' +
            '<td>' +
            formatDateShort(r.checkIn || r.checkInDate) +
            '</td>' +
            '<td>' +
            formatDateShort(r.checkOut || r.checkOutDate) +
            '</td>' +
            '<td>' +
            formatNights(r.nights || r.nopti) +
            '</td>' +
            '<td>' +
            formatReservationStatus(r.status) +
            '</td>' +
            '<td>' +
            formatCurrency(r.totalAmount || r.total || 0) +
            '</td>' +
            '<td class="actions-cell">' +
            '<button class="btn btn-sm btn-outline-primary" onclick="viewReservationDetail(\'' +
            r._id +
            '\')" title="Detalii"><i class="fas fa-eye"></i></button>' +
            (r.status === 'confirmed'
              ? '<button class="btn btn-sm btn-outline-success" onclick="confirmCheckinReservation(\'' +
                r._id +
                '\')" title="Check-in"><i class="fas fa-sign-in-alt"></i></button>'
              : '') +
            (r.status !== 'cancelled' && r.status !== 'checked-out'
              ? '<button class="btn btn-sm btn-outline-danger" onclick="cancelReservation(\'' +
                r._id +
                '\')" title="Anulează"><i class="fas fa-ban"></i></button>'
              : '') +
            '</td>' +
            '</tr>'
          );
        })
        .join('');
    } catch (err) {
      if (CONFIG.debug) console.error('loadReservations error:', err);
      showToast('Eroare la încărcarea rezervărilor.', 'error');
    } finally {
      showLoading(false);
    }
  }

  /**
   * Deschide modalul pentru o rezervare nouă
   */
  function openNewReservationModal() {
    var body =
      '<form id="newReservationForm" onsubmit="return false;">' +
      '<div class="form-group">' +
      '<label for="resGuestName">Nume client *</label>' +
      '<input type="text" id="resGuestName" required placeholder="Nume complet" />' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="form-group">' +
      '<label for="resRoomId">Cameră *</label>' +
      '<select id="resRoomId" required><option value="">— Selectează —</option></select>' +
      '</div>' +
      '<div class="form-group">' +
      '<label for="resGuests">Număr persoane</label>' +
      '<input type="number" id="resGuests" min="1" max="10" value="1" />' +
      '</div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="form-group">' +
      '<label for="resCheckIn">Check-in *</label>' +
      '<input type="date" id="resCheckIn" required />' +
      '</div>' +
      '<div class="form-group">' +
      '<label for="resCheckOut">Check-out *</label>' +
      '<input type="date" id="resCheckOut" required />' +
      '</div>' +
      '</div>' +
      '<div class="form-group">' +
      '<label for="resNotes">Note</label>' +
      '<textarea id="resNotes" rows="2" placeholder="Observații..."></textarea>' +
      '</div>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn btn-secondary" onclick="closeModal(document.querySelector(\'.modal-overlay\'))">Anulează</button>' +
      '<button type="submit" class="btn btn-primary" onclick="submitNewReservation()">Creează rezervare</button>' +
      '</div>' +
      '</form>';

    openModal({ title: 'Rezervare nouă', body: body, size: 'md' });

    // Încarcă camerele disponibile
    loadAvailableRoomsForSelect();
  }

  /**
   * Încarcă camerele disponibile pentru select
   */
  async function loadAvailableRoomsForSelect() {
    var select = document.getElementById('resRoomId');
    if (!select) return;

    try {
      var result = await apiFetch('/api/hotel/rooms?status=available');
      var rooms = [];
      if (result && result.success) {
        rooms = result.data?.rooms || result.data || [];
      }

      select.innerHTML = '<option value="">— Selectează —</option>';
      rooms.forEach(function (room) {
        var opt = document.createElement('option');
        opt.value = room._id;
        opt.textContent =
          'Camera ' + room.număr + ' (' + (room.tip || 'standard') + ')';
        select.appendChild(opt);
      });
    } catch (err) {
      if (CONFIG.debug) console.error('loadAvailableRoomsForSelect error:', err);
    }
  }

  /**
   * Trimite formularul de rezervare nouă
   */
  async function submitNewReservation() {
    var guestName = document.getElementById('resGuestName')?.value?.trim();
    var roomId = document.getElementById('resRoomId')?.value;
    var guests = parseInt(document.getElementById('resGuests')?.value || '1', 10);
    var checkIn = document.getElementById('resCheckIn')?.value;
    var checkOut = document.getElementById('resCheckOut')?.value;
    var notes = document.getElementById('resNotes')?.value?.trim();

    if (!guestName || !roomId || !checkIn || !checkOut) {
      showToast('Completează toate câmpurile obligatorii.', 'warning');
      return;
    }

    var payload = {
      guestName: guestName,
      roomId: roomId,
      guests: guests,
      checkIn: checkIn,
      checkOut: checkOut,
      notes: notes || undefined,
    };

    var result = await apiFetch('/api/hotel/reservations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (result && result.success) {
      showToast('Rezervarea a fost creată cu succes!', 'success');
      closeModal(document.querySelector('.modal-overlay'));
      loadReservations();
      loadRooms();
    }
  }

  /**
   * Vizualizează detaliile unei rezervări
   * @param {string} reservationId - ID-ul rezervării
   */
  async function viewReservationDetail(reservationId) {
    var result = await apiFetch('/api/hotel/reservations/' + reservationId);
    if (!result || !result.success) return;

    var r = result.data?.reservation || result.data || {};
    var body =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
      '<div><strong>Client:</strong><br>' +
      escapeHtml(r.guestName || r.numeClient || '—') +
      '</div>' +
      '<div><strong>Cameră:</strong><br>' +
      escapeHtml(r.roomNumber || r.camera || '—') +
      '</div>' +
      '<div><strong>Check-in:</strong><br>' +
      formatDateShort(r.checkIn || r.checkInDate) +
      '</div>' +
      '<div><strong>Check-out:</strong><br>' +
      formatDateShort(r.checkOut || r.checkOutDate) +
      '</div>' +
      '<div><strong>Status:</strong><br>' +
      formatReservationStatus(r.status) +
      '</div>' +
      '<div><strong>Total:</strong><br>' +
      formatCurrency(r.totalAmount || r.total || 0) +
      '</div>' +
      (r.notes
        ? '<div style="grid-column:1/-1;"><strong>Note:</strong><br>' +
          escapeHtml(r.notes) +
          '</div>'
        : '') +
      '</div>' +
      '<div style="margin-top:16px;display:flex;gap:8px;">' +
      '<button class="btn btn-secondary btn-sm" onclick="closeModal(this.closest(\'.modal-overlay\'))">Închide</button>' +
      '</div>';

    openModal({
      title: 'Rezervare ' + (reservationId || '').substring(0, 8),
      body: body,
      size: 'sm',
    });
  }

  /**
   * Confirmă check-in dintr-o rezervare
   * @param {string} reservationId - ID-ul rezervării
   */
  async function confirmCheckinReservation(reservationId) {
    if (!confirm('Ești sigur că vrei să faci check-in pentru această rezervare?'))
      return;
    var result = await apiFetch(
      '/api/hotel/reservations/' + reservationId + '/checkin',
      { method: 'POST', body: JSON.stringify({}) }
    );

    if (result && result.success) {
      showToast('Check-in confirmat!', 'success');
      loadReservations();
      loadRooms();
    }
  }

  /**
   * Anulează o rezervare
   * @param {string} reservationId - ID-ul rezervării
   */
  async function cancelReservation(reservationId) {
    if (!confirm('Ești sigur că vrei să anulezi această rezervare?')) return;
    var result = await apiFetch(
      '/api/hotel/reservations/' + reservationId + '/cancel',
      { method: 'PUT', body: JSON.stringify({}) }
    );

    if (result && result.success) {
      showToast('Rezervarea a fost anulată.', 'success');
      loadReservations();
      loadRooms();
    }
  }

  // ============================================================
  // GUEST MANAGEMENT
  // ============================================================

  /**
   * Încarcă lista de oaspeți
   */
  async function loadGuests() {
    var container = document.getElementById('guestsTableBody');
    if (!container) return;

    showLoading(true);
    try {
      var result = await apiFetch('/api/hotel/guests');
      var guests = [];
      if (result && result.success) {
        guests = result.data?.guests || result.data || [];
      }

      if (guests.length === 0) {
        container.innerHTML =
          '<tr><td colspan="7" class="text-center">Nu există oaspeți.</td></tr>';
        return;
      }

      container.innerHTML = guests
        .map(function (g) {
          return (
            '<tr>' +
            '<td>' +
            escapeHtml(g.name || g.guestName || '—') +
            '</td>' +
            '<td>' +
            escapeHtml(g.roomNumber || g.camera || '—') +
            '</td>' +
            '<td>' +
            formatDateShort(g.checkIn || g.checkInDate) +
            '</td>' +
            '<td>' +
            formatDateShort(g.checkOut || g.checkOutDate || '—') +
            '</td>' +
            '<td>' +
            escapeHtml(g.email || '—') +
            '</td>' +
            '<td>' +
            formatGuestStatus(g.status) +
            '</td>' +
            '<td class="actions-cell">' +
            '<button class="btn btn-sm btn-outline-primary" onclick="viewGuestDetail(\'' +
            g._id +
            '\')" title="Detalii"><i class="fas fa-eye"></i></button>' +
            (g.status === 'checked-in'
              ? '<button class="btn btn-sm btn-outline-success" onclick="checkoutGuest(\'' +
                g._id +
                '\')" title="Check-out"><i class="fas fa-sign-out-alt"></i></button>'
              : '') +
            '</td>' +
            '</tr>'
          );
        })
        .join('');
    } catch (err) {
      if (CONFIG.debug) console.error('loadGuests error:', err);
      showToast('Eroare la încărcarea oaspeților.', 'error');
    } finally {
      showLoading(false);
    }
  }

  /**
   * Vizualizează detaliile unui oaspete
   * @param {string} guestId - ID-ul oaspetelui
   */
  async function viewGuestDetail(guestId) {
    var result = await apiFetch('/api/hotel/guests/' + guestId);
    if (!result || !result.success) return;

    var g = result.data?.guest || result.data || {};
    var body =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
      '<div><strong>Nume:</strong><br>' +
      escapeHtml(g.name || g.guestName || '—') +
      '</div>' +
      '<div><strong>Email:</strong><br>' +
      escapeHtml(g.email || '—') +
      '</div>' +
      '<div><strong>Cameră:</strong><br>' +
      escapeHtml(g.roomNumber || g.camera || '—') +
      '</div>' +
      '<div><strong>Status:</strong><br>' +
      formatGuestStatus(g.status) +
      '</div>' +
      '<div><strong>Check-in:</strong><br>' +
      formatDateShort(g.checkIn || g.checkInDate) +
      '</div>' +
      '<div><strong>Check-out:</strong><br>' +
      formatDateShort(g.checkOut || g.checkOutDate || '—') +
      '</div>' +
      '</div>' +
      '<div style="margin-top:16px;display:flex;gap:8px;">' +
      '<button class="btn btn-secondary btn-sm" onclick="closeModal(this.closest(\'.modal-overlay\'))">Închide</button>' +
      '</div>';

    openModal({
      title: 'Oaspete ' + escapeHtml(g.name || g.guestName || ''),
      body: body,
      size: 'sm',
    });
  }

  /**
   * Efectuează check-out pentru un oaspete
   * @param {string} guestId - ID-ul oaspetelui
   */
  async function checkoutGuest(guestId) {
    if (!confirm('Ești sigur că vrei să faci check-out pentru acest oaspete?'))
      return;
    var result = await apiFetch('/api/hotel/guests/' + guestId + '/checkout', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (result && result.success) {
      showToast('Check-out efectuat cu succes!', 'success');
      loadGuests();
      loadRooms();
    }
  }

  // ============================================================
  // CALENDAR & SEARCH
  // ============================================================

  /**
   * Comută vizibilitatea calendarului
   */
  function toggleCalendar() {
    state.calendarVisible = !state.calendarVisible;
    var calendarEl = document.getElementById('hotelCalendar');
    if (calendarEl) {
      calendarEl.style.display = state.calendarVisible ? 'block' : 'none';
    }
    if (state.calendarVisible) {
      renderCalendar();
    }
  }

  /**
   * Randare simplă calendar
   */
  function renderCalendar() {
    var container = document.getElementById('hotelCalendarBody');
    if (!container) return;

    var d = state.calendarDate;
    var year = d.getFullYear();
    var month = d.getMonth();
    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    // Adjust for Monday as first day
    firstDay = firstDay === 0 ? 6 : firstDay - 1;

    var monthNames = [
      'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
      'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
    ];

    document.getElementById('calendarMonth').textContent =
      monthNames[month] + ' ' + year;

    var html = '<table class="calendar-table"><thead><tr>';
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function (day) {
      html += '<th>' + day + '</th>';
    });
    html += '</tr></thead><tbody><tr>';

    for (var i = 0; i < firstDay; i++) {
      html += '<td></td>';
    }

    for (var day = 1; day <= daysInMonth; day++) {
      if ((firstDay + day - 1) % 7 === 0 && day > 1) {
        html += '</tr><tr>';
      }
      var today = new Date();
      var isToday =
        day === today.getDate() &&
        month === today.getMonth() &&
        year === today.getFullYear();
      html +=
        '<td class="' +
        (isToday ? ' calendar-today' : '') +
        '" onclick="selectCalendarDay(' +
        day +
        ')">' +
        day +
        '</td>';
    }

    html += '</tr></tbody></table>';
    container.innerHTML = html;
  }

  /**
   * Navighează luna calendarului
   * @param {number} direction - -1 pentru luna anterioară, 1 pentru următoarea
   */
  function changeCalendarMonth(direction) {
    state.calendarDate.setMonth(state.calendarDate.getMonth() + direction);
    renderCalendar();
  }

  /**
   * Selectează o zi din calendar
   * @param {number} day - Ziua selectată
   */
  function selectCalendarDay(day) {
    showToast('Ziua ' + day + ' selectată. Rezervările vor fi afișate.', 'info');
    // Filtrare rezervări după dată
  }

  /**
   * Caută în funcție de input
   * @param {Event} e - Evenimentul
   */
  function searchHandler(e) {
    var query = e.target?.value?.trim()?.toLowerCase() || '';
    var currentPage = state.currentPage;

    if (currentPage === 'rooms' || window.location.pathname.includes('rooms')) {
      filterRooms(query);
    } else if (
      currentPage === 'reservations' ||
      window.location.pathname.includes('reservations')
    ) {
      filterReservations(query);
    } else if (
      currentPage === 'guests' ||
      window.location.pathname.includes('guests')
    ) {
      filterGuests(query);
    }
  }

  /**
   * Filtrează camerele după query
   * @param {string} query - Textul de căutare
   */
  function filterRooms(query) {
    var rows = document.querySelectorAll('#roomsTableBody tr');
    rows.forEach(function (row) {
      var text = row.textContent?.toLowerCase() || '';
      row.style.display = text.includes(query) ? '' : 'none';
    });
  }

  /**
   * Filtrează rezervările după query
   * @param {string} query - Textul de căutare
   */
  function filterReservations(query) {
    var rows = document.querySelectorAll('#reservationsTableBody tr');
    rows.forEach(function (row) {
      var text = row.textContent?.toLowerCase() || '';
      row.style.display = text.includes(query) ? '' : 'none';
    });
  }

  /**
   * Filtrează oaspeții după query
   * @param {string} query - Textul de căutare
   */
  function filterGuests(query) {
    var rows = document.querySelectorAll('#guestsTableBody tr');
    rows.forEach(function (row) {
      var text = row.textContent?.toLowerCase() || '';
      row.style.display = text.includes(query) ? '' : 'none';
    });
  }

  // ============================================================
  // DASHBOARD FUNCTIONS
  // ============================================================

  /**
   * Încarcă datele dashboard-ului
   */
  async function loadDashboard() {
    var container = document.getElementById('dashboardStats');
    if (!container) return;

    showLoading(true);
    try {
      var result = await apiFetch('/api/hotel/dashboard');
      if (result && result.success) {
        var stats = result.data || {};

        var totalRooms = document.getElementById('dash-total-rooms');
        var occupiedRooms = document.getElementById('dash-occupied-rooms');
        var availableRooms = document.getElementById('dash-available-rooms');
        var todayCheckins = document.getElementById('dash-today-checkins');
        var todayRevenue = document.getElementById('dash-today-revenue');

        if (totalRooms) totalRooms.textContent = stats.totalRooms || 0;
        if (occupiedRooms) occupiedRooms.textContent = stats.occupiedRooms || 0;
        if (availableRooms) availableRooms.textContent = stats.availableRooms || 0;
        if (todayCheckins) todayCheckins.textContent = stats.todayCheckins || 0;
        if (todayRevenue)
          todayRevenue.textContent = formatCurrency(stats.todayRevenue || 0);

        // Randare grafic simplu
        var chartCanvas = document.getElementById('dashboardChart');
        if (chartCanvas && stats.occupancyHistory) {
          drawDashboardChart(chartCanvas, stats.occupancyHistory);
        }
      }
    } catch (err) {
      if (CONFIG.debug) console.error('loadDashboard error:', err);
    } finally {
      showLoading(false);
    }
  }

  /**
   * Desenează un grafic simplu pe canvas
   * @param {HTMLCanvasElement} canvas - Elementul canvas
   * @param {Array} data - Datele
   */
  function drawDashboardChart(canvas, data) {
    var ctx = canvas.getContext('2d');
    var width = canvas.width || canvas.clientWidth || 400;
    var height = canvas.height || canvas.clientHeight || 200;
    var padding = { top: 20, right: 20, bottom: 30, left: 40 };
    var chartWidth = width - padding.left - padding.right;
    var chartHeight = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    if (!data || data.length === 0) {
      ctx.fillStyle = '#999';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Nu există date', width / 2, height / 2);
      return;
    }

    var maxValue = Math.max.apply(
      null,
      data.map(function (d) {
        return d.value || 0;
      })
    );
    if (maxValue === 0) maxValue = 1;

    var barWidth = Math.min(chartWidth / data.length - 6, 30);
    var barSpacing = (chartWidth - barWidth * data.length) / (data.length + 1);

    // Grid lines
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var y = padding.top + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    // Bars
    data.forEach(function (item, index) {
      var barHeight = ((item.value || 0) / maxValue) * chartHeight;
      var x = padding.left + barSpacing + index * (barWidth + barSpacing);
      var y = padding.top + chartHeight - barHeight;

      var gradient = ctx.createLinearGradient(x, y, x, padding.top + chartHeight);
      gradient.addColorStop(0, '#6f42c1');
      gradient.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = gradient;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
      } else {
        ctx.rect(x, y, barWidth, barHeight);
      }
      ctx.fill();

      // Label
      ctx.fillStyle = '#666';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        item.label || '',
        x + barWidth / 2,
        padding.top + chartHeight + 16
      );
    });
  }

  /**
   * Reîncarcă dashboard-ul
   */
  function refreshDashboard() {
    loadDashboard();
    loadReservations();
    loadGuests();
  }

  // ============================================================
  // ROOMS LOADING (page-specific)
  // ============================================================

  /**
   * Încarcă toate camerele
   */
  async function loadRooms() {
    var container = document.getElementById('roomsTableBody');
    if (!container) return;

    showLoading(true);
    try {
      var result = await apiFetch('/api/hotel/rooms');
      var rooms = [];
      if (result && result.success) {
        rooms = result.data?.rooms || result.data || [];
      }

      if (rooms.length === 0) {
        container.innerHTML =
          '<tr><td colspan="7" class="text-center">Nu există camere.</td></tr>';
        return;
      }

      container.innerHTML = rooms
        .map(function (room) {
          return (
            '<tr>' +
            '<td><strong>' +
            escapeHtml(String(room.număr || '—')) +
            '</strong></td>' +
            '<td>' +
            escapeHtml(
              room.tip
                ? room.tip.charAt(0).toUpperCase() + room.tip.slice(1)
                : '—'
            ) +
            '</td>' +
            '<td>' +
            (room.capacitate || '—') +
            '</td>' +
            '<td>' +
            formatRoomStatus(room.status) +
            '</td>' +
            '<td>' +
            (room.prețuriSezoniere && room.prețuriSezoniere.length > 0
              ? formatCurrency(room.prețuriSezoniere[0].preț || 0)
              : '—') +
            '</td>' +
            '<td>' +
            escapeHtml(room.descriere ? room.descriere.substring(0, 60) + (room.descriere.length > 60 ? '...' : '') : '—') +
            '</td>' +
            '<td class="actions-cell">' +
            '<button class="btn btn-sm btn-outline-primary" onclick="viewRoomDetails(\'' +
            room._id +
            '\')" title="Detalii"><i class="fas fa-eye"></i></button>' +
            '<button class="btn btn-sm btn-outline-info" onclick="openEditRoomModal(\'' +
            room._id +
            '\')" title="Editează"><i class="fas fa-edit"></i></button>' +
            (room.status === 'available'
              ? '<button class="btn btn-sm btn-outline-success" onclick="checkinRoom(\'' +
                room._id +
                '\')" title="Check-in"><i class="fas fa-sign-in-alt"></i></button>'
              : '') +
            (room.status === 'occupied'
              ? '<button class="btn btn-sm btn-outline-warning" onclick="checkoutRoom(\'' +
                room._id +
                '\')" title="Check-out"><i class="fas fa-sign-out-alt"></i></button>'
              : '') +
            '<button class="btn btn-sm btn-outline-danger" onclick="deleteRoom(\'' +
            room._id +
            '\')" title="Șterge"><i class="fas fa-trash"></i></button>' +
            '</td>' +
            '</tr>'
          );
        })
        .join('');

      // Update room stats
      updateRoomStats(rooms);
    } catch (err) {
      if (CONFIG.debug) console.error('loadRooms error:', err);
      showToast('Eroare la încărcarea camerelor.', 'error');
    } finally {
      showLoading(false);
    }
  }

  /**
   * Actualizează statisticile camerelor
   * @param {Array} rooms - Lista camerelor
   */
  function updateRoomStats(rooms) {
    var totalEl = document.getElementById('rooms-total-count');
    var availableEl = document.getElementById('rooms-available-count');
    var occupiedEl = document.getElementById('rooms-occupied-count');
    var maintenanceEl = document.getElementById('rooms-maintenance-count');

    if (totalEl) totalEl.textContent = rooms.length;
    if (availableEl)
      availableEl.textContent = rooms.filter(function (r) {
        return r.status === 'available';
      }).length;
    if (occupiedEl)
      occupiedEl.textContent = rooms.filter(function (r) {
        return r.status === 'occupied';
      }).length;
    if (maintenanceEl)
      maintenanceEl.textContent = rooms.filter(function (r) {
        return r.status === 'maintenance';
      }).length;
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /**
   * Inițializează funcțiile specifice paginii
   */
  function initPage() {
    var page = state.currentPage;

    switch (page) {
      case 'rooms':
        loadRooms();
        break;
      case 'reservations':
        loadReservations();
        break;
      case 'guests':
        loadGuests();
        break;
      case 'dashboard':
        loadDashboard();
        break;
      case 'deliveries':
      case 'inventory':
      case 'suppliers':
        // Acestea sunt gestionate de restaurant.js
        break;
      default:
        // Dashboard implicit
        loadDashboard();
        break;
    }

    // Setează search handler
    var searchInput = document.getElementById('hotelSearch');
    if (searchInput) {
      searchInput.addEventListener('keyup', debounce(searchHandler, 300));
    }

    // Auto-refresh
    if (CONFIG.refreshInterval > 0) {
      state.refreshTimer = setInterval(function () {
        if (!state.isRefreshing) {
          state.isRefreshing = true;
          initPage();
          setTimeout(function () {
            state.isRefreshing = false;
          }, 500);
        }
      }, CONFIG.refreshInterval);
    }
  }

  /**
   * Debounce helper
   * @param {Function} fn - Funcția
   * @param {number} delay - Întârzierea
   * @returns {Function} Funcția cu debounce
   */
  function debounce(fn, delay) {
    var timer;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(ctx, args);
      }, delay || 300);
    };
  }

  /**
   * Escape HTML
   * @param {string} text - Textul
   * @returns {string} Textul escapet
   */
  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

  /**
   * Afișează / ascunde loading
   * @param {boolean} show
   */
  function showLoading(show) {
    var loader = document.getElementById('loadingOverlay');
    if (loader) {
      loader.style.display = show ? 'flex' : 'none';
    }
  }

  // ============================================================
  // EXPOSE GLOBALLY
  // ============================================================
  window.showToast = showToast;
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.confirmDialog = confirmDialog;
  window.formatCurrency = formatCurrency;
  window.formatDate = formatDate;
  window.formatDateShort = formatDateShort;
  window.formatRoomStatus = formatRoomStatus;
  window.formatReservationStatus = formatReservationStatus;
  window.formatGuestStatus = formatGuestStatus;
  window.formatNights = formatNights;
  window.formatAddress = formatAddress;
  window.switchHotel = switchHotel;
  window.openAddRoomModal = openAddRoomModal;
  window.submitAddRoom = submitAddRoom;
  window.openEditRoomModal = openEditRoomModal;
  window.submitEditRoom = submitEditRoom;
  window.viewRoomDetails = viewRoomDetails;
  window.checkinRoom = checkinRoom;
  window.checkoutRoom = checkoutRoom;
  window.changeRoomStatus = changeRoomStatus;
  window.deleteRoom = deleteRoom;
  window.loadReservations = loadReservations;
  window.openNewReservationModal = openNewReservationModal;
  window.submitNewReservation = submitNewReservation;
  window.viewReservationDetail = viewReservationDetail;
  window.confirmCheckinReservation = confirmCheckinReservation;
  window.cancelReservation = cancelReservation;
  window.loadGuests = loadGuests;
  window.viewGuestDetail = viewGuestDetail;
  window.checkoutGuest = checkoutGuest;
  window.toggleCalendar = toggleCalendar;
  window.changeCalendarMonth = changeCalendarMonth;
  window.selectCalendarDay = selectCalendarDay;
  window.searchHandler = searchHandler;
  window.loadDashboard = loadDashboard;
  window.refreshDashboard = refreshDashboard;
  window.loadRooms = loadRooms;

  // ============================================================
  // STARTUP
  // ============================================================
  document.addEventListener('DOMContentLoaded', function () {
    initPage();
  });

  // Curăță timer-ul la ieșire
  window.addEventListener('beforeunload', function () {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
    }
  });

})();