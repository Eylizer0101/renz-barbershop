// Staff appointment overview and booking-status management.

(function () {

  const { api, escapeHTML, busy, toast } = App;

  const when = value => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

  const clock = value => new Date(value).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

  const dateOnly = value => new Date(value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long" });

  const statusLabel = value => ({ pending: "Pending", confirmed: "Confirmed", "checked-in": "Checked in", cancelled: "Cancelled", "no-show": "No-show", completed: "Completed" })[value] || value;

  const eyeIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';



  // Scoped styles: the existing app.css was not supplied with these files.

  if (!document.getElementById('renz-cashier-appointment-ui')) {

    const style = document.createElement('style');

    style.id = 'renz-cashier-appointment-ui';

    style.textContent = `

      .cashier-visits-style .cashier-appointment-number{color:#857364;font-weight:700;white-space:nowrap}

      .cashier-visits-style .cashier-appointment-customer{display:flex;align-items:center;gap:11px;min-width:160px}

      .cashier-visits-style .cashier-appointment-avatar{width:36px;height:36px;border-radius:50%;flex:none;object-fit:cover;background:#eee5d8;color:#66462d;display:grid;place-items:center;font-weight:750;font-size:12px;overflow:hidden}

      .cashier-visits-style .cashier-appointment-avatar img{width:100%;height:100%;object-fit:cover}

      .cashier-visits-style .cashier-ops-actions{display:flex;align-items:center;gap:7px;flex-wrap:nowrap;white-space:nowrap}

      .cashier-visits-style .cashier-appointment-view{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid #e8ded2;border-radius:10px;background:#fff;color:#6c492c;cursor:pointer;flex:none}

      .cashier-visits-style .cashier-appointment-view:hover{background:#f7f0e7;border-color:#c4a277}

      .cashier-visits-style .cashier-appointment-more{position:relative;flex:none}

      .cashier-visits-style .cashier-appointment-more summary{list-style:none;width:36px;height:36px;display:grid;place-items:center;border:1px solid #e8ded2;border-radius:10px;background:#fff;cursor:pointer;font-size:22px;color:#65452e}

      .cashier-visits-style .cashier-appointment-more summary::-webkit-details-marker{display:none}

      .cashier-visits-style .cashier-appointment-menu{position:absolute;right:0;top:calc(100% + 5px);z-index:30;min-width:140px;border:1px solid #ebded0;background:#fff;border-radius:10px;box-shadow:0 12px 30px #21160b29;padding:5px}

      .cashier-visits-style .cashier-appointment-menu button{display:block;width:100%;text-align:left;border:0;border-radius:6px;background:transparent;padding:9px 10px;cursor:pointer;color:#6e372b}

      .cashier-visits-style .cashier-appointment-menu button:hover{background:#f9eee6}

      .cashier-visits-style .cashier-appointment-action{white-space:nowrap}

      .cashier-visits-style .cashier-appointment-action:disabled{cursor:not-allowed;opacity:.5}

      .cashier-visits-style .cashier-ops-data th,.cashier-visits-style .cashier-ops-data td{vertical-align:middle}

      .cashier-visits-style .cashier-ops-table .table-wrap{overflow-x:auto}

      /* Override the shared .dialog / .card sizing only for appointment details. */

      .dialog-backdrop .dialog:has(> .cashier-appointment-modal){box-sizing:border-box;width:min(620px,calc(100vw - 32px));max-width:620px;max-height:min(90vh,800px);padding:0;overflow-x:hidden;overflow-y:auto;border-radius:16px;background:#fff;color:#3a2a1f;box-shadow:0 22px 70px #0003}

      .dialog-backdrop .dialog > .cashier-appointment-modal{box-sizing:border-box;width:100%;max-width:none;min-width:0;overflow:hidden}

      .cashier-appointment-modal{max-width:100%;width:100%;min-width:0}

      .cashier-appointment-modal .cashier-appointment-modal-top{display:flex;justify-content:space-between;align-items:center;gap:15px;margin:0;padding:23px 26px 18px;border-bottom:1px solid #eee8e2}

      .cashier-appointment-modal .cashier-appointment-modal-top h2{margin:0;font-size:21px;color:#493420}

      .cashier-appointment-modal .cashier-appointment-modal-top button{border:0;background:#f4eee7;border-radius:9px;width:34px;height:34px;cursor:pointer;font-size:23px}

      .cashier-appointment-modal .cashier-appointment-modal-customer{display:flex;gap:13px;align-items:center;background:#faf6f1;border:1px solid #eee1d1;border-radius:13px;padding:15px;margin:20px 26px 22px;min-width:0}

      .cashier-appointment-modal .cashier-appointment-avatar{width:48px;height:48px;border-radius:50%;object-fit:cover;background:#e8dbc9;display:grid;place-items:center;color:#5c3d23;font-weight:800;overflow:hidden;flex:none}

      .cashier-appointment-modal .cashier-appointment-avatar img{width:100%;height:100%;object-fit:cover}

      .cashier-appointment-modal .cashier-appointment-modal-customer small{display:block;color:#887766}

      .cashier-appointment-modal .cashier-appointment-modal-customer strong{font-size:17px;color:#3a2a1f}

      .cashier-appointment-modal .cashier-appointment-modal-grid{display:grid;box-sizing:border-box;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 26px;padding:0 26px 24px;min-width:0}

      .cashier-appointment-modal .cashier-appointment-modal-grid > div{min-width:0}

      .cashier-appointment-modal .cashier-appointment-modal-grid small{display:block;color:#8c7b6b;margin-bottom:5px}

      .cashier-appointment-modal .cashier-appointment-modal-grid strong{color:#493420;overflow-wrap:anywhere}

      .cashier-appointment-modal .cashier-appointment-modal-footer{display:flex;justify-content:flex-end;margin:0;padding:16px 26px 20px;border-top:1px solid #eee8e2;background:#fff}

      @media(max-width:540px){.dialog-backdrop{padding:12px}.dialog-backdrop .dialog:has(> .cashier-appointment-modal){width:calc(100vw - 24px);max-height:calc(100dvh - 24px)}.cashier-appointment-modal .cashier-appointment-modal-top{padding:18px}.cashier-appointment-modal .cashier-appointment-modal-customer{margin:18px;padding:12px}.cashier-appointment-modal .cashier-appointment-modal-grid{grid-template-columns:1fr;gap:15px;padding:0 18px 22px}.cashier-appointment-modal .cashier-appointment-modal-footer{padding:14px 18px 18px}}

    `;

    document.head.appendChild(style);

  }



  function avatar(a) {

    const fallback = '/images/profile.jpg';

    const savedPhoto = typeof a.customerPhotoUrl === 'string' ? a.customerPhotoUrl.trim() : '';

    // Account profile photos are stored as JPEG data URLs; App.safePhoto() only

    // accepts web URLs, so these saved photos must be checked separately.

    const photo = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(savedPhoto)

      ? savedPhoto : App.safePhoto(savedPhoto) || fallback;

    return `<span class="cashier-appointment-avatar"><img src="${escapeHTML(photo)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'"></span>`;

  }



  function viewDetails(a) {

    const detail = (label, value) => `<div><small>${label}</small><strong>${value}</strong></div>`;

    const modal = App.openDialog(`

      <div class="cashier-appointment-modal">

        <header class="cashier-appointment-modal-top"><h2>Appointment Details</h2><button type="button" data-close aria-label="Close appointment details">×</button></header>

        <div class="cashier-appointment-modal-customer">${avatar(a)}<div><small>Customer</small><strong>${escapeHTML(a.customerName || 'Customer')}</strong></div></div>

        <div class="cashier-appointment-modal-grid">

          ${detail('Haircut / Services', escapeHTML(a.service || '—'))}

          ${detail('Assigned Barber', escapeHTML(a.barberName || '—'))}

          ${detail('Appointment Date', escapeHTML(dateOnly(a.startsAt)))}

          ${detail('Appointment Time', escapeHTML(clock(a.startsAt)))}

          ${detail('Arrive By', escapeHTML(clock(new Date(a.startsAt).getTime() - 10 * 60000)))}

          ${detail('Booking Method', escapeHTML(String(a.method || '—').toUpperCase()))}

          ${detail('Status', `<span class="cashier-ops-status cashier-ops-status--${escapeHTML(a.status)}">${escapeHTML(statusLabel(a.status))}</span>`)}

        </div>

        <footer class="cashier-appointment-modal-footer"><button class="primary-btn" data-close type="button">Close</button></footer>

      </div>`);

    modal.element.classList.add('cashier-appointment-modal');

  }



  async function render(body, actions) {

    if (body._cashierAppointmentRefresh) clearInterval(body._cashierAppointmentRefresh);

    if (body._cashierAppointmentClick) body.removeEventListener('click', body._cashierAppointmentClick);

    let appointments = [], search = "", status = "all", dateFrom = "", dateTo = "", order = "upcoming", page = 1;

    const pageSize = 10;

    actions.innerHTML = "";

    body.innerHTML = `<section class="cashier-ops-modern cashier-visits-style">

      <div class="cashier-ops-filters">

        <label class="cashier-ops-search"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input id="appointmentSearch" type="search" placeholder="Search customer, haircut or barber..." aria-label="Search appointments"></label>

        <select id="appointmentStatus" aria-label="Filter status"><option value="all">All Status</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="checked-in">Checked in</option><option value="cancelled">Cancelled</option><option value="no-show">No-show</option></select>

        <input id="appointmentFrom" type="date" aria-label="Appointments from date" title="From date">

        <input id="appointmentTo" type="date" aria-label="Appointments to date" title="To date">

        <select id="appointmentSort" aria-label="Sort appointments"><option value="upcoming">Upcoming First</option><option value="latest">Newest First</option><option value="soonest">Oldest First</option><option value="customer">Customer A–Z</option></select>

        <button class="cashier-clear-filters hidden" id="appointmentClear" type="button">Clear All</button>

      </div>

      <section class="cashier-ops-table"><header class="cashier-visits-table-heading"><h3>Scheduled Appointments</h3><span id="appointmentCount" class="muted"></span></header><div class="table-wrap"><table class="data-table cashier-ops-data"><thead><tr><th>No.</th><th>Customer</th><th>Haircut</th><th>Barber</th><th>Schedule / Arrive by</th><th>Method</th><th>Status</th><th>Actions</th></tr></thead><tbody id="appointmentRows"><tr><td colspan="8">Loading appointments…</td></tr></tbody></table></div><div class="cashier-ops-pager" id="appointmentPager"></div></section>

    </section>`;

    const $ = selector => body.querySelector(selector);

    function draw() {

      const now = Date.now();

      $("#appointmentClear").classList.toggle("hidden", !(search || status !== "all" || dateFrom || dateTo || order !== "upcoming"));

      const filtered = appointments.filter(a => {

        const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(a.startsAt));

        const part = type => dateParts.find(x => x.type === type)?.value || '';

        const day = `${part('year')}-${part('month')}-${part('day')}`;

        return (status === 'all' || a.status === status) &&

          (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo) &&

          `${a.customerName || ''} ${a.service || ''} ${a.barberName || ''}`.toLowerCase().includes(search);

      }).sort((a, b) => {
          if (order === 'customer') return String(a.customerName || '').localeCompare(String(b.customerName || ''));
          const aTime = new Date(a.startsAt).getTime();
          const bTime = new Date(b.startsAt).getTime();
          if (order === 'latest') return bTime - aTime;
          if (order === 'soonest') return aTime - bTime;
          // Show the nearest upcoming bookings first. Past appointments follow,
          // while already handled/cancelled bookings are kept at the bottom.
          const active = a => ['pending', 'confirmed'].includes(a.status);
          const aGroup = active(a) ? (aTime >= now ? 0 : 1) : 2;
          const bGroup = active(b) ? (bTime >= now ? 0 : 1) : 2;
          if (aGroup !== bGroup) return aGroup - bGroup;
          return aGroup === 0 ? aTime - bTime : bTime - aTime;
        });

      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));

      page = Math.min(page, pages);

      const showing = filtered.slice((page - 1) * pageSize, page * pageSize);

      $('#appointmentCount').textContent = `${filtered.length} appointment${filtered.length === 1 ? '' : 's'}`;

      $('#appointmentRows').innerHTML = showing.length ? showing.map((a, index) => {

        const id = escapeHTML(a.id);

        const checkinAllowed = a.status === 'confirmed' && now >= new Date(a.startsAt).getTime() - 10 * 60000 && now <= new Date(a.startsAt).getTime() + 60 * 60000;

        const primary = a.status === 'pending'

          ? `<button class="primary-btn small cashier-appointment-action" data-book-status="confirmed" data-id="${id}">Approve</button>`

          : a.status === 'confirmed' ? `<button class="primary-btn small cashier-appointment-action" data-book-checkin="${id}" ${checkinAllowed ? '' : 'disabled title="Check-in is available from 10 minutes before to 60 minutes after the appointment."'}>Check In</button>` : '';

        const menu = ['confirmed', 'pending'].includes(a.status) ? `<details class="cashier-appointment-more"><summary aria-label="More actions for ${escapeHTML(a.customerName)}" title="More actions">⋯</summary><div class="cashier-appointment-menu">${a.status === 'confirmed' && new Date(a.startsAt).getTime() <= now ? `<button type="button" data-book-status="no-show" data-id="${id}">Mark No-show</button>` : ''}<button type="button" data-book-cancel="${id}">Cancel Appointment</button></div></details>` : '';

        return `<tr><td class="cashier-appointment-number">${(page - 1) * pageSize + index + 1}</td><td><div class="cashier-appointment-customer">${avatar(a)}<strong>${escapeHTML(a.customerName)}</strong></div></td><td>${escapeHTML(a.service)}</td><td>${escapeHTML(a.barberName)}</td><td>${when(a.startsAt)}<br><small class="muted">Arrive by ${clock(new Date(a.startsAt).getTime() - 10 * 60000)}</small></td><td>${escapeHTML(a.method)}</td><td><span class="cashier-ops-status cashier-ops-status--${escapeHTML(a.status)}">${escapeHTML(statusLabel(a.status))}</span></td><td><div class="cashier-ops-actions"><button type="button" class="cashier-appointment-view" data-appointment-view="${id}" aria-label="View details for ${escapeHTML(a.customerName)}" title="View Details">${eyeIcon}</button>${primary}${menu}</div></td></tr>`;

      }).join('') : '<tr><td class="cashier-ops-empty" colspan="8">No matching appointments.</td></tr>';

      $('#appointmentPager').innerHTML = `<span>Showing ${filtered.length ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, filtered.length)} of ${filtered.length}</span><div><button class="secondary-btn small" data-appointment-page="prev" ${page === 1 ? 'disabled' : ''}>Previous</button><span>Page ${page} of ${pages}</span><button class="secondary-btn small" data-appointment-page="next" ${page === pages ? 'disabled' : ''}>Next</button></div>`;

    }

    let loading = false;

    async function load() {

      if (loading) return;

      loading = true;

      try {

        const list = await api('/api/appointments/staff');

        appointments = Array.isArray(list) ? list : [];

        draw();

      } finally { loading = false; }

    }

    $("#appointmentClear").addEventListener("click", () => {

      search = ""; status = "all"; dateFrom = ""; dateTo = ""; order = "upcoming"; page = 1;

      for (const [id, value] of [["appointmentSearch", ""], ["appointmentStatus", "all"], ["appointmentFrom", ""], ["appointmentTo", ""], ["appointmentSort", "upcoming"]]) $("#" + id).value = value;

      draw();

    });

    for (const [id, setter] of [['appointmentSearch', value => search = value.trim().toLowerCase()], ['appointmentStatus', value => status = value], ['appointmentFrom', value => dateFrom = value], ['appointmentTo', value => dateTo = value], ['appointmentSort', value => order = value]]) {

      $("#" + id).addEventListener(id === 'appointmentSearch' ? 'input' : 'change', event => { setter(event.target.value); page = 1; draw(); });

    }

    const handleAppointmentClick = async event => {

      const move = event.target.closest('[data-appointment-page]');

      if (move) { page += move.dataset.appointmentPage === 'next' ? 1 : -1; draw(); return; }

      const view = event.target.closest('[data-appointment-view]');

      if (view) { const a = appointments.find(item => String(item.id) === view.dataset.appointmentView); if (a) viewDetails(a); return; }

      const btn = event.target.closest('[data-book-status], [data-book-cancel], [data-book-checkin]');

      if (!btn) return;

      const id = btn.dataset.id || btn.dataset.bookCancel || btn.dataset.bookCheckin;

      const a = appointments.find(item => String(item.id) === String(id));

      if (!a) return;

      const isCancel = !!btn.dataset.bookCancel;

      const isCheckin = !!btn.dataset.bookCheckin;

      const isNoShow = btn.dataset.bookStatus === 'no-show';

      const confirmed = await App.confirmDialog(

        isCancel ? `Cancel the appointment for ${a.customerName}? The customer will be notified.` :

        isCheckin ? `Confirm ${a.customerName} has arrived? A queue ticket will be created.` :

        isNoShow ? `Mark ${a.customerName} as no-show? The customer will be notified.` :

        `Approve the appointment for ${a.customerName}? The customer will be notified.`,

        { title: isCancel ? 'Cancel appointment' : isCheckin ? 'Confirm customer check-in' : isNoShow ? 'Mark as no-show' : 'Approve appointment', confirmText: isCancel ? 'Cancel appointment' : isCheckin ? 'Confirm Check In' : isNoShow ? 'Mark No-show' : 'Confirm Approval', danger: isCancel || isNoShow }

      );

      if (!confirmed) return;

      await busy(btn, async () => { try {

        const result = await api(isCancel ? `/api/appointments/${id}/cancel` : isCheckin ? `/api/appointments/${id}/checkin` : `/api/appointments/${id}/status`, { method: 'POST', body: btn.dataset.bookStatus ? { status: btn.dataset.bookStatus } : {} });

        toast(result.message || 'Appointment updated.');

        if (isCheckin) {

          // The API has already created the waiting queue ticket. Open Front Desk

          // so its existing live-queue renderer loads the checked-in customer.

          window.location.hash = '#desk';

          return;

        }

        await load();

      } catch (err) { toast(err.message, 'error'); } });

    };

    body._cashierAppointmentClick = handleAppointmentClick;

    body.addEventListener('click', handleAppointmentClick);

    await load();

    body._cashierAppointmentRefresh = setInterval(() => {

      if (!body.isConnected || !body.querySelector('.cashier-visits-style')) { clearInterval(body._cashierAppointmentRefresh); return; }

      if (document.visibilityState !== 'hidden' && !document.querySelector('.dialog-backdrop')) load().catch(() => {});

    }, 30000);

  }

  window.CashierAppointments = { render };

})();
