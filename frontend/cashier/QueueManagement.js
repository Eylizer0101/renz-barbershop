// Front-desk screens shared by the cashier and admin pages, available as window.Desk.
(function () {
  const { api, escapeHTML, money, time, waitedText, minutesSince, setMessage, statusPill, openDialog, confirmDialog, toast, busy } = window.App;

  const METHODS = [
    { value: "cash", label: "Cash" },
    { value: "gcash", label: "GCash" },
    { value: "card", label: "Card" },
    { value: "other", label: "Other" }
  ];

  const LONG_WAIT_MINUTES = 30;

  function methodLabel(value) {
    return METHODS.find(m => m.value === value)?.label || value;
  }

  function methodPicker(name = "method") {
    return `<div class="method-picker" role="radiogroup" aria-label="Payment method">${METHODS.map((m, i) => `
      <label><input type="radio" name="${name}" value="${m.value}"${i === 0 ? " checked" : ""}> ${m.label}</label>`).join("")}
    </div>`;
  }

  function serviceOptions(services, selectedId = "") {
    return '<option value="">Select a service</option>' + services.map(s =>
      `<option value="${s.id}"${s.id === selectedId ? " selected" : ""}>${escapeHTML(s.name)} · ${money(s.price)} · ${s.durationMinutes} min</option>`
    ).join("");
  }

  function emptyRow(columns, text) {
    return `<tr class="empty-row"><td colspan="${columns}">${escapeHTML(text)}</td></tr>`;
  }

  function statCards(cards) {
    return cards.map(([label, value, help]) => `
      <article class="card">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        <div class="stat-help">${help}</div>
      </article>`).join("");
  }

  // ---------- Front desk: the live queue ----------

  async function queue(body, actions, user) {
    const isAdmin = user?.role === "admin";
    body.classList.add("front-desk-view");

    actions.innerHTML = "";

    body.innerHTML = `
      <section class="stats stats-4" id="deskStats"></section>

      <section class="desk-hero-banner" id="deskHero" aria-labelledby="deskHeroTitle">
        <div class="desk-hero-content">
          <h2 id="deskHeroTitle" class="desk-total-row"><strong id="deskTotalCustomers" aria-live="polite">—</strong><span>Total Customers Today</span></h2>
          <div class="desk-hero-actions">
            <button class="primary-btn desk-add-trigger" type="button" id="toggleWalkIn" aria-haspopup="dialog">+ Add walk-in</button>
            ${isAdmin ? '<span class="desk-hero-action-divider" aria-hidden="true"></span><button class="danger-btn desk-end-day-trigger" type="button" id="clearQueue" title="Review and close daily operations">End of day…</button>' : ""}
          </div>
        </div>
      </section>
      <p class="updated muted small hidden" id="deskUpdated" role="status"></p>

      <section class="desk-grid desk-dashboard-grid">
        <div class="desk-dashboard-panels">
          <article class="card desk-panel desk-barbers-panel">
            <div class="card-heading">
              <h2>Barber stations</h2>
              <span class="muted">Availability and next customer</span>
            </div>
            <div class="barber-desk" id="barberDesk"></div>
          </article>

          <article class="card desk-panel desk-overview-panel" aria-label="Queue overview">
            <div class="card-heading"><h2>Queue overview</h2></div>
            <div class="desk-overview-details" id="deskOverview"></div>
            <p class="desk-overview-tip">Call the next eligible customer when a barber is available.</p>
          </article>

          <article class="card desk-panel">
            <div class="card-heading"><h2>Now serving</h2><span class="muted" id="servingCount"></span></div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>#</th><th>Customer</th><th>Service</th><th>Barber</th><th>Started</th><th><span class="sr-only">Actions</span></th></tr></thead>
                <tbody id="servingRows"></tbody>
              </table>
            </div>
          </article>

          <article class="card desk-panel">
            <div class="card-heading"><h2>Waiting queue</h2><span class="muted" id="waitingCount"></span></div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>#</th><th>Customer</th><th>Service</th><th>Prefers</th><th>Waiting</th><th><span class="sr-only">Actions</span></th></tr></thead>
                <tbody id="waitingRows"></tbody>
              </table>
            </div>
          </article>

          <article class="card desk-panel">
            <div class="card-heading"><h2>Finished today</h2></div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>#</th><th>Customer</th><th>Service</th><th>Barber</th><th>Status</th><th>Paid</th></tr></thead>
                <tbody id="finishedRows"></tbody>
              </table>
            </div>
          </article>
        </div>

        <form class="card form-card desk-walkin hidden" id="walkInForm">
          <div class="desk-form-heading"><span class="desk-kicker">NEW CUSTOMER</span><h2>Add a walk-in</h2><p class="muted">Add a customer to today's queue. No account required.</p></div>

          <label for="walkInName">Customer name (optional)</label>
          <input id="walkInName" name="name" maxlength="60" placeholder="e.g. Juan Dela Cruz" autocomplete="off">

          <details class="account-link">
            <summary>Customer has an account?</summary>
            <label for="walkInEmail">Their account email</label>
            <input id="walkInEmail" name="customerEmail" type="email" placeholder="Adds the visit to their history" autocomplete="off">
          </details>

          <label for="walkInService">Service *</label>
          <select id="walkInService" name="serviceId" required></select>

          <label for="walkInBarber">Preferred barber</label>
          <select id="walkInBarber" name="preferredBarberId"><option value="">Any barber</option></select>

          <div class="form-actions desk-modal-actions"><button class="secondary-btn" type="button" data-close>Cancel</button><button class="primary-btn" type="submit">Add to Queue</button></div>
          <p class="message" id="walkInMessage" role="status"></p>
        </form>
      </section>`;

    const $ = id => body.querySelector("#" + id);
    let tickets = [];
    let barbers = [];
    let totalCustomersToday = 0;

    const services = await api("/api/services");
    $("walkInService").innerHTML = serviceOptions(services);

    function render() {
      $("deskTotalCustomers").textContent = totalCustomersToday;
      const waiting = tickets.filter(t => t.status === "waiting");
      const serving = tickets.filter(t => t.status === "serving");
      const finished = tickets.filter(t => !["waiting", "serving"].includes(t.status)).reverse();
      const completed = finished.filter(t => t.status === "completed");
      const collected = completed.reduce((sum, t) => sum + (t.amountPaid || 0), 0);
      const freeBarbers = barbers.filter(b => b.status === "available").length;
      $("servingCount").textContent = `${serving.length} in service`;

      $("deskStats").innerHTML = statCards([
        ["Waiting", waiting.length, ""],
        ["Being served", serving.length, ""],
        ["Completed today", completed.length, ""],
        ["Service sales today", money(collected), ""]
      ]);

      // KPI cards show only the label and value, without helper text.
      $("deskStats").querySelectorAll(".stat-help").forEach(help => help.remove());

      // Front Desk KPI artwork (files already in frontend/images/CashierDashboard).
      const deskIcons = [
        "/images/CashierDashboard/Waiting.png",
        "/images/CashierDashboard/ScissorsIcon.png",
        "/images/CashierDashboard/CheckmarkBadge.png",
        "/images/CashierDashboard/PesoBadge.png"
      ];
      $("deskStats").querySelectorAll(".card").forEach((card, i) => {
        card.classList.add("desk-summary-card", `desk-summary-${i}`);
        card.insertAdjacentHTML("beforeend", `<span class="desk-summary-watermark" aria-hidden="true"><img class="desk-summary-image" src="${deskIcons[i]}" alt="" loading="eager" decoding="async"></span>`);
      });
      const longestWait = waiting.length ? Math.max(...waiting.map(t => minutesSince(t.createdAt))) : 0;
      $("deskOverview").innerHTML = [
        ["Longest wait time", waiting.length ? waitedText(waiting.reduce((oldest, t) => new Date(t.createdAt) < new Date(oldest.createdAt) ? t : oldest).createdAt) : "No wait"],
        ["Available barbers", `${freeBarbers} / ${barbers.length}`],
        ["Customers waiting", waiting.length],
        ["Currently in service", serving.length]
      ].map(([label, value]) => `<div class="desk-overview-line"><span>${label}</span><strong>${escapeHTML(value)}</strong></div>`).join("");

      $("barberDesk").innerHTML = barbers.length ? barbers.map(b => {
        const current = serving.find(t => t.barberId === b.id);
        const callable = waiting.filter(t => !t.preferredBarberId || t.preferredBarberId === b.id).length;
        const label = b.status === "busy" && current ? `Serving #${current.queueNumber}` : b.status === "available" ? "Available" : "Off duty";

        return `
          <div class="barber-row">
            <div class="desk-barber-info"><span class="desk-barber-avatar" aria-hidden="true">${escapeHTML((b.name || "B").trim().split(/\s+/).slice(-1)[0].charAt(0).toUpperCase())}</span><div>
              <strong>${escapeHTML(b.name)}</strong>
              <span class="barber-status ${b.status}">${label}</span>
              <div class="muted small">${b.status === "busy" && current ? `${escapeHTML(current.customerName || `Walk-in #${current.queueNumber}`)} · ${escapeHTML(current.service)}` : `${callable} eligible customer${callable === 1 ? "" : "s"} waiting`}</div>
            </div></div>
            <div class="row-actions">
              ${b.status === "available" ? `<button class="primary-btn small" type="button" data-action="call-next" data-barber="${b.id}"${callable ? "" : " disabled"}>Call next</button>` : ""}
              ${b.status === "busy" && current ? `<span class="desk-serving-note">In service</span>` : ""}
              ${b.status !== "busy" ? `<button class="secondary-btn small" type="button" data-action="duty" data-barber="${b.id}" data-on="${!b.available}">${b.available ? "Set off duty" : "Set on duty"}</button>` : ""}
            </div>
          </div>`;
      }).join("") : '<div class="empty-state">No barbers yet. The admin adds barbers on the Barbers page.</div>';

      $("servingRows").innerHTML = serving.length ? serving.map(t => `
        <tr>
          <td><strong>#${t.queueNumber}</strong></td>
          <td>${escapeHTML(t.customerName || `Walk-in #${t.queueNumber}`)}${t.hasAccount ? ' <span class="chip">Account</span>' : ""}</td>
          <td>${escapeHTML(t.service)}<div class="muted small">${money(t.price)}</div></td>
          <td>${escapeHTML(t.barberName)}</td>
          <td>${time(t.calledAt)}</td>
          <td class="row-actions">
            <button class="primary-btn small" type="button" data-action="complete" data-id="${t.id}">Complete &amp; pay</button>
          </td>
        </tr>`).join("") : emptyRow(6, "No one is being served.");

      $("waitingCount").textContent = `${waiting.length} waiting`;
      $("waitingRows").innerHTML = waiting.length ? waiting.map(t => `
        <tr class="${minutesSince(t.createdAt) >= LONG_WAIT_MINUTES ? "long-wait" : ""}">
          <td><strong>#${t.queueNumber}</strong></td>
          <td>${escapeHTML(t.customerName || `Walk-in #${t.queueNumber}`)}${t.hasAccount ? ' <span class="chip">Account</span>' : ""}${t.source === "walk-in" ? ' <span class="chip">Walk-in</span>' : ""}</td>
          <td>${escapeHTML(t.service)}</td>
          <td>${escapeHTML(t.preferredBarberName || "Any")}</td>
          <td>${waitedText(t.createdAt)}</td>
          <td class="row-actions">
            <button class="primary-btn small" type="button" data-action="call" data-id="${t.id}">Call</button>
            <details class="desk-queue-actions"><summary aria-label="More actions for queue number ${t.queueNumber}" title="More actions">⋯</summary><div class="desk-queue-action-menu">
              <button class="secondary-btn small" type="button" data-action="no-show" data-id="${t.id}">No-show</button>
              <button class="danger-btn small" type="button" data-action="cancel" data-id="${t.id}">Cancel</button>
            </div></details>
          </td>
        </tr>`).join("") : emptyRow(6, "No one is waiting.");

      $("finishedRows").innerHTML = finished.length ? finished.map(t => `
        <tr>
          <td>#${t.queueNumber}</td>
          <td>${escapeHTML(t.customerName || `Walk-in #${t.queueNumber}`)}</td>
          <td>${escapeHTML(t.service)}</td>
          <td>${escapeHTML(t.barberName || "—")}</td>
          <td>${statusPill(t.status)}</td>
          <td>${t.amountPaid != null ? `<span class="desk-paid-label">${money(t.amountPaid)}</span>` : t.status === "completed" ? `<span class="desk-unpaid-label">Unpaid</span>` : "—"}</td>
        </tr>`).join("") : emptyRow(6, "Nothing finished yet today.");


      $("deskUpdated").classList.add("hidden");
    }

    let refreshInProgress = false;
    async function refresh() {
      if (refreshInProgress || !body.isConnected) return;
      refreshInProgress = true;
      try {
        const [nextTickets, nextBarbers] = await Promise.all([
          api("/api/queue"), api("/api/barbers")
        ]);
        tickets = nextTickets;
        barbers = nextBarbers;
        // Count data must not prevent the rest of the Front Desk from loading.
        // The queue API excludes cancelled tickets, so this is a fallback only.
        const todayCount = await api("/api/queue/today/count").catch(() => null);
        totalCustomersToday = Number.isFinite(todayCount?.count) ? todayCount.count : tickets.length;
        render();
      } catch (error) {
        $("deskUpdated").textContent = `Couldn't refresh: ${error.message}`;
        $("deskUpdated").classList.remove("hidden");
      } finally {
        refreshInProgress = false;
      }
    }

    async function act(button, request, successText) {
      await busy(button, async () => {
        let notice;
        try {
          const result = await request();
          notice = [successText(result), "success"];
        } catch (error) {
          notice = [error.message, "error"];
        }
        await refresh();
        toast(...notice);
      });
    }

    function completeDialog(ticket) {
      const current = services.find(s => s.name === ticket.service);
      const { element, close } = openDialog(`
        <form id="payForm">
          <h2>Complete #${ticket.queueNumber} · ${escapeHTML(ticket.customerName || `Walk-in #${ticket.queueNumber}`)}</h2>
          <p class="muted">With ${escapeHTML(ticket.barberName)}. Change the service if they had something else; change the amount for extras or discounts.</p>

          <label for="payService">Service done</label>
          <select id="payService" name="serviceId">
            ${current ? "" : `<option value="">${escapeHTML(ticket.service)} · ${money(ticket.price)}</option>`}
            ${services.map(s => `<option value="${s.id}" data-price="${s.price}"${s.id === current?.id ? " selected" : ""}>${escapeHTML(s.name)} · ${money(s.price)}</option>`).join("")}
          </select>

          <label for="payAmount">Amount (₱)</label>
          <input id="payAmount" name="amount" type="number" min="0" step="0.01" value="${Number(ticket.price || 0)}" required>

          <div id="discountBox" class="hidden">
            <label for="payNote">Reason for the discount *</label>
            <input id="payNote" name="note" maxlength="200" placeholder="e.g. Senior citizen discount">
            <p class="muted small">Discounts are shown in the reports and activity log.</p>
          </div>

          <label>Products used (optional)</label>
          <div id="usedProductRows"></div>
          <button class="secondary-btn small" id="addUsedProduct" type="button">+ Add product used</button>
          <p class="muted small">Quantity uses the inventory unit (pcs, g or ml) and will be deducted upon completion.</p>
          <label>Payment method</label>
          ${methodPicker()}

          <div id="cashBox">
            <label for="payReceived">Cash received (₱, optional)</label>
            <input id="payReceived" type="number" min="0" step="0.01">
            <p class="change-text" id="changeText"></p>
          </div>

          <div class="form-actions">
            <button class="primary-btn" type="submit">Complete and record payment</button>
            <button class="secondary-btn" type="button" data-close>Cancel</button>
          </div>
          <p class="message" id="payMessage"></p>
        </form>`);

      const form = element.querySelector("#payForm");
      let availableProducts=[];
      api('/api/inventory').then(items=>{availableProducts=items;}).catch(e=>{setMessage(element.querySelector('#payMessage'),e.message,'error');});
      element.querySelector('#addUsedProduct').addEventListener('click',()=>{
        if(!availableProducts.length){toast('No inventory products found or inventory is unavailable.','error');return;}
        const row=document.createElement('div');row.className='form-grid used-product-row';
        row.innerHTML=`<div><label>Product</label><select class="used-id">${availableProducts.map(p=>`<option value="${p.id}">${escapeHTML(p.name)} (${p.quantity} ${escapeHTML(p.unit||'pcs')} available)</option>`).join('')}</select></div><div><label>Quantity</label><input type="number" class="used-qty" min="1" step="1" value="1" required></div><button type="button" class="secondary-btn small used-remove">Remove</button>`;
        row.querySelector('.used-remove').addEventListener('click',()=>row.remove());
        element.querySelector('#usedProductRows').appendChild(row);
      });

      const priceOf = () => {
        const option = form.serviceId.selectedOptions[0];
        return option?.dataset.price !== undefined ? Number(option.dataset.price) : Number(ticket.price || 0);
      };

      const update = () => {
        const amount = Number(form.amount.value) || 0;
        const received = Number(element.querySelector("#payReceived").value);
        element.querySelector("#changeText").textContent = received
          ? (received >= amount ? `Change: ${money(received - amount)}` : `Short by ${money(amount - received)}`)
          : "";

        const discounted = amount < priceOf();
        element.querySelector("#discountBox").classList.toggle("hidden", !discounted);
        form.note.required = discounted;
        element.querySelector("#cashBox").classList.toggle("hidden", form.method.value !== "cash");
      };

      form.serviceId.addEventListener("change", () => {
        form.amount.value = priceOf();
        update();
      });
      form.addEventListener("input", update);
      form.addEventListener("change", update);

      form.addEventListener("submit", async event => {
        event.preventDefault();
        await busy(event.submitter, async () => {
          try {
            await api(`/api/queue/${ticket.id}/complete`, {
              method: "POST",
              body: {
                serviceId: form.serviceId.value || undefined,
                amount: Number(form.amount.value),
                method: form.method.value,
                note: form.note.value,
                productsUsed:[...element.querySelectorAll('.used-product-row')].map(row=>({inventoryId:row.querySelector('.used-id').value,quantity:Number(row.querySelector('.used-qty').value)}))
              }
            });
            close();
            await refresh();
            toast(`#${ticket.queueNumber} completed. ${money(form.amount.value)} recorded (${methodLabel(form.method.value)}).`);
          } catch (error) {
            setMessage(element.querySelector("#payMessage"), error.message, "error");
          }
        });
      });
    }

    function callDialog(ticket) {
      const free = barbers.filter(b => b.status === "available");
      if (!free.length) {
        toast("No barber is free right now.", "error");
        return;
      }

      const { element, close } = openDialog(`
        <form id="callForm">
          <h2>Call #${ticket.queueNumber} · ${escapeHTML(ticket.customerName || `Walk-in #${ticket.queueNumber}`)}</h2>
          <p class="muted">${ticket.preferredBarberName ? `Prefers ${escapeHTML(ticket.preferredBarberName)}.` : "No barber preference."} Waiting ${waitedText(ticket.createdAt)}.</p>
          <label for="callBarber">Barber</label>
          <select id="callBarber" name="barberId">${free.map(b => `<option value="${b.id}"${b.id === ticket.preferredBarberId ? " selected" : ""}>${escapeHTML(b.name)}</option>`).join("")}</select>
          <div class="form-actions">
            <button class="primary-btn" type="submit">Call customer</button>
            <button class="secondary-btn" type="button" data-close>Cancel</button>
          </div>
          <p class="message" id="callMessage"></p>
        </form>`);

      element.querySelector("#callForm").addEventListener("submit", async event => {
        event.preventDefault();
        await busy(event.submitter, async () => {
          try {
            const called = await api(`/api/queue/${ticket.id}/call`, { method: "POST", body: { barberId: event.target.barberId.value } });
            close();
            await refresh();
            toast(`Called #${called.queueNumber} ${called.customerName} to ${called.barberName}.`);
          } catch (error) {
            setMessage(element.querySelector("#callMessage"), error.message, "error");
          }
        });
      });
    }

    body.addEventListener("click", async event => {
      const button = event.target.closest("[data-action]");
      if (!button) return;

      const ticket = tickets.find(t => t.id === button.dataset.id);
      const action = button.dataset.action;

      if (action === "call-next") {
        act(button,
          () => api("/api/queue/call-next", { method: "POST", body: { barberId: button.dataset.barber } }),
          t => `Now serving #${t.queueNumber} ${t.customerName} with ${t.barberName}.`);
      } else if (action === "duty") {
        act(button,
          () => api(`/api/barbers/${button.dataset.barber}/availability`, { method: "PATCH", body: { available: button.dataset.on === "true" } }),
          () => button.dataset.on === "true" ? "Barber is on duty." : "Barber is off duty.");
      } else if (action === "complete" && ticket) {
        completeDialog(ticket);
      } else if (action === "call" && ticket) {
        callDialog(ticket);
      } else if (action === "no-show" && ticket) {
        if (await confirmDialog(`Mark #${ticket.queueNumber} ${ticket.customerName} as a no-show?`, { title: "No-show", confirmText: "Mark no-show", danger: true })) {
          act(button, () => api(`/api/queue/${ticket.id}/no-show`, { method: "POST" }), r => r.message);
        }
      } else if (action === "cancel" && ticket) {
        if (await confirmDialog(`Remove #${ticket.queueNumber} ${ticket.customerName} from the queue?`, { title: "Cancel customer", confirmText: "Remove from queue", danger: true })) {
          act(button, () => api(`/api/queue/${ticket.id}/cancel`, { method: "POST" }), r => r.message);
        }
      }
    });

    const walkInMarkup = $("walkInForm").outerHTML;
    $("walkInForm").remove();
    $("toggleWalkIn").addEventListener("click", () => {
      const { element, close } = openDialog(`<div class="desk-walkin-modal"><div class="desk-modal-head"><h2>Add Walk-in Customer</h2><button type="button" class="desk-modal-close" data-close aria-label="Close">×</button></div><p class="muted">Add a customer to today's queue. No account required.</p>${walkInMarkup.replace('id="walkInForm"', 'id="walkInModalForm"').replace(' hidden"', '"')}</div>`);
      const form = element.querySelector("#walkInModalForm");
      form.classList.remove("hidden");
      form.querySelector("#walkInService").innerHTML = serviceOptions(services);
      form.querySelector("#walkInBarber").innerHTML = '<option value="">Any barber</option>' + barbers.map(b => `<option value="${b.id}">${escapeHTML(b.name)}</option>`).join("");
      form.querySelector("#walkInName").focus();
      form.addEventListener("submit", async event => {
        event.preventDefault();
        await busy(event.submitter, async () => {
          try {
            const ticket = await api("/api/queue/walk-in", {
              method: "POST",
              body: {
                name: form.elements.namedItem("name").value,
                customerEmail: form.elements.namedItem("customerEmail").value,
                serviceId: form.elements.namedItem("serviceId").value,
                preferredBarberId: form.elements.namedItem("preferredBarberId").value
              }
            });
            close();
            await refresh();
            toast(`Added ${ticket.customerName || "walk-in customer"} as #${ticket.queueNumber}.`);
          } catch (error) {
            setMessage(form.querySelector("#walkInMessage"), error.message, "error");
          }
        });
      });
    });

    async function updateClosingButton() {
      if (!isAdmin) return;
      const button = body.querySelector("#clearQueue");
      if (!button) return;
      try {
        const result = await api("/api/queue/today/closing");
        button.disabled = result.closed;
        button.textContent = result.closed ? "Day closed ✓" : "End of day…";
        button.title = result.closed ? "Daily closing saved" : "Review and close daily operations";
      } catch { /* Front Desk remains usable if the status check fails. */ }
    }
    body.querySelector("#clearQueue")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      await busy(button, async () => {
        try {
          await refresh();
          const [closing, payments] = await Promise.all([
            api("/api/queue/today/closing"), api("/api/payments")
          ]);
          if (closing.closed) { toast("Today's operations are already closed.", "info"); await updateClosingButton(); return; }
          const active = tickets.filter(t => ["waiting", "serving", "assigned"].includes(t.status));
          const unpaid = tickets.filter(t => t.status === "completed" && !t.paymentId && t.amountPaid == null);
          const paidTotals = payments?.totals || {};
          const message = `<div class="desk-day-closing"><h2>End of Day</h2><p>Review today's operations before confirming. This saves a closing report and does not delete queue, payment, or appointment records.</p><div class="desk-closing-grid"><div><strong>${totalCustomersToday}</strong><span>Total customers</span></div><div><strong>${active.length}</strong><span>Active queue</span></div><div><strong>${unpaid.length}</strong><span>Unpaid services</span></div><div><strong>${money(paidTotals.total || 0)}</strong><span>Recorded sales</span></div></div><p class="muted small">Future appointments are preserved. Closing prevents new queue entries until tomorrow.</p><div class="form-actions"><button type="button" class="secondary-btn" data-close>Cancel</button><button type="button" class="danger-btn" data-close-day ${active.length || unpaid.length ? "disabled" : ""}>Confirm End of Day</button></div><p class="message" id="closingMessage" role="alert"></p></div>`;
          const { element, close } = openDialog(message);
          element.querySelector("[data-close-day]").addEventListener("click", async click => {
            await busy(click.currentTarget, async () => {
              try {
                const result = await api("/api/queue/close-day", { method: "POST" });
                close();
                toast(result.message, "success");
                await Promise.all([refresh(), updateClosingButton()]);
              } catch (error) { setMessage(element.querySelector("#closingMessage"), error.message, "error"); }
            });
          });
        } catch (error) { toast(error.message, "error"); }
      });
    });
    await updateClosingButton();

    await refresh();
    const timer = setInterval(refresh, 10000);
    return () => { clearInterval(timer); body.classList.remove("front-desk-view"); };
  }

  // ---------- Payments: daily sales, product sales and reports ----------

  async function payments(body, actions, user) {
    const isAdmin = user?.role === "admin";
    body.classList.add("front-desk-view");
    actions.innerHTML = "";

    body.innerHTML = `
      
      <form class="card filter-bar cashier-ops-filters cashier-visits-toolbar" id="rangeForm">
        <label class="cashier-ops-search"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input id="paySearch" type="search" placeholder="Search item, customer or cashier..." aria-label="Search transactions"></label>
        <select id="payMethodFilter" aria-label="Filter payment method"><option value="all">All Methods</option><option value="cash">Cash</option><option value="gcash">GCash</option><option value="card">Card</option><option value="other">Other</option></select>
        <select id="payStatusFilter" aria-label="Filter payment status"><option value="all">All Status</option><option value="paid">Paid</option><option value="voided">Voided</option></select>
        <select id="payPeriod" aria-label="Payment date range"><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">Last 7 Days</option><option value="month">This Month</option></select>
        <input type="hidden" name="from" value="${App.today()}">
        <input type="hidden" name="to" value="${App.today()}">
        <select id="paySort" aria-label="Sort transactions"><option value="latest">Newest First</option><option value="oldest">Oldest First</option><option value="highest">Highest Amount</option><option value="lowest">Lowest Amount</option></select>
        <button type="button" class="cashier-clear-filters hidden" id="payClear">Clear All</button>
      </form>
      <section class="stats stats-4" id="payTotals"></section>

      <section class="cashier-payments-wide">
        <article class="card cashier-ops-table">
          <div class="card-heading cashier-payments-table-heading"><h2>Transactions</h2><div class="cashier-payments-header-actions"><span class="muted" id="payCount"></span><button type="button" class="primary-btn cashier-sell-trigger" id="openSaleProduct">+ Sell Product</button></div></div>
          <div class="table-wrap">
            <table class="data-table cashier-ops-data">
              <thead><tr><th>No.</th><th>Date & Time</th><th>Item / Service</th><th>Customer</th><th>Barber</th><th>Method</th><th>Cashier</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody id="payRows"></tbody>
            </table>
          </div><div class="cashier-ops-pager" id="payPager"></div>
        </article>

      </section>
      <div class="cashier-product-modal hidden" id="saleModal" aria-hidden="true">
        <div class="cashier-product-modal-panel" role="dialog" aria-modal="true" aria-labelledby="saleModalTitle">
        <form class="card form-card" id="saleForm">
          <div class="cashier-product-modal-heading"><h2 id="saleModalTitle">Sell a Product</h2><button type="button" class="cashier-payment-icon-btn" id="closeSaleProduct" aria-label="Close product sale">×</button></div>
          <p class="muted">Takes the item out of stock and records the payment.</p>

          <label for="saleItem">Product *</label>
          <select id="saleItem" name="inventoryId" required></select>

          <label for="saleQty">Quantity *</label>
          <input id="saleQty" name="quantity" type="number" min="1" value="1" required>

          <label>Payment method</label>
          ${methodPicker()}

          <p class="sale-total" id="saleTotal"></p>
          <div class="form-actions cashier-product-modal-actions"><button class="secondary-btn" type="button" id="cancelSaleProduct">Cancel</button><button class="primary-btn" type="submit">Record Sale</button></div>
          <p class="message" id="saleMessage" role="status"></p>
        </form>
        </div>
      </div>`;

    const $ = id => body.querySelector("#" + id);
    const rangeForm = $("rangeForm");
    const saleModal = $("saleModal");
    const openSale = () => {
      saleModal.classList.remove("hidden");
      saleModal.setAttribute("aria-hidden", "false");
      document.body.classList.add("dialog-open");
      $("closeSaleProduct").focus();
    };
    const closeSale = () => {
      saleModal.classList.add("hidden");
      saleModal.setAttribute("aria-hidden", "true");
      if (!document.querySelector('.dialog-backdrop')) document.body.classList.remove("dialog-open");
      $("openSaleProduct").focus();
    };
    $("openSaleProduct").addEventListener("click", openSale);
    $("closeSaleProduct").addEventListener("click", closeSale);
    $("cancelSaleProduct").addEventListener("click", closeSale);
    saleModal.addEventListener("click", event => { if (event.target === saleModal) closeSale(); });
    saleModal.addEventListener("keydown", event => {
      if (event.key === 'Escape') { event.preventDefault(); closeSale(); }
      if (event.key !== 'Tab') return;
      const controls = [...saleModal.querySelectorAll('button, select, input')].filter(el => !el.disabled && el.offsetParent !== null);
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    });
    const customerAvatar = payment => {
      const url = typeof payment.customerPhotoUrl === 'string' ? payment.customerPhotoUrl.trim() : '';
      const valid = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(url) || /^(https:\/\/|\/)(?!\/)/i.test(url);
      return `<span class="cashier-payment-avatar"><img src="${escapeHTML(valid ? url : '/images/profile.jpg')}" data-payment-photo alt="" loading="lazy"></span>`;
    };
    const showPayment = payment => {
      const field = (label, value) => `<div class="cashier-payment-detail-field"><small>${label}</small><strong>${value}</strong></div>`;
      App.openDialog(`<div class="cashier-payment-detail-modal">
        <div class="cashier-payment-detail-heading"><h2>Payment Details</h2><button type="button" class="cashier-payment-icon-btn" data-close aria-label="Close payment details">×</button></div>
        <div class="cashier-payment-detail-customer">${customerAvatar(payment)}<div><small>Customer</small><strong>${escapeHTML(payment.customerName || 'Walk-in / Product sale')}</strong></div></div>
        <div class="cashier-payment-detail-grid">
          ${field('Item / Service', escapeHTML(payment.description || '—'))}
          ${field('Transaction Type', escapeHTML(payment.type === 'product' ? 'Product' : 'Service'))}
          ${field('Date & Time', escapeHTML(App.dateTime(payment.createdAt)))}
          ${field('Barber', escapeHTML(payment.barberName || '—'))}
          ${field('Payment Method', escapeHTML(methodLabel(payment.method)))}
          ${field('Cashier', escapeHTML(payment.cashierName || '—'))}
          ${field('Amount', money(payment.amount))}
          ${field('Status', `<span class="cashier-payment-status ${payment.voided ? 'voided' : 'paid'}">${payment.voided ? 'Voided' : 'Paid'}</span>`)}
          ${payment.quantity ? field('Quantity', escapeHTML(payment.quantity)) : ''}
          ${payment.discount ? field('Discount', money(payment.discount)) : ''}
          ${payment.voided ? field('Void Reason', escapeHTML(payment.voidReason || '—')) : ''}
        </div>
        <div class="cashier-payment-detail-footer"><button type="button" class="primary-btn" data-close>Close</button></div>
      </div>`);
    };
    // A capture listener is required because the site's CSP blocks inline onerror handlers.
    const onPaymentImageError = event => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || !img.matches('[data-payment-photo]') || !(body.contains(img) || img.closest('.cashier-payment-detail-modal'))) return;
      if (img.getAttribute('src') !== '/images/profile.jpg') img.src = '/images/profile.jpg';
      else { img.style.display = 'none'; img.parentElement.textContent = (img.closest('.cashier-payment-detail-customer')?.textContent || 'C').trim().charAt(0).toUpperCase(); }
    };
    document.addEventListener('error', onPaymentImageError, true);
    let report = null;
    let items = [];
    let payPage = 1;
    const payPageSize = 10;
    const paymentFilters = { search: "", method: "all", status: "all", sort: "latest" };
    function drawPayments() {
      updatePaymentClear();
      if (!report) return;
      const matches = report.payments.filter(p =>
        (paymentFilters.method === "all" || p.method === paymentFilters.method) &&
        (paymentFilters.status === "all" || (paymentFilters.status === "voided" ? p.voided : !p.voided)) &&
        `${p.description || ""} ${p.customerName || ""} ${p.barberName || ""} ${p.cashierName || ""} ${p.queueNumber || ""}`.toLowerCase().includes(paymentFilters.search));
      matches.sort((a, b) => paymentFilters.sort === "highest" ? b.amount - a.amount : paymentFilters.sort === "lowest" ? a.amount - b.amount : paymentFilters.sort === "oldest" ? new Date(a.createdAt) - new Date(b.createdAt) : new Date(b.createdAt) - new Date(a.createdAt));
      const pages = Math.max(1, Math.ceil(matches.length / payPageSize));
      payPage = Math.min(payPage, pages);
      const shown = matches.slice((payPage - 1) * payPageSize, payPage * payPageSize);
      $("payCount").textContent = `${matches.length} transaction(s)`;
      $("payRows").innerHTML = shown.length ? shown.map((p, index) => `
          <tr class="${p.voided ? "inactive voided" : ""}">
            <td class="cashier-payment-number">${(payPage - 1) * payPageSize + index + 1}</td>
            <td>${App.dateTime(p.createdAt)}</td>
            <td>${escapeHTML(p.description)}${p.quantity ? ` × ${p.quantity}` : ""}${p.queueNumber ? ` <span class="muted small">#${p.queueNumber}</span>` : ""}${p.discount ? `<div class="muted small">Discount ${money(p.discount)}: ${escapeHTML(p.note)}</div>` : p.note ? `<div class="muted small">${escapeHTML(p.note)}</div>` : ""}${p.voided ? `<div class="small void-note">Voided by ${escapeHTML(p.voidedByName)}: ${escapeHTML(p.voidReason)}</div>` : ""}</td>
            <td><div class="cashier-payment-customer">${customerAvatar(p)}<strong>${escapeHTML(p.customerName || 'Walk-in / Product sale')}</strong></div></td><td>${escapeHTML(p.barberName || "—")}</td><td>${escapeHTML(methodLabel(p.method))}</td><td>${escapeHTML(p.cashierName)}</td><td><strong>${money(p.amount)}</strong></td>
            <td><span class="cashier-payment-status ${p.voided ? 'voided' : 'paid'}">${p.voided ? 'Voided' : 'Paid'}</span></td>
            <td><div class="cashier-payment-row-actions"><button type="button" class="cashier-payment-icon-btn" data-payment-view="${escapeHTML(p.id)}" aria-label="View payment details" title="View payment details"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button>${isAdmin && !p.voided ? `<button class="danger-btn small" type="button" data-void="${escapeHTML(p.id)}">Void</button>` : ''}</div></td>
          </tr>`).join("") : emptyRow(10, "No matching payments in this period.");
      $("payPager").innerHTML = `<span>Showing ${matches.length ? (payPage - 1) * payPageSize + 1 : 0}–${Math.min(payPage * payPageSize, matches.length)} of ${matches.length}</span><div><button class="secondary-btn small" type="button" data-pay-page="prev" ${payPage === 1 ? "disabled" : ""}>Previous</button><span>Page ${payPage} of ${pages}</span><button class="secondary-btn small" type="button" data-pay-page="next" ${payPage === pages ? "disabled" : ""}>Next</button></div>`;
    }
    [["paySearch", "search", "input"], ["payMethodFilter", "method", "change"], ["payStatusFilter", "status", "change"], ["paySort", "sort", "change"]].forEach(([id, key, kind]) => {
      $(id).addEventListener(kind, event => { paymentFilters[key] = event.target.value.toLowerCase(); payPage = 1; drawPayments(); });
    });
    $("payPager").addEventListener("click", event => { const button = event.target.closest("[data-pay-page]"); if (!button) return; payPage += button.dataset.payPage === "next" ? 1 : -1; drawPayments(); });

    async function loadItems() {
      items = await api("/api/inventory");
      $("saleItem").innerHTML = items.length
        ? '<option value="">Select a product</option>' + items.map(i => `<option value="${i.id}"${i.quantity < 1 ? " disabled" : ""}>${escapeHTML(i.name)} · ${money(i.price)} · ${i.quantity < 1 ? "out of stock" : `${i.quantity} in stock`}</option>`).join("")
        : '<option value="">No products yet (the admin adds them under Inventory)</option>';
      updateTotal();
    }

    function updateTotal() {
      const item = items.find(i => i.id === $("saleItem").value);
      const qty = Number($("saleQty").value) || 0;
      $("saleQty").max = item ? item.quantity : "";
      $("saleTotal").textContent = item ? `Total: ${money(item.price * qty)}${qty > item.quantity ? ` · only ${item.quantity} in stock` : ""}` : "";
    }

    async function loadReport() {
      try {
        report = await api(`/api/payments?from=${rangeForm.from.value}&to=${rangeForm.to.value}`);
        const t = report.totals;

        $("payTotals").innerHTML = statCards([
          ["Total collected", money(t.total), `Services ${money(t.services)} · Products ${money(t.products)}`],
          ["Cash", money(t.byMethod.cash), "Should match the cash drawer"],
          ["GCash", money(t.byMethod.gcash), `Discounts given: ${money(t.discounts)}`],
          ["Card / other", money(t.byMethod.card + t.byMethod.other), t.voided ? `${t.voided} voided payment(s) not counted` : "No voided payments"]
        ]);

        // Payments-only KPI artwork. Keep the original totals and Front Desk cards unchanged.
        const paymentIcons = [
          '<img class="desk-summary-image" src="/images/CashierDashboard/PesoBadge.png" alt="" decoding="async">',
          '<img class="desk-summary-image" src="/images/CashierDashboard/PesoBadge.png" alt="" decoding="async">',
          '<img class="desk-summary-image" src="/images/CashierDashboard/PesoBadge.png" alt="" decoding="async">',
          '<img class="desk-summary-image" src="/images/CashierDashboard/PesoBadge.png" alt="" decoding="async">'
        ];
        $("payTotals").querySelectorAll(".card").forEach((card, i) => {
          card.classList.add("cashier-payment-summary-card");
          card.insertAdjacentHTML("beforeend", `<span class="cashier-payment-summary-watermark" aria-hidden="true">${paymentIcons[i]}</span>`);
        });

        payPage = 1;
        drawPayments();
      } catch (error) {
        toast(error.message, "error");
      }
    }

    function updatePaymentClear() {
      $("payClear").classList.toggle("hidden", !(paymentFilters.search || paymentFilters.method !== "all" || paymentFilters.status !== "all" || paymentFilters.sort !== "latest" || $("payPeriod").value !== "today"));
    }
    function setRange(range) {
      const now = new Date();
      let from = new Date(now);
      let to = new Date(now);
      if (range === "yesterday") { from.setDate(now.getDate() - 1); to = new Date(from); }
      if (range === "week") from.setDate(now.getDate() - 6);
      if (range === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
      rangeForm.from.value = App.dateKey(from);
      rangeForm.to.value = App.dateKey(to);
      updatePaymentClear();
      loadReport();
    }
    $("payPeriod").addEventListener("change", event => setRange(event.target.value));
    $("payClear").addEventListener("click", () => {
      paymentFilters.search = ""; paymentFilters.method = "all"; paymentFilters.status = "all"; paymentFilters.sort = "latest";
      for (const [id, value] of [["paySearch", ""], ["payMethodFilter", "all"], ["payStatusFilter", "all"], ["paySort", "latest"], ["payPeriod", "today"]]) $(id).value = value;
      payPage = 1;
      setRange("today");
    });
    rangeForm.addEventListener("submit", event => event.preventDefault());

    // ADMIN: void a payment entered by mistake, optionally recording the corrected amount.
    $("payRows").addEventListener("click", event => {
      const viewed = event.target.closest('[data-payment-view]')?.dataset.paymentView;
      if (viewed) {
        const payment = report?.payments.find(p => p.id === viewed);
        if (payment) showPayment(payment);
        return;
      }
      const id = event.target.closest("[data-void]")?.dataset.void;
      const payment = report?.payments.find(p => p.id === id);
      if (!payment) return;

      const { element, close } = openDialog(`
        <form>
          <h2>Void payment</h2>
          <p class="muted">${escapeHTML(payment.description)} · ${money(payment.amount)} (${methodLabel(payment.method)}) by ${escapeHTML(payment.cashierName)}. ${payment.type === "product" ? "The items go back into stock." : ""}</p>
          <label for="voidReason">Reason *</label>
          <input id="voidReason" name="reason" maxlength="200" required placeholder="e.g. Wrong amount entered">
          <label for="voidAmount">Corrected amount (₱, optional)</label>
          <input id="voidAmount" name="replacementAmount" type="number" min="0" step="0.01" placeholder="Leave empty if nothing was paid">
          <label>Corrected payment method</label>
          ${methodPicker("replacementMethod")}
          <div class="form-actions">
            <button class="danger-btn solid" type="submit">Void payment</button>
            <button class="secondary-btn" type="button" data-close>Cancel</button>
          </div>
          <p class="message" id="voidMessage"></p>
        </form>`);

      element.querySelector("form").addEventListener("submit", async submitEvent => {
        submitEvent.preventDefault();
        const f = submitEvent.target;
        await busy(submitEvent.submitter, async () => {
          try {
            const result = await api(`/api/payments/${payment.id}/void`, {
              method: "POST",
              body: {
                reason: f.reason.value,
                replacementAmount: f.replacementAmount.value === "" ? undefined : Number(f.replacementAmount.value),
                replacementMethod: f.replacementMethod.value
              }
            });
            close();
            await Promise.all([loadItems(), loadReport()]);
            toast(result.message);
          } catch (error) {
            setMessage(element.querySelector("#voidMessage"), error.message, "error");
          }
        });
      });
    });

    $("saleForm").addEventListener("input", updateTotal);
    $("saleForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.target;

      await busy(event.submitter, async () => {
        try {
          const result = await api("/api/payments/product-sale", {
            method: "POST",
            body: { inventoryId: form.inventoryId.value, quantity: Number(form.quantity.value), method: form.method.value }
          });
          form.reset();
          closeSale();
          setMessage($("saleMessage"), "");
          await Promise.all([loadItems(), loadReport()]);
          toast(`${result.message} ${money(result.payment.amount)} recorded. ${result.remainingStock} left.`);
        } catch (error) {
          setMessage($("saleMessage"), error.message, "error");
        }
      });
    });

    await Promise.all([loadItems(), loadReport()]);
    return () => { document.removeEventListener('error', onPaymentImageError, true); if (!saleModal.classList.contains('hidden')) document.body.classList.remove('dialog-open'); };
  }

  // ---------- Customers: accounts and walk-ins ----------

  async function customers(body, actions, user) {
    const isAdmin = user?.role === "admin";
    body.classList.add("front-desk-view", "cashier-customer-view");
    actions.innerHTML = '<button class="primary-btn" type="button" id="newCustomer">+ New customer account</button>';
    const eye = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    const history = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/><path d="M12 7v5l3 2"/></svg>';
    const plus = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v8m-4-4h8"/></svg>';
    const dateValue = value => value ? new Date(value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "—";
    const safePhoto = value => {
      const photo = typeof value === "string" ? value.trim() : "";
      return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo) ? photo : App.safePhoto(photo) || "/images/profile.jpg";
    };
    const avatar = c => `<img class="cashier-customer-avatar" src="${escapeHTML(safePhoto(c.photoUrl))}" alt="" loading="lazy" decoding="async">`;
    body.innerHTML = `
      <form class="card filter-bar cashier-ops-filters cashier-visits-toolbar cashier-customer-filters" id="customerSearch" role="search">
        <label class="cashier-ops-search"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input type="search" name="search" placeholder="Search name, email or phone..." aria-label="Search customers"></label>
        <select id="customerStatus" aria-label="Filter customer status"><option value="all">All Status</option><option value="active">Active</option><option value="inactive">Deactivated</option></select>
        <select id="customerSort" aria-label="Sort customers"><option value="newest">Newest First</option><option value="name">Name A–Z</option><option value="visits">Most Visits</option><option value="spent">Highest Spending</option></select>
        <button class="secondary-btn cashier-customer-clear hidden" type="button" id="customerClear">Clear All</button>
      </form>
      <article class="card cashier-ops-table cashier-customer-panel">
        <div class="card-heading"><div><h2>Customer Accounts</h2><p class="muted small">Registered customer profiles and visit records</p></div><span class="muted" id="customerCount"></span></div>
        <div class="table-wrap"><table class="data-table cashier-customer-table"><thead><tr><th>No.</th><th>Customer</th><th>Email</th><th>Phone</th><th>Visits</th><th>Total Spent</th><th>Last Visit</th><th>Status</th><th>Actions</th></tr></thead><tbody id="customerRows"></tbody></table></div>
        <div class="cashier-ops-pager" id="customerPager"></div>
      </article>
      <article class="card spaced cashier-ops-table cashier-customer-panel">
        <div class="card-heading"><div><h2>Walk-ins Without an Account</h2><p class="muted small">Unregistered queue visits within the last 30 days</p></div><span class="muted" id="walkInCount"></span></div>
        <form class="cashier-walkin-filters" id="walkInSearch"><label class="cashier-ops-search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input name="search" type="search" placeholder="Search walk-in or service..." aria-label="Search walk-ins"></label><select id="walkInStatus" aria-label="Filter walk-in status"><option value="all">All Status</option><option value="waiting">Waiting</option><option value="serving">Being Served</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option><option value="no-show">No-show</option></select><select id="walkInSort" aria-label="Sort walk-ins"><option value="newest">Newest First</option><option value="oldest">Oldest First</option></select><button type="button" class="secondary-btn hidden" id="walkInClear">Clear All</button></form>
        <div class="table-wrap"><table class="data-table cashier-walkin-table"><thead><tr><th>No.</th><th>Date &amp; Time</th><th>Queue #</th><th>Customer</th><th>Haircut / Service</th><th>Barber</th><th>Status</th><th>Paid</th><th>Actions</th></tr></thead><tbody id="walkInRows"></tbody></table></div>
        <div class="cashier-ops-pager" id="walkInPager"></div>
      </article>`;
    const $ = id => body.querySelector("#" + id);
    let list = [], walkIns = [];
    let customerLoadError = "", walkInLoadError = "";
    let customerPage = 1, walkInPage = 1;
    const rowsPerPage = 10;
    let customerQuery = "", walkInQuery = "";
    function pager(id, length, current, onPage) {
      const pages = Math.max(1, Math.ceil(length / rowsPerPage));
      const page = Math.max(1, Math.min(current, pages));
      $(id).innerHTML = `<span>Showing ${length ? (page - 1) * rowsPerPage + 1 : 0}–${Math.min(page * rowsPerPage, length)} of ${length}</span><div><button type="button" class="secondary-btn small" data-page="prev" ${page === 1 ? "disabled" : ""}>Previous</button><span>Page ${page} of ${pages}</span><button type="button" class="secondary-btn small" data-page="next" ${page === pages ? "disabled" : ""}>Next</button></div>`;
      $(id).onclick = event => {
        const button = event.target.closest("[data-page]");
        if (button) onPage(page + (button.dataset.page === "next" ? 1 : -1));
      };
      return page;
    }
    function drawCustomers() {
      const status = $("customerStatus").value, sort = $("customerSort").value;
      const filtered = list.filter(c => (status === "all" || (status === "active" ? c.active : !c.active)) && `${c.name} ${c.email} ${c.phone || ""}`.toLowerCase().includes(customerQuery.toLowerCase()));
      filtered.sort((a, b) => sort === "name" ? String(a.name).localeCompare(String(b.name)) : sort === "visits" ? b.visits - a.visits : sort === "spent" ? b.spent - a.spent : new Date(b.createdAt) - new Date(a.createdAt));
      customerPage = pager("customerPager", filtered.length, customerPage, value => { customerPage = value; drawCustomers(); });
      $("customerCount").textContent = `${filtered.length} customer${filtered.length === 1 ? "" : "s"}`;
      $("customerClear").classList.toggle("hidden", !(customerQuery || status !== "all" || sort !== "newest"));
      $("customerRows").innerHTML = customerLoadError ? `<tr class="empty-row"><td colspan="9">${escapeHTML(customerLoadError)} <button class="secondary-btn small" type="button" data-retry-customers>Retry</button></td></tr>` : filtered.slice((customerPage - 1) * rowsPerPage, customerPage * rowsPerPage).map((c, i) => `
        <tr><td>${(customerPage - 1) * rowsPerPage + i + 1}</td><td><div class="cashier-customer-identity">${avatar(c)}<strong>${escapeHTML(c.name)}</strong></div></td>
        <td>${escapeHTML(c.email)}</td><td>${escapeHTML(c.phone || "—")}</td><td>${Number(c.visits) || 0}</td><td>${money(c.spent)}</td><td>${escapeHTML(c.lastVisit || "—")}</td>
        <td><span class="cashier-account-status ${c.active ? "active" : "inactive"}">${c.active ? "Active" : "Inactive"}</span></td>
        <td><div class="cashier-customer-actions"><button class="cashier-icon-btn" type="button" data-detail="${c.id}" aria-label="View details for ${escapeHTML(c.name)}" title="View Details">${eye}</button><button class="cashier-icon-btn" type="button" data-visits="${c.id}" aria-label="Visit history for ${escapeHTML(c.name)}" title="Visit History">${history}</button>${isAdmin ? `<button class="cashier-account-toggle" type="button" data-toggle="${c.id}">${c.active ? "Deactivate" : "Activate"}</button>` : ""}</div></td></tr>`).join("") || emptyRow(9, "No matching customer accounts.");
    }
    function filteredWalkIns() {
      const status = $("walkInStatus").value;
      const filtered = walkIns.filter(v => (status === "all" || v.status === status) && `${v.customerName || ""} ${v.service || ""} ${v.barberName || ""} ${v.queueNumber || ""}`.toLowerCase().includes(walkInQuery.toLowerCase()));
      filtered.sort((a, b) => $("walkInSort").value === "oldest" ? new Date(a.createdAt || a.queueDate) - new Date(b.createdAt || b.queueDate) : new Date(b.createdAt || b.queueDate) - new Date(a.createdAt || a.queueDate));
      return filtered;
    }
    function drawWalkIns() {
      const filtered = filteredWalkIns();
      walkInPage = pager("walkInPager", filtered.length, walkInPage, value => { walkInPage = value; drawWalkIns(); });
      $("walkInCount").textContent = `${filtered.length} walk-in record${filtered.length === 1 ? "" : "s"}`;
      $("walkInClear").classList.toggle("hidden", !(walkInQuery || $("walkInStatus").value !== "all" || $("walkInSort").value !== "newest"));
      $("walkInRows").innerHTML = walkInLoadError ? `<tr class="empty-row"><td colspan="9">${escapeHTML(walkInLoadError)} <button class="secondary-btn small" type="button" data-retry-walkins>Retry</button></td></tr>` : filtered.slice((walkInPage - 1) * rowsPerPage, walkInPage * rowsPerPage).map((v, i) => `<tr><td>${(walkInPage - 1) * rowsPerPage + i + 1}</td><td>${escapeHTML(v.createdAt ? new Date(v.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : v.queueDate)}</td><td><strong>#${escapeHTML(v.queueNumber)}</strong></td><td>${escapeHTML(v.customerName || "Walk-in Guest")}</td><td>${escapeHTML(v.service)}</td><td>${escapeHTML(v.barberName || "—")}</td><td>${statusPill(v.status)}</td><td>${v.amountPaid != null ? money(v.amountPaid) : "Unpaid"}</td><td><div class="cashier-customer-actions"><button class="cashier-icon-btn" type="button" data-walkin-detail="${v.id}" aria-label="View walk-in details" title="View Details">${eye}</button><button class="cashier-icon-btn" type="button" data-account-for="${v.id}" aria-label="Create customer account" title="Create Account">${plus}</button></div></td></tr>`).join("") || emptyRow(9, "No walk-in visits in the last 30 days.");
    }
    function detailsModal(customer) {
      const { element } = openDialog(`<div class="cashier-profile-modal"><div class="cashier-modal-head"><div><span class="cashier-modal-kicker">CUSTOMER PROFILE</span><h2>Customer Details</h2></div><button type="button" data-close class="cashier-modal-x" aria-label="Close">×</button></div><div class="cashier-profile-overview">${avatar(customer)}<div><h3>${escapeHTML(customer.name)}</h3><span class="cashier-account-status ${customer.active ? "active" : "inactive"}">${customer.active ? "Active" : "Inactive"}</span></div></div><div class="cashier-profile-grid">${[["Email", customer.email],["Phone", customer.phone || "—"],["Completed Visits", customer.visits || 0],["Total Spent", money(customer.spent)],["Last Visit", customer.lastVisit || "—"],["Date Registered", dateValue(customer.createdAt)]].map(([label,value]) => `<div><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`).join("")}</div><div class="cashier-modal-footer"><button type="button" class="secondary-btn" data-close>Close</button><button type="button" class="primary-btn" data-open-history="${customer.id}">View Visit History</button></div></div>`);
      element.querySelector("[data-open-history]").addEventListener("click", () => { element.querySelector("[data-close]").click(); showVisits(customer); });
    }
    function walkInDetails(visit) {
      openDialog(`<div class="cashier-profile-modal"><div class="cashier-modal-head"><div><span class="cashier-modal-kicker">WALK-IN RECORD</span><h2>Visit Details</h2></div><button type="button" data-close class="cashier-modal-x" aria-label="Close">×</button></div><div class="cashier-profile-grid">${[["Customer",visit.customerName || "Walk-in Guest"],["Queue #",`#${visit.queueNumber}`],["Date & Time",visit.createdAt ? new Date(visit.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : visit.queueDate],["Haircut / Service",visit.service],["Barber",visit.barberName || "—"],["Status",visit.status],["Amount Paid",visit.amountPaid != null ? money(visit.amountPaid) : "Unpaid"]].map(([label,value]) => `<div><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`).join("")}</div><div class="cashier-modal-footer"><button type="button" class="secondary-btn" data-close>Close</button><button type="button" class="primary-btn" data-start-account="${visit.id}">Create Account</button></div></div>`).element.querySelector("[data-start-account]").addEventListener("click", event => { event.currentTarget.closest(".dialog-backdrop").querySelector("[data-close]").click(); accountDialog(visit); });
    }
    async function showVisits(customer) {
      try {
        const visits = await api(`/api/customers/${customer.id}/visits`);
        const { element } = openDialog(`<div class="cashier-history-modal"><div class="cashier-modal-head"><div><span class="cashier-modal-kicker">CUSTOMER RECORDS</span><h2>Visit History</h2></div><button type="button" data-close class="cashier-modal-x" aria-label="Close">×</button></div><div class="cashier-profile-overview">${avatar(customer)}<div><h3>${escapeHTML(customer.name)}</h3><p class="muted small">Recorded visits and services</p></div></div><div class="cashier-history-stats"><div><small>Completed Visits</small><strong>${Number(customer.visits) || 0}</strong></div><div><small>Total Spent</small><strong>${money(customer.spent)}</strong></div></div><div class="cashier-history-table-title">Visit Records <span class="muted">${visits.length} records</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>No.</th><th>Date</th><th>Queue #</th><th>Haircut / Service</th><th>Barber</th><th>Status</th><th>Amount Paid</th></tr></thead><tbody id="customerVisitRows"></tbody></table></div><div class="cashier-history-pager" id="customerVisitPager"></div><div class="cashier-modal-footer"><button type="button" class="secondary-btn" data-close>Close</button></div></div>`);
        let page = 1;
        const draw = () => {
          const pages = Math.max(1, Math.ceil(visits.length / 10)); page = Math.min(Math.max(page, 1), pages);
          element.querySelector("#customerVisitRows").innerHTML = visits.slice((page - 1) * 10, page * 10).map((v, i) => `<tr><td>${(page - 1) * 10 + i + 1}</td><td>${escapeHTML(v.queueDate)}</td><td>#${escapeHTML(v.queueNumber)}</td><td>${escapeHTML(v.service)}</td><td>${escapeHTML(v.barberName || "—")}</td><td>${statusPill(v.status)}</td><td>${v.amountPaid != null ? money(v.amountPaid) : "Unpaid"}</td></tr>`).join("") || emptyRow(7, "No visits recorded yet.");
          element.querySelector("#customerVisitPager").innerHTML = `<span>Page ${page} of ${pages}</span><div><button class="secondary-btn small" type="button" data-visit-page="prev" ${page === 1 ? "disabled" : ""}>Previous</button><button class="secondary-btn small" type="button" data-visit-page="next" ${page === pages ? "disabled" : ""}>Next</button></div>`;
        };
        element.querySelector("#customerVisitPager").addEventListener("click", event => { const button = event.target.closest("[data-visit-page]"); if (button) { page += button.dataset.visitPage === "next" ? 1 : -1; draw(); } });
        draw();
      } catch (error) { toast(error.message, "error"); }
    }
    function accountDialog(visit) {
      const { element, close } = openDialog(`<form class="cashier-profile-modal cashier-register-form"><div class="cashier-modal-head"><div><span class="cashier-modal-kicker">ACCOUNT REGISTRATION</span><h2>${visit ? "Create Walk-in Account" : "New Customer Account"}</h2></div><button type="button" data-close class="cashier-modal-x" aria-label="Close">×</button></div><p class="muted">Only register a customer who has requested an account. A secure setup link will be sent to the customer's email so they can create their own password.${visit ? " The walk-in visit will be linked after account setup." : ""}</p><label for="ncName">Customer name *</label><input id="ncName" name="name" required maxlength="60" value="${escapeHTML(visit?.customerName || "")}"><label for="ncEmail">Email *</label><input id="ncEmail" name="email" type="email" required><label for="ncPhone">Phone</label><input id="ncPhone" name="phone" type="tel" maxlength="20"><label class="cashier-consent"><input type="checkbox" name="consent" required><span>The customer has agreed to create an account using this email.</span></label><p id="ncMessage" class="message" role="status"></p><div class="cashier-modal-footer"><button class="secondary-btn" type="button" data-close>Cancel</button><button class="primary-btn" type="submit">Send Setup Link</button></div></form>`);
      element.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        await busy(form.querySelector('[type="submit"]'), async () => {
          try {
            const result = await api("/api/customers", { method: "POST", body: { name: form.elements.namedItem("name").value, email: form.elements.namedItem("email").value, phone: form.elements.namedItem("phone").value, consent: form.elements.namedItem("consent").checked, ticketId: visit?.id } });
            close(); toast(result.message || "Customer setup email sent.");
            await Promise.all([loadCustomers(), loadWalkIns()]);
          } catch (error) { setMessage(element.querySelector("#ncMessage"), error.message, "error"); }
        });
      });
    }
    async function loadCustomers() {
      try {
        list = await api("/api/customers");
        customerLoadError = "";
      } catch (error) {
        customerLoadError = error.message || "Unable to load customer accounts.";
      }
      drawCustomers();
    }
    async function loadWalkIns() {
      try {
        walkIns = await api("/api/customers/walk-ins");
        walkInLoadError = "";
      } catch (error) {
        walkInLoadError = error.message || "Unable to load walk-in visits.";
      }
      drawWalkIns();
    }
    $("customerSearch").addEventListener("submit", event => event.preventDefault());
    $("customerSearch").elements.search.addEventListener("input", event => { customerQuery = event.target.value.trim(); customerPage = 1; drawCustomers(); });
    $("customerStatus").addEventListener("change", () => { customerPage = 1; drawCustomers(); });
    $("customerSort").addEventListener("change", () => { customerPage = 1; drawCustomers(); });
    $("customerClear").addEventListener("click", () => { $("customerSearch").reset(); customerQuery = ""; customerPage = 1; drawCustomers(); });
    $("walkInSearch").addEventListener("submit", event => event.preventDefault());
    $("walkInSearch").elements.search.addEventListener("input", event => { walkInQuery = event.target.value.trim(); walkInPage = 1; drawWalkIns(); });
    $("walkInStatus").addEventListener("change", () => { walkInPage = 1; drawWalkIns(); });
    $("walkInSort").addEventListener("change", () => { walkInPage = 1; drawWalkIns(); });
    $("walkInClear").addEventListener("click", () => { $("walkInSearch").reset(); walkInQuery = ""; walkInPage = 1; drawWalkIns(); });
    actions.querySelector("#newCustomer").addEventListener("click", () => accountDialog(null));
    $("customerRows").addEventListener("click", async event => {
      const button = event.target.closest("button"); if (!button) return;
      if (button.hasAttribute("data-retry-customers")) { await busy(button, loadCustomers); return; }
      const id = button.dataset.detail || button.dataset.visits || button.dataset.toggle;
      const customer = list.find(c => c.id === id); if (!customer) return;
      if (button.dataset.detail) detailsModal(customer);
      else if (button.dataset.visits) await showVisits(customer);
      else if (button.dataset.toggle && isAdmin) {
        try {
          const turnOff = customer.active;
          if (!await confirmDialog(`${turnOff ? "Deactivate" : "Activate"} ${customer.name}'s account?`, { title: `${turnOff ? "Deactivate" : "Activate"} account`, confirmText: turnOff ? "Deactivate" : "Activate", danger: turnOff })) return;
          const result = await api(`/api/customers/${id}`, { method: "PATCH", body: { active: !customer.active } }); await loadCustomers(); toast(result.message);
        } catch (error) { toast(error.message, "error"); }
      }
    });
    $("walkInRows").addEventListener("click", async event => {
      const button = event.target.closest("button"); if (!button) return;
      if (button.hasAttribute("data-retry-walkins")) { await busy(button, loadWalkIns); return; }
      const id = button.dataset.walkinDetail || button.dataset.accountFor;
      const visit = walkIns.find(v => v.id === id); if (!visit) return;
      if (button.dataset.walkinDetail) walkInDetails(visit); else accountDialog(visit);
    });
    body.addEventListener("error", event => { if (event.target.matches(".cashier-customer-avatar")) { event.target.onerror = null; if (!event.target.src.endsWith("/images/profile.jpg")) event.target.src = "/images/profile.jpg"; } }, true);
    await Promise.all([loadCustomers(), loadWalkIns()]);
  }

  // ---------- My account: password, devices, deleting a customer account ----------

  async function account(body, actions, user) {
    const staff = user && user.role !== "customer";

    body.innerHTML = `
      <form class="card form-card narrow" id="passwordForm">
        <h2>Change password</h2>
        <p class="muted">${staff
          ? "Use at least 10 characters with upper and lower case letters, a number and a symbol."
          : "Use at least 8 characters with letters and numbers."}</p>

        <label for="currentPassword">Current password</label>
        <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required>

        <label for="newPassword">New password</label>
        <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="${staff ? 10 : 8}" required>

        <label for="confirmPassword">Confirm new password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required>

        <div class="form-actions"><button class="primary-btn" type="submit">Change password</button></div>
        <p class="message" id="passwordMessage" role="status"></p>
      </form>

      <section class="card narrow spaced">
        <h2>Devices</h2>
        <p class="muted">Lost a phone, or signed in on a shared computer? Sign out everywhere else${staff ? " and forget the devices that skip the email code" : ""}. Changing your password does this too.</p>
        <button class="secondary-btn" type="button" id="logoutEverywhere">Sign out all other devices</button>
      </section>

      ${staff ? "" : `
      <section class="card narrow spaced">
        <h2>Delete my account</h2>
        <p class="muted">Removes your name, email and phone. Your past visits stay in the shop's records without your name. You can still join the queue as a walk-in.</p>
        <form id="deleteForm" class="inline-form">
          <label for="deletePassword">Your password</label>
          <input id="deletePassword" name="password" type="password" autocomplete="current-password" required>
          <button class="danger-btn" type="submit">Delete my account</button>
        </form>
        <p class="message" id="deleteMessage" role="status"></p>
      </section>`}`;

    body.querySelector("#logoutEverywhere").addEventListener("click", event => busy(event.target, async () => {
      try {
        const result = await api("/api/auth/logout-everywhere", { method: "POST" });
        toast(result.message);
      } catch (error) {
        toast(error.message, "error");
      }
    }));

    body.querySelector("#deleteForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const password = event.target.password.value;
      if (!await confirmDialog("Your account will be deleted. This can't be undone.", { title: "Delete my account", confirmText: "Delete my account", danger: true })) return;

      try {
        await api("/api/auth/delete-account", { method: "POST", body: { password } });
        sessionStorage.removeItem("customerName");
        window.location.href = "/login.html#deleted";
      } catch (error) {
        setMessage(body.querySelector("#deleteMessage"), error.message, "error");
      }
    });

    body.querySelector("#passwordForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.target;
      const message = body.querySelector("#passwordMessage");

      if (form.newPassword.value !== form.confirmPassword.value) {
        setMessage(message, "The new passwords don't match.", "error");
        return;
      }

      await busy(event.submitter, async () => {
        try {
          await api("/api/auth/change-password", {
            method: "POST",
            body: { currentPassword: form.currentPassword.value, newPassword: form.newPassword.value }
          });
          form.reset();
          setMessage(message, "");
          toast("Password changed. Other devices have been signed out.");
          document.getElementById("passwordBanner")?.classList.add("hidden");
          App.state.mustChangePassword = false;
        } catch (error) {
          setMessage(message, error.message, "error");
        }
      });
    });
  }

  window.Desk = { queue, payments, customers, account, methodLabel, serviceOptions, emptyRow, statCards };
})();
