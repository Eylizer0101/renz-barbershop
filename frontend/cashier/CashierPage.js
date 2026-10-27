// Cashier page: front desk, payments, customers and account.
(async function () {
  const user = await App.requireStaff(["cashier", "admin"]);
  if (!user) return;

  // Cashier notifications share the customer appointment event source, but staff read state is per account.
  const bell = document.getElementById("staffNotifications");
  const dropdown = document.getElementById("staffNotificationDropdown");
  const profileButton = document.getElementById("cashierProfileTrigger");
  const profileMenu = document.getElementById("cashierProfileMenu");
  const notificationState = { items: [], filter: "all", search: "", page: 1, error: "" };
  const notificationTypes = ["created", "cancelled", "confirmed", "checked-in", "no-show"];
  const timeAgo = date => {
    const ms = Math.max(0, Date.now() - new Date(date).getTime());
    if (ms < 60000) return "Just now";
    if (ms < 3600000) return `${Math.floor(ms / 60000)} min ago`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
    return new Date(date).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  };
  const unread = () => notificationState.items.filter(item => !item.read).length;
  function closeDropdown() { dropdown.classList.add("hidden"); bell.setAttribute("aria-expanded", "false"); }
  function closeProfile() { profileMenu.classList.add("hidden"); profileButton.setAttribute("aria-expanded", "false"); }
  // Match the customer's appointment notification icons (SVG rather than font symbols).
  const notificationSymbol = type => ({
    "created": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 13v6M9 16h6"/></svg>`,
    "confirmed": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-12 6 2 2 4-4"/></svg>`,
    "cancelled": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-12 4 6 6m0-6-6 6"/></svg>`,
    "checked-in": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>`,
    "no-show": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>`
  })[type] || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
  const bellSymbol = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>`;
  const searchSymbol = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>`;
  function itemMarkup(n, compact = false) {
    return `<article class="cashier-notification-item${n.read ? "" : " unread"}" data-notification-id="${App.escapeHTML(n.id)}">
      <span class="cashier-notification-item-icon" aria-hidden="true">${notificationSymbol(n.type)}</span>
      <div class="cashier-notification-item-copy"><div class="cashier-notification-item-head"><strong>${App.escapeHTML(n.title)}</strong><small>${App.escapeHTML(timeAgo(n.createdAt))}</small>${n.read ? "" : '<i class="cashier-unread-dot"></i>'}</div><p>${App.escapeHTML(n.message)}</p>
      ${compact ? "" : `<div class="cashier-notification-item-actions"><button type="button" data-staff-view="${App.escapeHTML(n.id)}">View Details →</button>${n.read ? "" : `<button type="button" data-staff-read="${App.escapeHTML(n.id)}">✓ Mark as read</button>`}</div>`}</div></article>`;
  }
  function grouped(items, compact = false) {
    if (!items.length) return '<p class="cashier-notification-empty">No notifications to show.</p>';
    let group = "";
    return items.map(item => {
      const date = new Date(item.createdAt);
      const today = new Date();
      const label = date.toDateString() === today.toDateString() ? "TODAY" : date.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }).toUpperCase();
      const title = label !== group ? `<h3 class="cashier-notification-group">${App.escapeHTML(label)}</h3>` : "";
      group = label;
      return title + itemMarkup(item, compact);
    }).join("");
  }
  function updateBadge() {
    const count = unread();
    document.getElementById("staffUnread").textContent = count ? String(count) : "";
  }
  function renderDropdown() {
    dropdown.innerHTML = `<div class="cashier-notification-head"><span class="cashier-notification-head-icon" aria-hidden="true">${bellSymbol}</span><strong>Notifications</strong><button type="button" data-staff-read-all ${notificationState.items.length ? "" : "disabled"}>Mark all as read</button></div>
      <div class="cashier-notification-dropdown-body">${notificationState.error ? `<p class="cashier-notification-empty">${App.escapeHTML(notificationState.error)}</p>` : grouped(notificationState.items.slice(0, 7), true)}</div>
      <button class="cashier-notification-view-all" type="button" data-staff-view-all>View all notifications　›</button>`;
  }
  function renderPage(body) {
    const filtered = notificationState.items.filter(item =>
      (notificationState.filter === "all" || (notificationState.filter === "read" ? item.read : !item.read)) &&
      `${item.title} ${item.message}`.toLowerCase().includes(notificationState.search.toLowerCase()));
    const pages = Math.max(1, Math.ceil(filtered.length / 10));
    notificationState.page = Math.min(notificationState.page, pages);
    const start = (notificationState.page - 1) * 10;
    const list = body.querySelector("#cashierNotificationsList");
    if (!list) return;
    list.innerHTML = notificationState.error ? `<p class="cashier-notification-empty">${App.escapeHTML(notificationState.error)}</p>` : grouped(filtered.slice(start, start + 10));
    body.querySelector("#cashierNotificationPager").innerHTML = `<button type="button" data-staff-page="prev" ${notificationState.page === 1 ? "disabled" : ""}>‹ Previous</button><span>Page ${notificationState.page} of ${pages}</span><button type="button" data-staff-page="next" ${notificationState.page === pages ? "disabled" : ""}>Next ›</button>`;
    body.querySelectorAll("[data-staff-filter]").forEach(button => button.classList.toggle("active", button.dataset.staffFilter === notificationState.filter));
    body.querySelector("#cashierNotificationsMarkAll").disabled = !notificationState.items.length;
    const tabCount = body.querySelector("#cashierUnreadTabCount");
    if (tabCount) tabCount.textContent = unread() ? String(unread()) : "";
  }
  async function loadNotifications(all = false) {
    try {
      notificationState.items = (await App.api(`/api/appointments/notifications${all ? "?all=1" : ""}`)).filter(n => notificationTypes.includes(n.type));
      notificationState.error = "";
    } catch (error) { notificationState.error = error.message; }
    updateBadge();
    renderDropdown();
    const page = document.querySelector("#cashierNotificationsList");
    if (page) renderPage(page.closest(".page-body"));
  }
  async function markRead(id) {
    try {
      await App.api(`/api/appointments/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
      const item = notificationState.items.find(n => n.id === id);
      if (item) item.read = true;
      updateBadge(); renderDropdown();
      const list = document.querySelector("#cashierNotificationsList");
      if (list) renderPage(list.closest(".page-body"));
    } catch (error) { App.toast(error.message, "error"); }
  }
  async function markAll() {
    if (!notificationState.items.length) return;
    if (!unread()) {
      App.toast("All notifications are already marked as read.", "info");
      return;
    }
    try {
      await App.api("/api/appointments/notifications/read-all", { method: "PATCH" });
      // Reload persisted, account-specific read status from the server.
      await loadNotifications(true);
      if (notificationState.error) throw new Error(notificationState.error);
      App.toast("All notifications marked as read.", "success");
    } catch (error) { App.toast(error.message, "error"); }
  }
  bell.addEventListener("click", async event => {
    event.stopPropagation(); closeProfile();
    const shouldOpen = dropdown.classList.contains("hidden");
    if (!shouldOpen) { closeDropdown(); return; }
    await loadNotifications();
    dropdown.classList.remove("hidden"); bell.setAttribute("aria-expanded", "true");
  });
  dropdown.addEventListener("click", async event => {
    if (event.target.closest("[data-staff-read-all]")) return markAll();
    if (event.target.closest("[data-staff-view-all], [data-notification-id]")) { closeDropdown(); navigator.open("notifications"); }
  });
  profileButton.addEventListener("click", event => {
    event.stopPropagation(); closeDropdown();
    const open = profileMenu.classList.contains("hidden");
    profileMenu.classList.toggle("hidden", !open); profileButton.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".cashier-profile-wrap")) closeProfile();
    if (!event.target.closest(".cashier-header-actions")) closeDropdown();
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { closeProfile(); closeDropdown(); } });
  async function confirmLogout() {
    closeProfile(); closeDropdown();
    // Same centered confirmation UI and accessible dialog behavior as the customer dashboard.
    const confirmed = await new Promise(resolve => {
      let answered = false;
      const { element, close } = App.openDialog(`
        <div class="customer-logout-confirmation">
          <span class="customer-logout-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/></svg></span>
          <h2>Sign out?</h2>
          <p>Are you sure you want to sign out of your account? You can sign in again anytime.</p>
          <div class="customer-logout-actions">
            <button type="button" class="customer-logout-cancel" data-close>Cancel</button>
            <button type="button" class="customer-logout-confirm" data-cashier-signout>Sign out</button>
          </div>
        </div>`, { onClose: () => { if (!answered) resolve(false); } });
      element.querySelector('[data-close]').focus();
      element.querySelector('[data-cashier-signout]').addEventListener('click', () => {
        answered = true;
        close();
        resolve(true);
      });
    });
    if (confirmed) await App.logout();
  }
  document.getElementById("cashierLogoutMenu").addEventListener("click", confirmLogout);
  document.getElementById("cashierSidebarLogout").addEventListener("click", confirmLogout);
  // Keep unread counts up to date without affecting the Front Desk's own refresh cycle.
  loadNotifications();
  window.setInterval(() => loadNotifications(window.location.hash === "#notifications"), 30000);
  // Replace only the large management page heading with a banner. The
  // existing heading-actions node is preserved for the Customers button.
  function managementBanner(body, kind) {
    const heading = body.parentElement?.querySelector('.section-heading');
    if (!heading) return;
    const actions = heading.querySelector('.heading-actions');
    const content = {
      appointments: {
        eyebrow: 'BOOKING OVERVIEW',
        title: 'Appointment Management',
        description: 'Manage customer bookings, confirmations, and check-ins in one place.',
        artwork: '<img src="/images/AdminDashboard/ActivityLog.png" alt="" loading="eager" decoding="async">'
      },
      payments: {
        eyebrow: 'SALES OVERVIEW',
        title: 'Payment Management',
        description: 'Track transactions, monitor sales, and manage product payments.',
        artwork: '<img src="/images/CashierDashboard/PesoBadge.png" alt="" loading="eager" decoding="async">'
      },
      customers: {
        eyebrow: 'CUSTOMER OVERVIEW',
        title: 'Customer Management',
        description: 'Manage customer accounts, profiles, and visit history.',
        artwork: '<img src="/images/AdminDashboard/Customers.png" alt="" loading="eager" decoding="async">'
      }
    }[kind];
    if (!content) return;
    const banner = document.createElement('section');
    banner.className = 'cashier-management-banner';
    banner.setAttribute('aria-label', content.title);
    banner.innerHTML = `<div class="cashier-management-banner-copy"><span class="cashier-management-banner-eyebrow"><span class="cashier-management-banner-dot" aria-hidden="true"></span>${content.eyebrow}</span><h1>${content.title}</h1><p>${content.description}</p></div><div class="cashier-management-banner-art" aria-hidden="true">${content.artwork}</div>`;
    if (actions) banner.querySelector('.cashier-management-banner-copy').appendChild(actions);
    heading.classList.add('cashier-management-heading');
    heading.replaceChildren(banner);
  }

  const navigator = App.mountPages({
    desk: {
      title: "Front Desk",
      eyebrow: "TODAY'S QUEUE",
      description: "Add walk-ins, call customers to free barbers, and take payment when they're done.",
      render: (body, actions) => {
        // Keep the original live queue, API calls, and all Front Desk controls intact.
        const queueResult = Desk.queue(body, actions, user);
        const hero = body.querySelector("#deskHero");
        let clockTimer = null;
        if (hero) {
          const welcome = document.createElement("aside");
          welcome.className = "cashier-welcome-card";
          welcome.setAttribute("aria-label", "Current Philippine date and time");
          welcome.innerHTML = `
            <img class="cashier-welcome-art" src="/images/CashierDashboard/Sun.png" alt="" aria-hidden="true" decoding="async">
            <div class="cashier-welcome-copy">
              <span class="cashier-welcome-kicker">Welcome! Today Is</span>
              <strong class="cashier-welcome-day"></strong>
              <span class="cashier-welcome-date"></span>
              <time class="cashier-welcome-time"></time>
            </div>`;
          hero.appendChild(welcome);

          const day = welcome.querySelector(".cashier-welcome-day");
          const date = welcome.querySelector(".cashier-welcome-date");
          const time = welcome.querySelector(".cashier-welcome-time");
          const artwork = welcome.querySelector(".cashier-welcome-art");
          const locale = "en-PH";
          const zone = "Asia/Manila";
          const dayFormat = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "long" });
          const dateFormat = new Intl.DateTimeFormat(locale, { timeZone: zone, month: "long", day: "numeric", year: "numeric" });
          const timeFormat = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
          const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" });
          let shownIcon = "";
          function updateClock() {
            if (!welcome.isConnected) return;
            const now = new Date();
            const hour = Number(hourFormat.format(now));
            const icon = hour >= 6 && hour < 18 ? "Sun" : "Moon";
            if (shownIcon !== icon) {
              artwork.src = `/images/CashierDashboard/${icon}.png`;
              shownIcon = icon;
            }
            day.textContent = dayFormat.format(now).toUpperCase();
            date.textContent = dateFormat.format(now);
            time.textContent = timeFormat.format(now);
            time.dateTime = now.toISOString();
          }
          updateClock();
          clockTimer = window.setInterval(updateClock, 1000);
        }
        // Preserve Desk.queue's cleanup and stop this page's clock when navigating away.
        return Promise.resolve(queueResult).then(cleanup => () => {
          if (clockTimer !== null) window.clearInterval(clockTimer);
          if (typeof cleanup === "function") cleanup();
        }, error => {
          if (clockTimer !== null) window.clearInterval(clockTimer);
          throw error;
        });
      }
    },
    appointments: {
      title: "Appointments", heading: "Appointment Management", eyebrow: "",
      description: "",
      render: (body,actions) => { managementBanner(body, "appointments"); return CashierAppointments.render(body,actions); }
    },
    payments: {
      title: "Payments",
      heading: "Payment Management",
      eyebrow: "",
      description: "",
      render: (body, actions) => { managementBanner(body, "payments"); return Desk.payments(body, actions, user); }
    },
    customers: {
      title: "Customers",
      heading: "Customer Management",
      eyebrow: "",
      description: "",
      render: (body, actions) => { managementBanner(body, "customers"); return Desk.customers(body, actions, user); }
    },
    notifications: {
      title: "Notifications", eyebrow: "APPOINTMENT UPDATES",
      description: "Stay updated with customer bookings and appointment changes.",
      render: async (body) => {
        body.innerHTML = `<div class="cashier-notification-page">
          <button type="button" class="cashier-notifications-back"><svg class="cashier-notification-back-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg><span>Back</span></button>
          <div class="cashier-notifications-hero"><div><span class="cashier-notification-head-icon" aria-hidden="true">${bellSymbol}</span><div><h2>Notifications</h2><p>Stay updated with your customer appointments and reminders.</p></div></div><label class="cashier-notification-search">${searchSymbol} <input id="cashierNotificationSearch" type="search" placeholder="Search notifications..." aria-label="Search notifications"></label></div>
          <div class="cashier-notifications-toolbar"><div class="cashier-notification-tabs"><button type="button" data-staff-filter="all" class="active">All</button><button type="button" data-staff-filter="unread">Unread <span id="cashierUnreadTabCount"></span></button><button type="button" data-staff-filter="read">Read</button></div><button type="button" id="cashierNotificationsMarkAll">✓ Mark all as read</button></div>
          <section class="cashier-notifications-list" id="cashierNotificationsList" aria-live="polite"></section><div id="cashierNotificationPager" class="cashier-notification-pager"></div>
        </div>`;
        body.querySelector(".cashier-notifications-back").addEventListener("click", () => navigator.open("desk"));
        body.querySelector("#cashierNotificationSearch").value = notificationState.search;
        body.querySelector("#cashierNotificationSearch").addEventListener("input", event => { notificationState.search = event.target.value; notificationState.page = 1; renderPage(body); });
        body.querySelector("#cashierNotificationsMarkAll").addEventListener("click", markAll);
        body.addEventListener("click", async event => {
          const filter = event.target.closest("[data-staff-filter]");
          if (filter) { notificationState.filter = filter.dataset.staffFilter; notificationState.page = 1; renderPage(body); return; }
          const page = event.target.closest("[data-staff-page]");
          if (page) { notificationState.page += page.dataset.staffPage === "next" ? 1 : -1; renderPage(body); return; }
          const read = event.target.closest("[data-staff-read]");
          if (read) { await markRead(read.dataset.staffRead); return; }
          const view = event.target.closest("[data-staff-view]");
          if (view) {
            const item = notificationState.items.find(n => n.id === view.dataset.staffView);
            if (!item) return;
            App.openDialog(`<h2>${App.escapeHTML(item.title)}</h2><p class="muted">${App.escapeHTML(new Date(item.createdAt).toLocaleString("en-PH"))}</p><p>${App.escapeHTML(item.message)}</p><div class="form-actions"><button type="button" class="secondary-btn" data-close>Close</button></div>`);
            if (!item.read) await markRead(item.id);
          }
        });
        await loadNotifications(true);
        renderPage(body);
      }
    },
    account: {
      title: "My Account",
      eyebrow: "SECURITY",
      description: "Change your password and manage signed-in devices.",
      render: (body, actions) => Desk.account(body, actions, user)
    }
  }, "desk");
})();
