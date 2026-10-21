// Admin page: analytics, front desk, payments, customers, barbers, services, inventory, staff, activity and account.
(async function () {
  const { api, escapeHTML, money, setMessage, openDialog, confirmDialog, toast, busy } = App;
  const { emptyRow, statCards } = Desk;

  const user = await App.requireStaff(["admin"]);
  if (!user) return;

  // ---------- Staff ----------

  async function staff(body, actions) {
    actions.innerHTML = `<button class="primary-btn" type="button" id="addStaff">+ Add staff</button>
      <span class="staff-actions-divider" aria-hidden="true"></span>
      <div class="staff-tabs" role="group" aria-label="Staff account lists">
        <button type="button" class="staff-tab active" data-staff-tab="active" aria-pressed="true">Active <span id="staffActiveCount">0</span></button>
        <button type="button" class="staff-tab" data-staff-tab="deactivated" aria-pressed="false">Deactivated <span id="staffInactiveCount">0</span></button>
      </div>`;
    body.innerHTML = `
      <section class="card staff-filter-card" aria-label="Filter staff accounts">
        <label class="staff-search-field"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input type="search" id="staffSearch" placeholder="Search staff name or email..." aria-label="Search staff"></label>
        <select id="staffRoleFilter" aria-label="Filter by staff role"><option value="all">All Roles</option><option value="admin">Admin</option><option value="cashier">Cashier</option></select>
        <select id="staffStatusFilter" aria-label="Filter by account status"><option value="all">All Status</option><option value="active">Active</option><option value="deactivated">Deactivated</option></select>
        <select id="staffSort" aria-label="Sort staff"><option value="name">Name A - Z</option><option value="name-desc">Name Z - A</option><option value="newest">Newest First</option></select>
        <button class="secondary-btn staff-clear" id="staffClear" type="button" hidden>Clear</button>
      </section>
      <article class="card staff-table-card">
        <div class="staff-table-heading"><div><h2 id="staffTableTitle">Active Staff</h2><p>Manage staff accounts, assigned roles and access.</p></div><span id="staffResultCount" aria-live="polite"></span></div>
        <div class="table-wrap"><table class="data-table staff-table"><thead><tr><th>No.</th><th>Staff</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody id="staffRows"></tbody></table></div>
        <div class="staff-pagination"><span id="staffSummary"></span><div><button type="button" class="secondary-btn small" id="staffPrevious">Previous</button><span id="staffPage"></span><button type="button" class="secondary-btn small" id="staffNext">Next</button></div></div>
      </article>
      <p class="muted small spaced">Cashiers run the front desk: queue, payments and customers. Admins can also manage barbers, services, inventory, staff, reports and the activity log. New staff must change their one-time password before they can do anything.</p>`;

    let list = [], currentTab = "active", page = 1;
    const pageSize = 10;
    const $ = id => body.querySelector("#" + id);
    const search = $("staffSearch"), roleFilter = $("staffRoleFilter"), statusFilter = $("staffStatusFilter"), sort = $("staffSort");
    const svgIcons = {
      view: '<circle cx="12" cy="12" r="3"/><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/>',
      role: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/><path d="m18 8 2 2 3-3"/>'
    };
    const icon = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svgIcons[name]}</svg>`;
    const buttonHTML = (action, s, label, symbol) => `<button type="button" class="staff-icon-btn" data-${action}="${escapeHTML(s.id)}" title="${label}" aria-label="${label} ${escapeHTML(s.name)}">${icon(symbol)}</button>`;

    function filtered() {
      const query = search.value.trim().toLocaleLowerCase();
      return list.filter(s => {
        if (s.active !== (currentTab === "active")) return false;
        if (roleFilter.value !== "all" && s.role !== roleFilter.value) return false;
        if (statusFilter.value !== "all" && (s.active ? "active" : "deactivated") !== statusFilter.value) return false;
        return !query || `${s.name} ${s.email}`.toLocaleLowerCase().includes(query);
      }).sort((a, b) => {
        if (sort.value === "newest") return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || String(a.name).localeCompare(String(b.name));
        const n = String(a.name).localeCompare(String(b.name));
        return sort.value === "name-desc" ? -n : n;
      });
    }

    function draw() {
      const active = list.filter(s => s.active).length;
      actions.querySelector("#staffActiveCount").textContent = active;
      actions.querySelector("#staffInactiveCount").textContent = list.length - active;
      actions.querySelectorAll("[data-staff-tab]").forEach(tab => {
        const selected = tab.dataset.staffTab === currentTab;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-pressed", String(selected));
      });
      $("staffClear").hidden = !(search.value || roleFilter.value !== "all" || statusFilter.value !== "all" || sort.value !== "name");
      $("staffTableTitle").textContent = currentTab === "active" ? "Active Staff" : "Deactivated Staff";
      const items = filtered();
      const pages = Math.max(1, Math.ceil(items.length / pageSize));
      page = Math.min(page, pages);
      const start = (page - 1) * pageSize;
      const visible = items.slice(start, start + pageSize);
      $("staffResultCount").textContent = `${items.length} staff`;
      $("staffRows").innerHTML = visible.length ? visible.map((s, i) => `
        <tr class="${s.active ? "" : "inactive"}">
          <td>${start + i + 1}</td>
          <td><div class="staff-person"><span class="staff-avatar" aria-hidden="true">${escapeHTML((s.name || "S").trim().charAt(0).toUpperCase())}</span><span><strong>${escapeHTML(s.name)}</strong>${s.isYou ? ' <span class="chip">You</span>' : ""}</span></div></td>
          <td class="staff-email">${escapeHTML(s.email)}</td>
          <td><span class="staff-role-tag">${s.role === "admin" ? "Admin" : "Cashier"}</span></td>
          <td>${s.active ? '<span class="status-pill completed">Active</span>' : '<span class="status-pill cancelled">Deactivated</span>'}</td>
          <td class="row-actions"><span class="staff-action-group">
            ${buttonHTML("staff-view", s, "View details for", "view")}
            ${s.isYou ? '<span class="muted small staff-self-note">My Account</span>' : `${buttonHTML("staff-role", s, "Change role for", "role")}<button type="button" class="${s.active ? "danger-btn" : "secondary-btn"} small" data-staff-toggle="${escapeHTML(s.id)}">${s.active ? "Deactivate" : "Activate"}</button>`}
          </span></td>
        </tr>`).join("") : emptyRow(6, "No matching staff accounts found.");
      $("staffSummary").textContent = `Showing ${items.length ? start + 1 : 0}–${Math.min(start + pageSize, items.length)} of ${items.length}`;
      $("staffPage").textContent = `Page ${page} of ${pages}`;
      $("staffPrevious").disabled = page <= 1;
      $("staffNext").disabled = page >= pages;
    }

    async function load() {
      list = await api("/api/staff");
      draw();
    }

    [search, roleFilter, statusFilter, sort].forEach(control => control.addEventListener(control === search ? "input" : "change", () => { page = 1; draw(); }));
    $("staffClear").addEventListener("click", () => { search.value = ""; roleFilter.value = "all"; statusFilter.value = "all"; sort.value = "name"; page = 1; draw(); });
    actions.querySelectorAll("[data-staff-tab]").forEach(tab => tab.addEventListener("click", () => {
      currentTab = tab.dataset.staffTab;
      statusFilter.value = "all";
      page = 1;
      draw();
    }));
    $("staffPrevious").addEventListener("click", () => { if (page > 1) { page--; draw(); } });
    $("staffNext").addEventListener("click", () => { if (page * pageSize < filtered().length) { page++; draw(); } });

    actions.querySelector("#addStaff").addEventListener("click", () => {
      const { element, close } = openDialog(`
        <form>
          <h2>Add staff</h2>
          <label for="stName">Name *</label><input id="stName" name="name" maxlength="60" required>
          <label for="stEmail">Email *</label><input id="stEmail" name="email" type="email" required>
          <label for="stRole">Role</label>
          <select id="stRole" name="role"><option value="cashier">Cashier</option><option value="admin">Admin</option></select>
          <div class="form-actions"><button class="primary-btn" type="submit">Create account</button><button class="secondary-btn" type="button" data-close>Cancel</button></div>
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
          } catch (error) { setMessage(element.querySelector("#stMessage"), error.message, "error"); }
        });
      });
    });

    function showDetails(member) {
      openDialog(`<div class="staff-detail-dialog"><h2>Staff Details</h2><div class="staff-detail-top"><span class="staff-avatar staff-avatar-large" aria-hidden="true">${escapeHTML((member.name || "S").trim().charAt(0).toUpperCase())}</span><div><h3>${escapeHTML(member.name)}</h3><p class="muted">${escapeHTML(member.email)}</p></div></div><dl>
        <div><dt>Role</dt><dd>${member.role === "admin" ? "Admin" : "Cashier"}</dd></div>
        <div><dt>Status</dt><dd>${member.active ? "Active" : "Deactivated"}</dd></div>
        <div><dt>Account created</dt><dd>${member.createdAt ? new Date(member.createdAt).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—"}</dd></div>
      </dl><div class="form-actions"><button type="button" class="secondary-btn" data-close>Close</button></div></div>`);
    }

    async function changeMember(member, action) {
      try {
        if (action === "role") {
          const role = member.role === "admin" ? "cashier" : "admin";
          if (!await confirmDialog(`Make ${member.name} ${role === "admin" ? "an admin" : "a cashier"}? They will be signed out and must sign in again.`, { title: "Change role", confirmText: role === "admin" ? "Make admin" : "Make cashier" })) return;
          await api(`/api/staff/${member.id}`, { method: "PATCH", body: { role } });
          toast(`${member.name} is now ${role === "admin" ? "an admin" : "a cashier"}.`);
        } else {
          const turnOff = member.active;
          if (!await confirmDialog(`${turnOff ? "Deactivate" : "Activate"} ${member.name}?${turnOff ? " They will be signed out immediately and can't sign in." : ""}`, { title: turnOff ? "Deactivate staff" : "Activate staff", confirmText: turnOff ? "Deactivate" : "Activate", danger: turnOff })) return;
          await api(`/api/staff/${member.id}`, { method: "PATCH", body: { active: !member.active } });
          toast(`${member.name} ${turnOff ? "deactivated" : "activated"}.`);
        }
        await load();
      } catch (error) { toast(error.message, "error"); }
    }

    body.addEventListener("click", event => {
      const button = event.target.closest("button[data-staff-view],button[data-staff-role],button[data-staff-toggle]");
      if (!button) return;
      const id = button.dataset.staffView || button.dataset.staffRole || button.dataset.staffToggle;
      const member = list.find(s => s.id === id);
      if (!member) return;
      if (button.dataset.staffView) showDetails(member);
      else if (member.isYou) return;
      else if (button.dataset.staffRole) changeMember(member, "role");
      else changeMember(member, "toggle");
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
