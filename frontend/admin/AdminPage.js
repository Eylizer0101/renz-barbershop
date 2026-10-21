// Admin page: analytics, front desk, payments, customers, barbers, services, inventory, staff, activity and account.
(async function () {
  const { api, escapeHTML, money, setMessage, openDialog, confirmDialog, toast, busy } = App;
  const { emptyRow, statCards } = Desk;

  const user = await App.requireStaff(["admin"]);
  if (!user) return;

  // ---------- Staff ----------

  async function staff(body, actions) {
    actions.innerHTML = '<button class="primary-btn" type="button" id="addStaff">+ Add staff</button>';
    body.innerHTML = `
      <article class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody id="staffRows"></tbody>
          </table>
        </div>
      </article>
      <p class="muted small spaced">Cashiers run the front desk: queue, payments and customers. Admins can also manage barbers, services, inventory, staff, reports and the activity log. New staff must change their one-time password before they can do anything.</p>`;

    let list = [];

    async function load() {
      list = await api("/api/staff");
      body.querySelector("#staffRows").innerHTML = list.map(s => `
        <tr class="${s.active ? "" : "inactive"}">
          <td><strong>${escapeHTML(s.name)}</strong>${s.isYou ? ' <span class="chip">You</span>' : ""}</td>
          <td>${escapeHTML(s.email)}</td>
          <td>${s.role === "admin" ? "Admin" : "Cashier"}</td>
          <td>${s.active ? '<span class="status-pill completed">Active</span>' : '<span class="status-pill cancelled">Deactivated</span>'}</td>
          <td class="row-actions">${s.isYou ? '<span class="muted small">Change your own password under My Account</span>' : `
            <button class="secondary-btn small" type="button" data-role="${s.id}">${s.role === "admin" ? "Make cashier" : "Make admin"}</button>
            <button class="secondary-btn small" type="button" data-reset="${s.id}">Reset password</button>
            <button class="${s.active ? "danger-btn" : "secondary-btn"} small" type="button" data-toggle="${s.id}">${s.active ? "Deactivate" : "Activate"}</button>`}
          </td>
        </tr>`).join("");
    }

    actions.querySelector("#addStaff").addEventListener("click", () => {
      const { element, close } = openDialog(`
        <form>
          <h2>Add staff</h2>
          <label for="stName">Name *</label><input id="stName" name="name" maxlength="60" required>
          <label for="stEmail">Email *</label><input id="stEmail" name="email" type="email" required>
          <label for="stRole">Role</label>
          <select id="stRole" name="role"><option value="cashier">Cashier</option><option value="admin">Admin</option></select>
          <div class="form-actions">
            <button class="primary-btn" type="submit">Create account</button>
            <button class="secondary-btn" type="button" data-close>Cancel</button>
          </div>
          <p class="message" id="stMessage"></p>
        </form>`);

      element.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const f = event.target;
        await busy(event.submitter, async () => {
          try {
            const result = await api("/api/staff", { method: "POST", body: { name: f.elements.namedItem("name").value, email: f.elements.namedItem("email").value, role: f.elements.namedItem("role").value } });
            close();
            App.showTemporaryPassword("Staff account created", result.name, result.temporaryPassword);
            await load();
          } catch (error) {
            setMessage(element.querySelector("#stMessage"), error.message, "error");
          }
        });
      });
    });

    body.addEventListener("click", async event => {
      const button = event.target.closest("button");
      const member = button && list.find(s => s.id === (button.dataset.role || button.dataset.reset || button.dataset.toggle));
      if (!member) return;

      try {
        if (button.dataset.role) {
          const role = member.role === "admin" ? "cashier" : "admin";
          if (!await confirmDialog(`Make ${member.name} ${role === "admin" ? "an admin" : "a cashier"}? They will be signed out and must sign in again.`, { title: "Change role", confirmText: role === "admin" ? "Make admin" : "Make cashier" })) return;
          await api(`/api/staff/${member.id}`, { method: "PATCH", body: { role } });
          toast(`${member.name} is now ${role === "admin" ? "an admin" : "a cashier"}.`);
        } else if (button.dataset.reset) {
          if (!await confirmDialog(`Reset the password for ${member.name}? They will be signed out everywhere and get a one-time password.`, { title: "Reset password", confirmText: "Reset password" })) return;
          const result = await api(`/api/staff/${member.id}/reset-password`, { method: "POST" });
          App.showTemporaryPassword("Password reset", member.name, result.temporaryPassword);
        } else {
          const turnOff = member.active;
          if (!await confirmDialog(`${turnOff ? "Deactivate" : "Activate"} ${member.name}?${turnOff ? " They will be signed out immediately and can't sign in." : ""}`, { title: turnOff ? "Deactivate staff" : "Activate staff", confirmText: turnOff ? "Deactivate" : "Activate", danger: turnOff })) return;
          await api(`/api/staff/${member.id}`, { method: "PATCH", body: { active: !member.active } });
          toast(`${member.name} ${turnOff ? "deactivated" : "activated"}.`);
        }
        await load();
      } catch (error) {
        toast(error.message, "error");
      }
    });

    await load();
  }

  // ---------- Activity log ----------

  const ACTION_LABELS = {
    "login": "Signed in",
    "login.failed": "Failed sign-in",
    "login.code-failed": "Wrong email code",
    "password.changed": "Changed password",
    "sessions.ended": "Signed out other devices",
    "payment.discount": "Gave a discount",
    "payment.voided": "Voided a payment",
    "queue.no-show": "Marked a no-show",
    "queue.cancelled": "Cancelled a customer",
    "queue.cleared": "Cleared the queue",
    "customer.created": "Created a customer account",
    "customer.password-reset": "Reset a customer password",
    "customer.activated": "Activated a customer",
    "customer.deactivated": "Deactivated a customer",
    "staff.created": "Added staff",
    "staff.updated": "Changed staff account",
    "staff.password-reset": "Reset a staff password",
    "barber.removed": "Removed a barber",
    "barber.restored": "Restored a barber",
    "review.deleted": "Deleted a review",
    "service.created": "Added a service",
    "service.updated": "Changed a service",
    "service.hidden": "Hid a service",
    "inventory.created": "Added a product",
    "inventory.updated": "Changed a product",
    "inventory.deleted": "Deleted a product",
    "inventory.stock-in": "Added inventory stock",
    "inventory.stock-out": "Used inventory stock",
    "inventory.archived": "Archived a product",
    "inventory.restored": "Restored a product"
  };

  function detailsText(details) {
    return Object.entries(details || {})
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
      .join(" · ");
  }

  async function activity(body, actions) {
    actions.innerHTML = `
      <select class="select-input" id="activityFilter" aria-label="Filter activity">
        <option value="">All activity</option>
        <option value="login">Sign-ins (incl. failed)</option>
        <option value="payment">Discounts and voids</option>
        <option value="queue">No-shows and cancellations</option>
        <option value="staff">Staff accounts</option>
        <option value="customer">Customer accounts</option>
        <option value="inventory">Inventory</option>
        <option value="service">Services and prices</option>
      </select>
      <button class="secondary-btn" type="button" id="refreshActivity">Refresh</button>`;

    body.innerHTML = `
      <article class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody id="activityRows"></tbody>
          </table>
        </div>
      </article>
      <p class="muted small spaced">Shows the latest 300 entries. Failed sign-ins are highlighted; 5 in a row lock the account for 15 minutes.</p>`;

    const filter = actions.querySelector("#activityFilter");

    async function load() {
      const entries = await api(`/api/audit?action=${encodeURIComponent(filter.value)}`);
      body.querySelector("#activityRows").innerHTML = entries.length ? entries.map(e => `
        <tr class="${/failed/.test(e.action) ? "alert-row" : ""}">
          <td>${App.dateTime(e.at)}</td>
          <td>${escapeHTML(e.actorName || "—")}${e.actorRole ? ` <span class="muted small">${escapeHTML(e.actorRole)}</span>` : ""}</td>
          <td>${escapeHTML(ACTION_LABELS[e.action] || e.action)}</td>
          <td class="muted small details-cell">${escapeHTML(detailsText(e.details))}${e.ip ? ` · IP ${escapeHTML(e.ip)}` : ""}</td>
        </tr>`).join("") : emptyRow(4, "No activity yet.");
    }

    const reload = () => load().catch(error => toast(error.message, "error"));
    filter.addEventListener("change", reload);
    actions.querySelector("#refreshActivity").addEventListener("click", event => busy(event.target, reload));
    await load();
  }

  // Match the Cashier management banners while preserving the existing heading-actions node.
  // Only the presentation of these Admin page headers changes; page handlers stay untouched.
  function adminManagementBanner(body, kind) {
    const heading = body.parentElement?.querySelector(".section-heading");
    if (!heading) return;
    const content = {
      payments: ["SALES OVERVIEW", "Payment Management", "Sales for any date range, by payment method. Download as CSV for Excel.", "wallet"],
      customers: ["CUSTOMER OVERVIEW", "Customer Management", "Optional customer accounts and walk-in visits.", "users"],
      barbers: ["TEAM OVERVIEW", "Barber Management", "Add, edit or remove barbers, set who is on duty, and moderate reviews.", "scissors"],
      services: ["SERVICE OVERVIEW", "Service Management", "What customers can choose, with prices and durations.", "services"],
      inventory: ["INVENTORY OVERVIEW", "Inventory Management", "Monitor supplies, products, and stock levels.", "inventory"],
      staff: ["STAFF OVERVIEW", "Staff Management", "Cashier and admin accounts.", "staff"],
      activity: ["SECURITY OVERVIEW", "Activity Log", "Who did what: sign-ins, failed sign-ins, discounts, voids, no-shows and account changes.", "activity"]
    }[kind];
    if (!content) return;
    const [eyebrow, title, description] = content;
    const adminArtwork = {
      customers: "Customers.png",
      barbers: "Barbers.png",
      services: "Services.png",
      inventory: "Inventory.png",
      staff: "StaffIcon.png",
      activity: "ActivityLog.png"
    };
    const artwork = kind === "payments"
      ? '<img src="/images/CashierDashboard/PesoBadge.png" alt="" loading="eager" decoding="async">'
      : `<img src="/images/AdminDashboard/${adminArtwork[kind]}" alt="" loading="eager" decoding="async">`;
    const actions = heading.querySelector(".heading-actions");
    const banner = document.createElement("section");
    banner.className = "cashier-management-banner admin-management-banner";
    banner.setAttribute("aria-label", title);
    banner.innerHTML = `<div class="cashier-management-banner-copy"><span class="cashier-management-banner-eyebrow"><span class="cashier-management-banner-dot" aria-hidden="true"></span>${eyebrow}</span><h1>${title}</h1><p>${description}</p></div><div class="cashier-management-banner-art" aria-hidden="true">${artwork}</div>`;
    if (actions) banner.querySelector(".cashier-management-banner-copy").appendChild(actions);
    heading.classList.add("cashier-management-heading");
    heading.replaceChildren(banner);
  }

  function withAdminBanner(kind, render) {
    return (body, actions) => {
      adminManagementBanner(body, kind);
      return render(body, actions);
    };
  }

  const router = App.mountPages({
    analytics: { title: "Analytics", eyebrow: "SHOP PERFORMANCE", description: "Live numbers from the queue and payments.", render: window.AdminAnalytics.render },
    desk: { title: "Front Desk", eyebrow: "TODAY'S QUEUE", description: "Add walk-ins, call customers to free barbers, and take payment.", render: async (body, actions) => {
      const cleanup = await Desk.queue(body, actions, user);
      const hero = body.querySelector("#deskHero");
      let clockTimer = null;
      if (hero) {
        const welcome = document.createElement("aside");
        welcome.className = "cashier-welcome-card";
        welcome.setAttribute("aria-label", "Current Philippine date and time");
        welcome.innerHTML = `<img class="cashier-welcome-art" src="/images/CashierDashboard/Sun.png" alt="" aria-hidden="true" decoding="async"><div class="cashier-welcome-copy"><span class="cashier-welcome-kicker">Welcome! Today Is</span><strong class="cashier-welcome-day"></strong><span class="cashier-welcome-date"></span><time class="cashier-welcome-time"></time></div>`;
        hero.appendChild(welcome);
        const day = welcome.querySelector(".cashier-welcome-day");
        const date = welcome.querySelector(".cashier-welcome-date");
        const time = welcome.querySelector(".cashier-welcome-time");
        const artwork = welcome.querySelector(".cashier-welcome-art");
        const zone = "Asia/Manila";
        const dayFormat = new Intl.DateTimeFormat("en-PH", { timeZone: zone, weekday: "long" });
        const dateFormat = new Intl.DateTimeFormat("en-PH", { timeZone: zone, month: "long", day: "numeric", year: "numeric" });
        const timeFormat = new Intl.DateTimeFormat("en-PH", { timeZone: zone, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
        const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" });
        let shownIcon = "";
        function tick() {
          if (!welcome.isConnected) return;
          const now = new Date();
          const hour = Number(hourFormat.format(now));
          const icon = hour >= 6 && hour < 18 ? "Sun" : "Moon";
          if (shownIcon !== icon) { artwork.src = `/images/CashierDashboard/${icon}.png`; shownIcon = icon; }
          day.textContent = dayFormat.format(now).toUpperCase();
          date.textContent = dateFormat.format(now);
          time.textContent = timeFormat.format(now);
          time.dateTime = now.toISOString();
        }
        tick();
        clockTimer = window.setInterval(tick, 1000);
      }
      return () => { if (clockTimer !== null) window.clearInterval(clockTimer); if (typeof cleanup === "function") cleanup(); };
    } },
    payments: { title: "Payments & Reports", eyebrow: "FINANCE", description: "Sales for any date range, by payment method. Download as CSV for Excel.", render: withAdminBanner("payments", (body, actions) => Desk.payments(body, actions, user)) },
    customers: { title: "Customers", eyebrow: "CUSTOMER RECORDS", description: "Optional customer accounts and walk-in visits.", render: withAdminBanner("customers", (body, actions) => Desk.customers(body, actions, user)) },
    barbers: { title: "Barbers", eyebrow: "MEET THE TEAM", description: "Add, edit or remove barbers, set who is on duty, and moderate reviews.", render: withAdminBanner("barbers", window.AdminManageBarbers.render) },
    services: { title: "Services", eyebrow: "SERVICES AND PRICES", description: "What customers can choose, with prices and durations.", render: withAdminBanner("services", window.AdminManageServices.render) },
    inventory: { title: "Inventory", eyebrow: "STOCK", description: "Products for sale. Items at or below their warning level are flagged.", render: withAdminBanner("inventory", window.AdminManageInventory.render) },
    staff: { title: "Staff", eyebrow: "ACCOUNTS", description: "Cashier and admin accounts.", render: withAdminBanner("staff", staff) },
    activity: { title: "Activity Log", eyebrow: "SECURITY", description: "Who did what: sign-ins, failed sign-ins, discounts, voids, no-shows and account changes.", render: withAdminBanner("activity", activity) },
    account: { title: "My Account", eyebrow: "SECURITY", description: "Change your password and manage signed-in devices.", render: (body, actions) => Desk.account(body, actions, user) }
  }, "analytics");

  // Admin sidebar sign-out: mirror the customer confirmation design without changing shared logout behavior.
  document.getElementById("adminSidebarLogout")?.addEventListener("click", async () => {
    const confirmed = await new Promise(resolve => {
      let answered = false;
      const { element, close } = openDialog(`
        <div class="customer-logout-confirmation">
          <span class="customer-logout-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/></svg></span>
          <h2>Sign out?</h2>
          <p>Are you sure you want to sign out of your account? You can sign in again anytime.</p>
          <div class="customer-logout-actions">
            <button type="button" class="customer-logout-cancel" data-close>Cancel</button>
            <button type="button" class="customer-logout-confirm" data-admin-signout>Sign out</button>
          </div>
        </div>`, { onClose: () => { if (!answered) resolve(false); } });
      element.querySelector('[data-close]').focus();
      element.querySelector('[data-admin-signout]').addEventListener('click', () => {
        answered = true;
        close();
        resolve(true);
      });
    });
    if (confirmed) await App.logout();
  });

  // Shortcuts such as "View all" on the analytics page.
  document.getElementById("pageContent").addEventListener("click", event => {
    const target = event.target.closest("[data-goto]");
    if (target) router.open(target.dataset.goto);
  });
})();
