// Appointment booking using a registered customer account; separate from the live walk-in queue.
(function(){
  const {api,escapeHTML,money,setMessage,busy}=App;
  let loaded=false;
  let requestedServiceId='';
  let requestedBarberId='';
  let editing=null;
  const phDate=value=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));const get=t=>parts.find(p=>p.type===t)?.value;return `${get('year')}-${get('month')}-${get('day')}`;};
  const phTime=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  function selectService(id){
    const panel=document.getElementById('bookingContent');
    const button=Array.from(panel?.querySelectorAll('#bookingGallery [data-haircut]') || []).find(b=>b.dataset.haircut===id);
    if(button)button.click();
  }
  async function render(serviceId=''){
    if(serviceId)requestedServiceId=serviceId;
    const panel=document.getElementById('bookingContent');if(!panel)return;
    // Guests can browse the dashboard and queue, but appointment booking requires an account.
    if(!App.state.signedIn){
      loaded=false;
      editing=null;
      panel.innerHTML=`<section class="customer-appointment-guest" aria-labelledby="guestBookingTitle">
        <img class="customer-appointment-guest__image" src="/images/customerDashboard/GoldenCalendar.png" alt="" decoding="async">
        <span class="customer-appointment-guest__eyebrow">APPOINTMENT BOOKING</span>
        <h2 id="guestBookingTitle">Sign In to Book an Appointment</h2>
        <p>Ready for your next haircut? Sign in to choose a service, barber, and available schedule. New here? Create an account to get started.</p>
        <div class="customer-appointment-guest__actions"><a class="customer-appointment-guest__primary" href="/login.html#signin">Sign In</a><a class="customer-appointment-guest__secondary" href="/login.html#register">Create an Account</a></div>
        <small>Walk-in customers can still join the queue without an account.</small>
      </section>`;
      return;
    }
    if(loaded){if(requestedServiceId && !editing)selectService(requestedServiceId);if(requestedBarberId && !editing){const barber=document.getElementById('bkBarber');if(barber && [...barber.options].some(option=>option.value===requestedBarberId)){barber.value=requestedBarberId;barber.dispatchEvent(new Event('change'));requestedBarberId='';}}return;}
    loaded=true;
    panel.innerHTML='<div class="loading">Loading available haircuts and barbers…</div>';
    try{
      const [services,barbers,me]=await Promise.all([api('/api/services'),api('/api/barbers'),api('/api/auth/me')]);
      if(me.user.role!=='customer')throw new Error('Please sign in as a customer to book an appointment.');
      panel.innerHTML=`<div class="customer-booking-info">
        <section class="customer-booking-instruction-card" aria-label="Booking instructions"><div class="customer-booking-info-copy"><span class="customer-booking-info-eyebrow">BOOKING GUIDE</span><h2>Plan your next haircut</h2><p class="customer-booking-intro">Choose your service, then select a date and time that works for you.</p></div><span class="customer-booking-info-icon" aria-hidden="true"><img src="/images/customerDashboard/GoldenCalendar.png" alt="" decoding="async"></span></section>
        <section class="customer-booking-hours-card" aria-label="Operating hours"><span class="customer-booking-hours-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg></span><div><h2>Operating Hours</h2><p class="customer-booking-hours">Monday–Saturday: <strong>8:00 AM–7:00 PM</strong> (Philippine time)</p><p class="customer-booking-hours-note">Lunch break: <strong>12:00 PM–1:00 PM</strong> · Sunday: <strong>Closed</strong> · Services must finish before lunch or by 7:00 PM.</p></div></section>
      </div><article class="card customer-booking-card"><div id="bookingEditHeading" class="booking-edit-heading hidden"><span class="eyebrow">YOUR BOOKINGS</span><h1>Edit Appointment</h1><p>Update your haircut, barber or schedule. Your original booking stays reserved until you save.</p></div>
        <form id="bookingForm"><p class="customer-booking-customer"><strong>Booking for:</strong> ${escapeHTML(me.user.name)}</p>
        <h3 class="customer-booking-step">1. Choose your services (up to 3)</h3><p class="muted">Tap a service to add or remove it. All selected services share one booking and one barber.</p><div id="bookingGallery"></div><p id="bookingServiceHint" class="booking-service-hint hidden" role="alert" aria-live="polite"><span aria-hidden="true">!</span> Please select at least one haircut or service above before choosing your appointment schedule.</p>
        <h3 class="customer-booking-step customer-booking-details-title">2. Appointment details</h3><div class="form-grid customer-booking-fields">
        <div><label for="bkBarber">Preferred barber (optional)</label><select id="bkBarber" name="barberId"><option value="">Any available barber</option>${barbers.filter(b=>b.active).map(b=>`<option value="${b.id}">${escapeHTML(b.name)}</option>`).join('')}</select></div>
        <div class="booking-schedule-field"><label for="bkScheduleOpen">Appointment Date &amp; Time *</label><button id="bkScheduleOpen" class="booking-schedule-open" type="button" aria-haspopup="dialog" aria-describedby="bookingServiceHint bookingScheduleHint"><span id="bkScheduleLabel">Select appointment date &amp; time</span><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M12 13v4l3 2"/></svg></button><small id="bookingScheduleHint" class="booking-schedule-help">Choose your date and available time together.</small><input id="bkDate" class="booking-schedule-native" name="date" type="date" required tabindex="-1"><select id="bkTime" class="booking-schedule-native" name="time" required disabled tabindex="-1"><option value="">Select haircut and date first</option></select></div>
        <div><label for="bkMethod">Payment method *</label><select id="bkMethod" name="method" required><option value="cash">Cash</option><option value="gcash">GCash</option><option value="other">Other</option></select></div>
        </div><input name="serviceId" type="hidden" required><p id="bookingSummary" class="muted customer-booking-summary" aria-live="polite">Select a haircut above.</p><p id="bookingArrivalNote" class="muted" aria-live="polite">Please arrive 10 minutes before your appointment.</p>
        <div class="form-actions"><button class="primary-btn" id="bookingSubmitBtn" type="submit">Confirm appointment</button><button class="secondary-btn hidden" id="bookingCancelEdit" type="button">Cancel Editing</button></div><p id="bookingMessage" class="message" role="status"></p></form></article>`;
      const form=panel.querySelector('#bookingForm');
      const dateInput=form.elements.date, timeInput=form.elements.time;
      const message=panel.querySelector('#bookingMessage');
      // Calendar modal uses the existing authoritative availability endpoint.
      // The original date and time form fields remain the source of truth for booking/editing.
      const dateButton=panel.querySelector('#bkScheduleOpen');
      const serviceHint=panel.querySelector('#bookingServiceHint');
      const bookingGallery=panel.querySelector('#bookingGallery');
      function showServiceHint(){
        serviceHint.classList.remove('hidden');
        bookingGallery.classList.add('booking-service-needed');
        dateButton.classList.add('booking-schedule-invalid');
        dateButton.setAttribute('aria-invalid','true');
        setMessage(message,'Please select at least one haircut or service first.','error');
        bookingGallery.scrollIntoView({behavior:'smooth',block:'center'});
      }
      function clearServiceHint(){
        serviceHint.classList.add('hidden');
        bookingGallery.classList.remove('booking-service-needed');
        dateButton.classList.remove('booking-schedule-invalid');
        dateButton.removeAttribute('aria-invalid');
      }
      let calendarDialog=null;
      let calendarMonth='';
      let calendarSlots=[];
      let calendarLoading=false;
      let calendarError='';
      const dateUTC=key=>new Date(`${key}T12:00:00Z`);
      const monthKey=key=>key.slice(0,7);
      const labelDate=key=>new Intl.DateTimeFormat('en-PH',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(dateUTC(key));
      const labelTime=value=>{if(!value)return '';const [h,m]=value.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;};
      function updateScheduleButtons(){
        panel.querySelector('#bkScheduleLabel').textContent=dateInput.value&&timeInput.value
          ? `${labelDate(dateInput.value)} · ${labelTime(timeInput.value)}`
          : dateInput.value?`${labelDate(dateInput.value)} · Select a time`:'Select appointment date & time';
      }
      function calendarMarkup(){
        const monthStart=new Date(`${calendarMonth}-01T12:00:00Z`);
        const year=monthStart.getUTCFullYear(),month=monthStart.getUTCMonth();
        const heading=new Intl.DateTimeFormat('en-PH',{timeZone:'UTC',month:'long',year:'numeric'}).format(monthStart);
        const offset=monthStart.getUTCDay();
        const length=new Date(Date.UTC(year,month+1,0)).getUTCDate();
        const cells=Array.from({length:offset},()=>'<span class="booking-calendar-blank"></span>');
        for(let day=1;day<=length;day++){
          const key=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const sunday=new Date(`${key}T00:00:00Z`).getUTCDay()===0;
          const past=key<dateInput.min,tooLate=key>dateInput.max;
          const disabled=sunday||past||tooLate;
          const status=sunday?'Closed':past?'Past':tooLate?'Unavailable':key===dateInput.value?(calendarLoading?'Checking':calendarError?'Retry':calendarSlots.length?(calendarSlots.some(x=>x.available)?'Available':'Fully booked'):'Check slots'):'View slots';
          cells.push(`<button type="button" class="booking-calendar-day${key===dateInput.value?' chosen':''}" data-calendar-day="${key}" ${disabled?'disabled':''} aria-pressed="${key===dateInput.value}"><strong>${day}</strong><small>${status}</small></button>`);
        }
        const prev=new Date(Date.UTC(year,month-1,1)).toISOString().slice(0,7);
        const next=new Date(Date.UTC(year,month+1,1)).toISOString().slice(0,7);
        const title=dateInput.value?labelDate(dateInput.value):'Select a date';
        const slots=calendarLoading?'<p class="booking-calendar-message">Checking available times…</p>':calendarError?`<p class="booking-calendar-message" role="alert">${escapeHTML(calendarError)}</p>`:!dateInput.value?'<p class="booking-calendar-message">Select a date to see available appointment times.</p>':!selectedIds().length?'<p class="booking-calendar-message">Choose at least one service before choosing a time.</p>':calendarSlots.length?`<div class="booking-calendar-times">${calendarSlots.map(x=>`<button type="button" data-calendar-time="${escapeHTML(x.time)}" class="booking-calendar-time${timeInput.value===x.time?' chosen':''}" ${x.available?'':'disabled'}>${escapeHTML(x.label||labelTime(x.time))}<small>${x.available?'Available':'Booked / unavailable'}</small></button>`).join('')}</div>`:'<p class="booking-calendar-message">No available slots for this date and service. Try another date or barber.</p>';
        return `<div class="booking-calendar-modal"><div class="booking-calendar-head"><div><h2>Choose a date and time</h2><p>Select a date, then an available appointment slot.</p></div><button type="button" class="booking-calendar-x" data-close aria-label="Close calendar">×</button></div><div class="booking-calendar-layout"><section class="booking-calendar-left"><div class="booking-calendar-month"><button type="button" data-calendar-month="${prev}" aria-label="Previous month" ${prev<monthKey(dateInput.min)?'disabled':''}>‹</button><strong>${heading}</strong><button type="button" data-calendar-month="${next}" aria-label="Next month" ${next>monthKey(dateInput.max)?'disabled':''}>›</button><button type="button" data-calendar-today>Today</button></div><div class="booking-calendar-week">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<span>${d}</span>`).join('')}</div><div class="booking-calendar-days">${cells.join('')}</div><div class="booking-calendar-legend">Closed on Sundays · Past dates disabled</div></section><section class="booking-calendar-right"><h3>${title}</h3><p>Available appointment starts · 25-minute intervals</p>${slots}<div class="booking-calendar-note">Shop: 8:00 AM–7:00 PM · Lunch: 12:00–1:00 PM.<br>Services must finish before lunch or closing.</div></section></div><div class="booking-calendar-footer"><span>${dateInput.value&&timeInput.value?`${labelDate(dateInput.value)} · ${labelTime(timeInput.value)}`:'Choose a date and time'}</span><button type="button" class="primary-btn" data-calendar-done ${dateInput.value&&timeInput.value?'':'disabled'}>Done</button></div></div>`;
      }
      function paintCalendar(){if(calendarDialog)calendarDialog.element.innerHTML=calendarMarkup();}
      function openCalendar(){
        if(!selectedIds().length){showServiceHint();return;}
        clearServiceHint();
        if(calendarDialog)return;
        calendarMonth=monthKey(dateInput.value||dateInput.min);
        calendarDialog=App.openDialog(calendarMarkup(),{onClose:()=>{calendarDialog=null;updateScheduleButtons();}});
        // Keep Done working even after calendar contents are repainted.
        calendarDialog.element.addEventListener('click',event=>{
          const done=event.target.closest('[data-calendar-done]');
          if(done && !done.disabled){
            event.preventDefault();
            calendarDialog?.close();
          }
        },true);
        // Event delegation survives month/day re-rendering.
        calendarDialog.element.addEventListener('click',event=>{
          const button=event.target.closest('button');if(!button||button.disabled)return;
          if(button.dataset.calendarMonth){calendarMonth=button.dataset.calendarMonth;paintCalendar();}
          else if(button.hasAttribute('data-calendarToday')){const today=manilaDate();if(today>=dateInput.min&&today<=dateInput.max){dateInput.value=today;calendarMonth=monthKey(today);dateInput.dispatchEvent(new Event('change'));paintCalendar();}}
          else if(button.dataset.calendarDay){dateInput.value=button.dataset.calendarDay;dateInput.dispatchEvent(new Event('change'));paintCalendar();}
          else if(button.dataset.calendarTime){if(!availableTimes.has(button.dataset.calendarTime))return;timeInput.value=button.dataset.calendarTime;timeInput.dispatchEvent(new Event('change'));updateScheduleButtons();paintCalendar();}
        });
      }
      dateButton.addEventListener('click',openCalendar);

      const manilaDate=()=>{
        const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
        const get=type=>parts.find(part=>part.type===type).value;
        return `${get('year')}-${get('month')}-${get('day')}`;
      };
      const dateWithinRange=value=>{
        if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
        const parsed=new Date(`${value}T00:00:00Z`);
        if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)return false;
        return value>=dateInput.min&&value<=dateInput.max;
      };
      const isSunday=value=>new Date(`${value}T00:00:00Z`).getUTCDay()===0;
      let selectedService=null;
      const selectedServices=new Map();
      const selectedIds=()=>[...selectedServices.keys()];
      const totalDuration=()=>[...selectedServices.values()].reduce((sum,s)=>sum+Number(s.durationMinutes),0);
      const totalPrice=()=>[...selectedServices.values()].reduce((sum,s)=>sum+Number(s.price),0);
      const syncSelection=()=>{
        const ids=selectedIds();
        if(ids.length)clearServiceHint();
        form.elements.serviceId.value=ids[0]||'';
        panel.querySelectorAll('#bookingGallery [data-haircut]').forEach(button=>{const active=selectedServices.has(button.dataset.haircut);button.classList.toggle('booking-service-selected',active);button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
        panel.querySelector('#bookingSummary').textContent=ids.length?`${ids.length} service${ids.length===1?'':'s'}: ${[...selectedServices.values()].map(s=>s.name).join(' + ')} · ${money(totalPrice())} · ${totalDuration()} minutes`:'Select at least one service above.';
        updateTimeLimit();
      }; 
      const originalTime=editing?phTime(editing.startsAt):'';
      function changed(){
        if(!editing)return true;
        return selectedIds().join(',')!==(editing.serviceIds||[editing.serviceId]).join(',')||form.elements.barberId.value!==editing.barberId||dateInput.value!==phDate(editing.startsAt)||timeInput.value!==originalTime||form.elements.method.value!==editing.method;
      }
      const updateSaveState=()=>{if(editing)panel.querySelector('#bookingSubmitBtn').disabled=!changed()||!availableTimes.has(timeInput.value);};
      function leaveEdit(){ editing=null;loaded=false;requestedServiceId='';panel.querySelector('#bookingEditHeading')?.classList.add('hidden');document.querySelector('.nav-link[data-page="appointments"]')?.click(); }
      panel.querySelector('#bookingCancelEdit').addEventListener('click',leaveEdit);
      // Ask the server for barber-specific availability, including the full
      // haircut duration. Unavailable slots remain visible but cannot be chosen.
      let availabilityRequest=0;
      let availableTimes=new Set();
      const updateTimeLimit=async()=>{
        const request=++availabilityRequest;
        const previous=timeInput.value;
        availableTimes=new Set();
        calendarSlots=[];calendarError='';calendarLoading=true;paintCalendar();
        const duration=totalDuration();
        const validDate=dateInput.value&&dateWithinRange(dateInput.value)&&!isSunday(dateInput.value);
        const canChoose=validDate&&selectedIds().length&&Number.isInteger(duration)&&duration>0&&duration<=690;
        timeInput.disabled=true;
        timeInput.innerHTML=`<option value="">${!dateInput.value?'Select haircut and date first':!validDate?'Select a Monday–Saturday date first':!selectedIds().length?'Select a haircut first':'Checking available times…'}</option>`;
        if(!canChoose){calendarLoading=false;paintCalendar();updateScheduleButtons();return;}
        try{
          const params=new URLSearchParams({serviceIds:selectedIds().join(','),date:dateInput.value,barberId:form.elements.barberId.value});
          if(editing)params.set('excludeAppointmentId',editing.id);
          const result=await api(`/api/appointments/availability?${params}`);
          if(request!==availabilityRequest)return;
          const slots=Array.isArray(result.slots)?result.slots:[];
          calendarSlots=slots;calendarLoading=false;
          availableTimes=new Set(slots.filter(slot=>slot.available).map(slot=>slot.time));
          timeInput.innerHTML=`<option value="">${availableTimes.size?'Select appointment time':'No available times for this date and barber'}</option>`+slots.map(slot=>`<option value="${slot.time}"${slot.available?'':' disabled'}>${escapeHTML(slot.label)}${slot.available?'':' — Booked / Unavailable'}</option>`).join('');
          timeInput.disabled=!availableTimes.size;
          if(availableTimes.has(previous))timeInput.value=previous;
          else if(editing&&dateInput.value===phDate(editing.startsAt)&&availableTimes.has(originalTime))timeInput.value=originalTime;
          updateSaveState();updateScheduleButtons();paintCalendar();
        }catch(error){
          if(request!==availabilityRequest)return;
          timeInput.disabled=true;
          calendarLoading=false;calendarError=error.message||'Could not load availability.';paintCalendar();
          timeInput.innerHTML='<option value="">Unable to load available times</option>';
          setMessage(message,error.message||'Could not check availability. Please try again.','error');
        }
      };
      const checkSchedule=()=>{
        dateInput.min=manilaDate();
        const maxDate=new Date(`${dateInput.min}T00:00:00Z`);
        maxDate.setUTCDate(maxDate.getUTCDate()+60);
        dateInput.max=maxDate.toISOString().slice(0,10);
        if(!dateInput.value)return 'Please select an appointment date.';
        if(!dateWithinRange(dateInput.value))return 'Select a valid future schedule within 60 days.';
        if(isSunday(dateInput.value))return 'The barbershop is closed every Sunday. Please select another date.';
        if(!timeInput.value)return 'Please select an appointment time.';
        if(!availableTimes.has(timeInput.value))return 'This appointment time is not available. Please choose another.';
        if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeInput.value))return 'Please select a valid appointment time.';
        const [hour,minute]=timeInput.value.split(':').map(Number);
        if(!selectedIds().length)return 'Please select at least one service.';
        const startMinute=hour*60+minute;
        if(!((startMinute>=480&&startMinute<720&&(startMinute-480)%25===0&&startMinute+totalDuration()<=720)||(startMinute>=780&&startMinute<1140&&(startMinute-780)%25===0&&startMinute+totalDuration()<=1140)))return 'Choose a valid 25-minute time slot. All services must finish before lunch or closing.';
        const start=new Date(`${dateInput.value}T${timeInput.value}:00+08:00`);
        if(start.getTime()<Date.now()+5*60000)return 'Please choose a future appointment time (at least 5 minutes from now).';
        return '';
      };
      dateInput.min=manilaDate();
      const maxDate=new Date(`${dateInput.min}T00:00:00Z`);
      maxDate.setUTCDate(maxDate.getUTCDate()+60);
      dateInput.max=maxDate.toISOString().slice(0,10);
      HaircutGallery.render(panel.querySelector('#bookingGallery'),services,s=>{
        if(selectedServices.has(s.id))selectedServices.delete(s.id);
        else if(selectedServices.size>=3){setMessage(message,'You can select up to 3 services per appointment.','error');syncSelection();return;}
        else selectedServices.set(s.id,s);
        setMessage(message,'');
        syncSelection();
      });
      if(editing){
        panel.querySelector('#bookingEditHeading').classList.remove('hidden');
        panel.querySelector('.customer-booking-intro').textContent='Review and update the details of your existing appointment.';
        panel.querySelector('#bookingSubmitBtn').textContent='Save Changes';
        panel.querySelector('#bookingCancelEdit').classList.remove('hidden');
        form.elements.barberId.value=editing.barberId;
        form.elements.method.value=editing.method;
        dateInput.value=phDate(editing.startsAt);
        (editing.serviceIds||[editing.serviceId]).forEach(id=>selectService(id));
        // The slot list may load after selecting the existing haircut.
      }else {
        if(requestedServiceId)selectService(requestedServiceId);
        if(requestedBarberId && [...form.elements.barberId.options].some(option=>option.value===requestedBarberId)){
          form.elements.barberId.value=requestedBarberId;
          requestedBarberId='';
          updateTimeLimit();
        }
      }
      dateInput.addEventListener('change',()=>{
        updateTimeLimit();
        if(dateInput.value&&dateWithinRange(dateInput.value)&&isSunday(dateInput.value)){
          setMessage(message,'The barbershop is closed every Sunday. Please select another date.','error');
        }else setMessage(message,'');
        updateSaveState();
      });
      form.elements.barberId.addEventListener('change',updateTimeLimit);
      form.elements.method.addEventListener('change',updateSaveState);
      timeInput.addEventListener('change',()=>{
        updateScheduleButtons();
        if(dateInput.value&&timeInput.value&&selectedIds().length){
          const error=checkSchedule();
          setMessage(message,error,error?'error':'');
        }
        updateSaveState();
      });
      updateScheduleButtons();
      form.addEventListener('submit',async e=>{
        e.preventDefault();if(!form.elements.serviceId.value){showServiceHint();return;}
        const scheduleError=checkSchedule();
        if(scheduleError){setMessage(message,scheduleError,'error');return;}
        if(editing&&!changed()){setMessage(message,'No changes to save.','error');return;}
        // Give immediate feedback before submitting; server repeats these checks atomically.
        try{
          const existing=await api('/api/appointments/mine');
          const active=['pending','confirmed','checked-in'];
          const day=dateInput.value;
          const onDay=existing.some(a=>(!editing||a.id!==editing.id)&&active.includes(a.status)&&new Date(a.startsAt).toLocaleDateString('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'})===day);
          if(onDay){setMessage(message,'You already have an active appointment on this date. Please choose another date or cancel your existing appointment.','error');return;}
          const upcoming=existing.filter(a=>['pending','confirmed'].includes(a.status)&&new Date(a.startsAt).getTime()>=Date.now()).length;
          if(!editing&&upcoming>=3){setMessage(message,'You already have 3 upcoming appointments. Please complete or cancel an appointment before booking another.','error');return;}
        }catch(error){
          setMessage(message,error.message||'Unable to verify existing appointments. Please try again.','error');return;
        }
        await busy(e.submitter,async()=>{
          try{
            const appointment=await api(editing?`/api/appointments/${encodeURIComponent(editing.id)}/edit`:'/api/appointments',{method:editing?'PATCH':'POST',body:{serviceIds:selectedIds(),barberId:form.elements.barberId.value,date:form.elements.date.value,time:form.elements.time.value,method:form.elements.method.value}});
            if(editing){App.toast('Appointment updated successfully.');leaveEdit();return;}
            setMessage(panel.querySelector('#bookingMessage'),`Appointment ${appointment.status}! Check My Appointments for details.`,'success');
            window.CustomerBookingHistory?.refresh?.();
            await updateTimeLimit();
          }catch(error){setMessage(panel.querySelector('#bookingMessage'),error.message,'error');await updateTimeLimit();}
        });
      });
    }catch(e){panel.innerHTML=`<div class="empty-state">${escapeHTML(e.message)}</div>`;loaded=false;}
  }
  function edit(appointment){editing={...appointment};requestedServiceId='';loaded=false;render();}
  function selectBarber(id){requestedBarberId=String(id||'');if(!editing && loaded)render();}
  window.CustomerBooking={render,edit,selectBarber};
})();
