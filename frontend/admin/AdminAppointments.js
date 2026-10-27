// Administrator appointment monitoring — deliberately read-only.
window.AdminAppointments = (() => {
  const { api, escapeHTML, openDialog } = App;
  const fmt = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const label = status => ({ pending:'Pending', confirmed:'Confirmed', 'checked-in':'Checked In', completed:'Completed', cancelled:'Cancelled', 'no-show':'No-show' })[status] || status || 'Unknown';
  const safe = value => escapeHTML(String(value ?? '—'));
  const eye = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  async function render(body, actions) {
    actions.innerHTML = '';
    body.innerHTML = `
      <div class="admin-appt-page">
        <section class="admin-appt-stats" aria-label="Appointment summary">
          <div class="admin-appt-stat"><img class="admin-appt-stat-icon" src="/images/appointments/Total Appointments.png" alt="" aria-hidden="true" loading="lazy"><span>Total Appointments</span><strong id="aTotal">—</strong><small>Bookings in records</small></div>
          <div class="admin-appt-stat"><img class="admin-appt-stat-icon" src="/images/appointments/Upcoming.png" alt="" aria-hidden="true" loading="lazy"><span>Upcoming</span><strong id="aUpcoming">—</strong><small>Pending or confirmed</small></div>
          <div class="admin-appt-stat"><img class="admin-appt-stat-icon" src="/images/appointments/Completed.png" alt="" aria-hidden="true" loading="lazy"><span>Completed</span><strong id="aCompleted">—</strong><small>Finished bookings</small></div>
          <div class="admin-appt-stat"><img class="admin-appt-stat-icon" src="/images/appointments/Cancelled No-show.png" alt="" aria-hidden="true" loading="lazy"><span>Cancelled / No-show</span><strong id="aCancelled">—</strong><small>Unfulfilled bookings</small></div>
        </section>
        <section class="card admin-appt-filters" aria-label="Filter appointments">
          <label class="admin-appt-search"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input type="search" id="aSearch" placeholder="Search customer, service or barber..." aria-label="Search appointments"></label>
          <select id="aStatus" aria-label="Appointment status"><option value="all">All Status</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="checked-in">Checked In</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no-show">No-show</option></select>
          <input type="date" id="aFrom" aria-label="From date" title="From date">
          <input type="date" id="aTo" aria-label="To date" title="To date">
          <select id="aSort" aria-label="Sort appointments"><option value="upcoming">Upcoming First</option><option value="newest">Newest First</option><option value="oldest">Oldest First</option></select>
          <button type="button" id="aClear" class="secondary-btn small" hidden>Clear All</button>
        </section>
        <article class="card admin-appt-table-card">
          <div class="admin-appt-table-heading"><div><h2>Scheduled Appointments</h2><p>Read-only monitoring of customer bookings.</p></div><div class="admin-appt-heading-actions"><span id="aCount" aria-live="polite"></span><button type="button" class="secondary-btn small" id="aRefresh">Refresh</button></div></div>
          <div class="table-wrap"><table class="data-table admin-appt-table"><thead><tr><th>No.</th><th>Customer</th><th>Haircut / Service</th><th>Barber</th><th>Schedule</th><th>Method</th><th>Status</th><th>Actions</th></tr></thead><tbody id="aRows"><tr><td colspan="8" class="muted">Loading appointments...</td></tr></tbody></table></div>
          <div class="admin-appt-pagination"><span id="aSummary"></span><div><button class="secondary-btn small" type="button" id="aPrev">Previous</button><span id="aPage"></span><button class="secondary-btn small" type="button" id="aNext">Next</button></div></div>
        </article>
        <p class="muted small">Monitoring only. Check-ins, cancellations and other booking changes are handled by the Cashier. Showing up to the latest 2,000 bookings.</p>
      </div>`;
    const $ = id => body.querySelector('#' + id);
    const controls = ['aSearch','aStatus','aFrom','aTo','aSort'].map($);
    let records = [], page = 1, loading = false, error = '';
    const perPage = 10;
    const filtered = () => {
      const q = $('aSearch').value.trim().toLowerCase(), status = $('aStatus').value, from = $('aFrom').value, to = $('aTo').value;
      const now = Date.now();
      return records.filter(a => {
        if (status !== 'all' && a.status !== status) return false;
        if (q && ![a.customerName,a.service,a.barberName].some(v => String(v||'').toLowerCase().includes(q))) return false;
        const d = day(a.startsAt);
        return (!from || d >= from) && (!to || d <= to);
      }).sort((a,b) => {
        const aa = new Date(a.startsAt).getTime(), bb = new Date(b.startsAt).getTime();
        if ($('aSort').value === 'newest') return bb-aa;
        if ($('aSort').value === 'oldest') return aa-bb;
        const aFuture = aa >= now && ['pending','confirmed'].includes(a.status);
        const bFuture = bb >= now && ['pending','confirmed'].includes(b.status);
        return aFuture !== bFuture ? (aFuture ? -1 : 1) : aFuture ? aa-bb : bb-aa;
      });
    };
    function draw() {
      const upcoming = records.filter(a => ['pending','confirmed'].includes(a.status) && new Date(a.startsAt).getTime() >= Date.now()).length;
      $('aTotal').textContent = records.length;
      $('aUpcoming').textContent = upcoming;
      $('aCompleted').textContent = records.filter(a => a.status === 'completed').length;
      $('aCancelled').textContent = records.filter(a => ['cancelled','no-show'].includes(a.status)).length;
      $('aClear').hidden = !$('aSearch').value && $('aStatus').value === 'all' && !$('aFrom').value && !$('aTo').value && $('aSort').value === 'upcoming';
      const items = filtered(), pages = Math.max(1, Math.ceil(items.length / perPage)); page = Math.min(page,pages);
      const offset=(page-1)*perPage, visible=items.slice(offset,offset+perPage);
      $('aCount').textContent = `${items.length} appointments`;
      $('aRows').innerHTML = loading ? '<tr><td colspan="8" class="muted">Loading appointments...</td></tr>' : error ? `<tr><td colspan="8" class="muted">${safe(error)}</td></tr>` : visible.length ? visible.map((a,i) => `<tr>
        <td>${offset+i+1}</td><td><strong>${safe(a.customerName)}</strong></td><td>${safe(a.service)}</td><td>${safe(a.barberName)}</td><td>${safe(fmt(a.startsAt))}</td><td>${safe(a.method)}</td>
        <td><span class="status-pill ${['completed','confirmed'].includes(a.status) ? 'completed' : ['cancelled','no-show'].includes(a.status) ? 'cancelled' : ''}">${safe(label(a.status))}</span></td>
        <td><button type="button" class="admin-appt-view" data-view-appointment="${safe(a.id)}" title="View appointment details" aria-label="View appointment for ${safe(a.customerName)}">${eye}</button></td>
      </tr>`).join('') : '<tr><td colspan="8" class="muted">No matching appointments found.</td></tr>';
      $('aSummary').textContent = `Showing ${items.length ? offset+1 : 0}–${Math.min(offset+perPage,items.length)} of ${items.length}`;
      $('aPage').textContent = `Page ${page} of ${pages}`;
      $('aPrev').disabled = loading || page <= 1;
      $('aNext').disabled = loading || page >= pages;
      $('aRefresh').disabled = loading;
    }
    async function load() {
      loading=true; error=''; draw();
      try { const response=await api('/api/appointments/admin'); records=Array.isArray(response)?response:[]; }
      catch(e) { error=e.message || 'Unable to load appointments.'; records=[]; }
      finally { loading=false; draw(); }
    }
    controls.forEach(c => c.addEventListener(c.id==='aSearch' ? 'input' : 'change', () => { page=1; draw(); }));
    $('aClear').addEventListener('click', () => { $('aSearch').value=''; $('aStatus').value='all'; $('aFrom').value=''; $('aTo').value=''; $('aSort').value='upcoming'; page=1; draw(); });
    $('aRefresh').addEventListener('click',load);
    $('aPrev').addEventListener('click',() => {if(page>1){page--;draw();}});
    $('aNext').addEventListener('click',() => {if(page*perPage<filtered().length){page++;draw();}});
    body.addEventListener('click', e => {
      const button=e.target.closest('[data-view-appointment]'); if(!button) return;
      const a=records.find(item=>item.id===button.dataset.viewAppointment); if(!a)return;
      const rows = [['Customer',a.customerName],['Service',a.service],['Barber',a.barberName],['Schedule',fmt(a.startsAt)],['End Time',fmt(a.endsAt)],['Payment Method',a.method],['Price',`₱${Number(a.price||0).toLocaleString('en-PH',{minimumFractionDigits:2})}`],['Status',label(a.status)],['Booked On',fmt(a.createdAt)]];
      openDialog(`<div class="admin-appt-modal"><div class="admin-appt-modal-header"><h2>Appointment Details</h2><span class="admin-appt-readonly">View Only</span></div><div class="admin-appt-modal-grid">${rows.map(([k,v])=>`<div><small>${safe(k)}</small><strong>${safe(v)}</strong></div>`).join('')}</div><div class="admin-appt-modal-footer"><button type="button" class="primary-btn" data-close>Close</button></div></div>`);
    });
    await load();
  }
  return { render };
})();
