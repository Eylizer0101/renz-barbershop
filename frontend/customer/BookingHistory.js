// Customer's own scheduled appointments (not other customers' bookings).
(function(){
  const {api,escapeHTML,money,busy}=App;
  const PH='Asia/Manila';
  const ACTIVE=['pending','confirmed','checked-in'];
  const CHANGEABLE=['pending','confirmed'];
  const twoHours=2*60*60*1000;
  let all=[];
  let currentTab='upcoming';
  let refreshVersion=0;

  const dateParts=value=>new Intl.DateTimeFormat('en-US',{timeZone:PH,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const dateKey=value=>{const p=dateParts(value),get=t=>p.find(x=>x.type===t)?.value;return `${get('year')}-${get('month')}-${get('day')}`;};
  const dateLabel=value=>new Intl.DateTimeFormat('en-PH',{timeZone:PH,weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date(value));
  const timeLabel=value=>new Intl.DateTimeFormat('en-PH',{timeZone:PH,hour:'numeric',minute:'2-digit'}).format(new Date(value));
  const normalizedStatus=value=>String(value||'').toLowerCase();
  const inFuture=a=>new Date(a.startsAt).getTime()>Date.now();
  const upcoming=a=>ACTIVE.includes(normalizedStatus(a.status))&&inFuture(a);
  const eligible=a=>CHANGEABLE.includes(normalizedStatus(a.status))&&new Date(a.startsAt).getTime()>Date.now()+twoHours;
  const esc=escapeHTML;
  const statusLabel={pending:'Pending',confirmed:'Confirmed','checked-in':'Checked in',completed:'Completed',cancelled:'Cancelled','no-show':'No-show'};
  const statusBadge=a=>`<span class="appointment-badge appointment-badge--${esc(normalizedStatus(a.status))}">${esc(statusLabel[normalizedStatus(a.status)]||a.status)}</span>`;

  const photoFor=a=>App.safePhoto(a.imageUrl);
  function card(a){
    const canCancel=CHANGEABLE.includes(normalizedStatus(a.status))&&inFuture(a);
    const canChange=eligible(a);
    const photo=photoFor(a);
    const canRemove=currentTab==='history'&&!upcoming(a);
    return `<article class="appointment-card" aria-label="${esc(a.service)} appointment on ${esc(dateLabel(a.startsAt))}">
      <div class="appointment-card__image">${photo?`<img src="${esc(photo)}" alt="${esc(a.service)} haircut" loading="lazy">`:'<span>Haircut photo unavailable</span>'}</div>
      <div class="appointment-card__body"><div class="appointment-card__top"><div class="appointment-card__headline"><span class="appointment-card__eyebrow">${esc(dateLabel(a.startsAt))}</span><h3>${esc(a.service)}</h3><p class="appointment-card__time"><span aria-hidden="true">◷</span> ${esc(timeLabel(a.startsAt))}</p></div>${statusBadge(a)}</div>
      <div class="appointment-card__facts">
        <div><span>Assigned barber</span><strong>${esc(a.barberName||'Not assigned')}</strong></div>
        <div><span>Duration</span><strong>${esc(a.durationMinutes)} minutes</strong></div>
        <div><span>Price</span><strong>${money(a.price)}</strong></div>
        <div><span>Required arrival</span><strong>${esc(timeLabel(new Date(new Date(a.startsAt).getTime()-10*60000)))}</strong></div><div><span>Payment method</span><strong>${esc(String(a.method||'—').toUpperCase())}</strong></div>
      </div>
      <div class="appointment-card__bottom"><div class="appointment-card__actions" style="grid-template-columns:repeat(${Number(canChange)+Number(canCancel)+Number(canRemove)||1},minmax(0,1fr))">
        ${canChange?`<button type="button" class="appointment-reschedule-btn" data-appointment-action="edit" data-id="${esc(a.id)}">Edit Appointment</button>`:''}
        ${canCancel?`<button type="button" class="danger-btn" data-appointment-action="cancel" data-id="${esc(a.id)}">Cancel</button>`:''}
        ${canRemove?`<button type="button" class="appointment-remove-history-btn" data-appointment-action="remove-history" data-id="${esc(a.id)}" aria-label="Remove ${esc(a.service)} appointment from history"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v7m4-7v7"/></svg> Remove from History</button>`:''}
      </div>${!canChange&&canCancel?'<small class="appointment-card__notice">Editing closes 2 hours before your appointment.</small>':''}</div>
      </div>
    </article>`;
  }

  function draw(){
    const panel=document.getElementById('appointmentsContent');if(!panel)return;
    const future=all.filter(upcoming).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt));
    const history=all.filter(a=>!upcoming(a)).sort((a,b)=>new Date(b.startsAt)-new Date(a.startsAt));
    const shown=currentTab==='upcoming'?future:history;
    panel.innerHTML=`<div class="appointment-ui">
      <div class="appointment-ui__header"><button type="button" class="appointment-new-btn" data-appointment-action="new">+ Book appointment</button></div>
      <div class="appointment-overview" aria-label="Appointment summary"><div><strong>${future.length}</strong><span>Upcoming appointments</span><span class="appointment-overview__watermark" aria-hidden="true"><img src="/images/customerDashboard/UpcomingAppointments.png" alt="" loading="lazy" decoding="async"></span></div><div><strong>${history.length}</strong><span>Booking history</span><span class="appointment-overview__watermark" aria-hidden="true"><img src="/images/customerDashboard/MyVisit.png" alt="" loading="lazy" decoding="async"></span></div></div>
      <div class="appointment-tabs" role="group" aria-label="Appointment list filter"><button type="button" data-appointment-tab="upcoming" class="${currentTab==='upcoming'?'active':''}" aria-pressed="${currentTab==='upcoming'}">Upcoming <span>${future.length}</span></button><button type="button" data-appointment-tab="history" class="${currentTab==='history'?'active':''}" aria-pressed="${currentTab==='history'}">History <span>${history.length}</span></button></div>
      ${shown.length?`<div class="appointment-card-grid">${shown.map(card).join('')}</div>`:`<div class="appointment-empty"><span class="appointment-empty__icon" aria-hidden="true">▣</span><h2>${currentTab==='upcoming'?'No upcoming appointments':'No booking history yet'}</h2><p>${currentTab==='upcoming'?'You have no scheduled visits. Book a haircut to get started.':'Your completed, cancelled, and previous bookings will appear here.'}</p>${currentTab==='upcoming'?'<button class="appointment-new-btn" type="button" data-appointment-action="new">Book your first appointment</button>':''}</div>`}
      <p class="appointment-footnote">Appointments are updated when you open this page. Check in at the counter when you arrive.</p>
    </div>`;
  }

  async function refresh(){
    const panel=document.getElementById('appointmentsContent');if(!panel)return;
    const version=++refreshVersion;
    if(!App.state.signedIn){
      all=[];
      panel.innerHTML=`<section class="customer-appointment-guest" aria-labelledby="guestAppointmentsTitle">
        <img class="customer-appointment-guest__image" src="/images/customerDashboard/UpcomingAppointments.png" alt="" decoding="async">
        <span class="customer-appointment-guest__eyebrow">MY APPOINTMENTS</span>
        <h2 id="guestAppointmentsTitle">Sign In to View Your Appointments</h2>
        <p>Sign in to check your upcoming haircut appointments, view your booking history, or manage an existing schedule.</p>
        <div class="customer-appointment-guest__actions"><a class="customer-appointment-guest__primary" href="/login.html#signin">Sign In</a><a class="customer-appointment-guest__secondary" href="/login.html#register">Create an Account</a></div>
        <small>Your appointments will appear here once you're signed in.</small>
      </section>`;
      return;
    }
    panel.innerHTML='<div class="appointment-loading" role="status">Loading your appointments…</div>';
    try{
      const result=await api('/api/appointments/mine');
      if(version!==refreshVersion)return;
      all=Array.isArray(result)?result:[];
      // Older appointment records may not have an imageUrl snapshot. Use the
      // matching service photo without changing the appointment itself.
      if(all.some(item=>!App.safePhoto(item.imageUrl))){
        try{
          const services=await api('/api/services');
          if(version!==refreshVersion)return;
          if(Array.isArray(services)){
            const byId=new Map(services.map(service=>[String(service.id),service.imageUrl]));
            const byName=new Map(services.map(service=>[String(service.name).trim().toLowerCase(),service.imageUrl]));
            all=all.map(item=>App.safePhoto(item.imageUrl)?item:{...item,imageUrl:byId.get(String(item.serviceId))||byName.get(String(item.service).trim().toLowerCase())||''});
          }
        }catch(error){/* Keep displaying appointments if service images cannot be loaded. */}
      }
      if(version!==refreshVersion)return;
      draw();
    }catch(e){
      if(version!==refreshVersion)return;
      panel.innerHTML=`<div class="appointment-empty" role="alert"><h2>Unable to load appointments</h2><p>${esc(e.message||'Please try again.')}</p><button type="button" class="secondary-btn" data-appointment-action="retry">Try again</button></div>`;
    }
  }

  function details(a){
    const {element}=App.openDialog(`<div class="appointment-dialog"><span class="eyebrow">BOOKING INFORMATION</span><h2>Appointment details</h2><div class="appointment-dialog__status">${statusBadge(a)}</div><dl class="appointment-detail-list">
      <div><dt>Service</dt><dd>${esc(a.service)}</dd></div><div><dt>Date</dt><dd>${esc(dateLabel(a.startsAt))}</dd></div><div><dt>Time</dt><dd>${esc(timeLabel(a.startsAt))}</dd></div><div><dt>Barber</dt><dd>${esc(a.barberName||'Not assigned')}</dd></div><div><dt>Duration</dt><dd>${esc(a.durationMinutes)} minutes</dd></div><div><dt>Price</dt><dd>${money(a.price)}</dd></div><div><dt>Payment method</dt><dd>${esc(String(a.method||'—').toUpperCase())}</dd></div>
    </dl><p class="muted">Queue updates appear on your Customer Dashboard after check-in.</p><div class="form-actions"><button type="button" class="secondary-btn" data-close>Close</button></div></div>`);
    element.querySelector('[data-close]')?.focus();
  }

  async function cancel(a,button){
    if(!await App.confirmDialog(`Cancel your ${a.service} appointment on ${dateLabel(a.startsAt)} at ${timeLabel(a.startsAt)}? Your reserved slot will be released.`,{title:'Cancel appointment',confirmText:'Cancel appointment',danger:true}))return;
    await busy(button,async()=>{
      try{await api(`/api/appointments/${encodeURIComponent(a.id)}/cancel`,{method:'POST'});App.toast('Appointment cancelled.');await refresh();}
      catch(e){App.toast(e.message,'error');await refresh();}
    });
  }

  async function removeFromHistory(a,button){
    if(upcoming(a))return;
    const confirmed=await App.confirmDialog(`Remove your ${a.service} appointment on ${dateLabel(a.startsAt)} from your history? This only hides it from your account; the shop keeps its original booking records.`,{title:'Remove from history',confirmText:'Remove',danger:true});
    if(!confirmed)return;
    await busy(button,async()=>{
      try{
        await api(`/api/appointments/${encodeURIComponent(a.id)}/hide-history`,{method:'POST'});
        all=all.filter(item=>String(item.id)!==String(a.id));
        draw();
        App.toast('Appointment removed from your history.');
      }catch(e){App.toast(e.message||'Could not remove appointment.','error');}
    });
  }

  function edit(a){
    if(!eligible(a)){App.toast('Editing closes 2 hours before your appointment.','info');refresh();return;}
    window.CustomerBooking?.edit?.(a);
    document.querySelector('.nav-link[data-page="booking"]')?.click();
  }

  document.getElementById('appointmentsContent')?.addEventListener('click',async event=>{
    const tab=event.target.closest('[data-appointment-tab]');
    if(tab){currentTab=tab.dataset.appointmentTab;draw();return;}
    const button=event.target.closest('[data-appointment-action]');if(!button)return;
    const action=button.dataset.appointmentAction;
    if(action==='retry'){refresh();return;}
    if(action==='new'){
      document.querySelector('.nav-link[data-page="booking"]')?.click();return;
    }
    const a=all.find(item=>String(item.id)===button.dataset.id);if(!a)return;
    if(action==='details')details(a);
    if(action==='cancel')await cancel(a,button);
    if(action==='remove-history')await removeFromHistory(a,button);
    if(action==='edit')edit(a);
  });
  window.CustomerBookingHistory={refresh};
})();
