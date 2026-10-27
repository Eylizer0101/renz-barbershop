// Customer dashboard: join the queue, follow your turn, meet the barbers, rate a visit, see past visits.
(async function () {
  const { api, escapeHTML, money, setMessage, statusPill, toast, busy, confirmDialog } = App;
  const $ = id => document.getElementById(id);

  const state = {
    ticket: null,
    services: [],
    barbers: [],
    alerted: false,
    notify: false
  };

  // Who is this? A customer with an account, a guest who typed their name, or a guest coming back
  // to a ticket they already have on this device.
  let account = null;
  try {
    const { user } = await api("/api/auth/me");
    if (user.role !== "customer") {
      window.location.replace(App.HOME_PAGES[user.role] || "/login.html");
      return;
    }
    account = user;
    App.state.signedIn = true;
  } catch {
    // Not signed in: continue as a guest.
  }

  let name = account ? account.name : (sessionStorage.getItem("customerName") || "").trim();

  if (!account) {
    try {
      const { ticket } = await api("/api/queue/mine");
      state.ticket = ticket;
      if (!name) {
        name = ticket.customerName;
        sessionStorage.setItem("customerName", name);
      }
    } catch {
      // No ticket on this device yet.
    }
  }

  if (!name) {
    window.location.replace("/login.html");
    return;
  }

  $("welcomeTitle").textContent = `Hi, ${name}!`;
  $("customerGreeting").textContent = account ? `Hi, ${name}` : `Hi, ${name} (walk-in)`;

  // Keep the topbar avatar in sync with the customer's saved profile photo.
  const customerHeaderAvatar = document.querySelector("#customerProfileTrigger .customer-avatar");
  const defaultCustomerAvatar = customerHeaderAvatar?.getAttribute("src") || "/images/profile.jpg";
  function updateCustomerHeaderAvatar(photoUrl) {
    if (!customerHeaderAvatar) return;
    customerHeaderAvatar.src = typeof photoUrl === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photoUrl)
      ? photoUrl : defaultCustomerAvatar;
  }
  if (customerHeaderAvatar) {
    customerHeaderAvatar.addEventListener("error", () => {
      if (customerHeaderAvatar.getAttribute("src") !== defaultCustomerAvatar) {
        customerHeaderAvatar.src = defaultCustomerAvatar;
      }
    });
  }
  if (account) {
    api("/api/auth/customer-profile")
      .then(({ user }) => {
        if (user) {
          account = { ...account, ...user };
          updateCustomerHeaderAvatar(account.photoUrl);
        }
      })
      .catch(() => { /* The default avatar remains visible if the profile cannot be loaded. */ });
  }

  $("passwordBanner").classList.toggle("hidden", !account?.mustChangePassword);

  // ---------- Pages ----------

  const titles = {
    dashboard: "Customer Dashboard",
    queue: "My Queue",
    booking: "Book Appointment",
    appointments: "My Appointments",
    barbers: "Our Barbers",
    gallery: "Haircut Gallery",
    visits: "My Visits",
    account: "My Account",
    notifications: "Notifications"
  };

  // Keep customer navigation in the URL so refreshing or using Back/Forward
  // restores the page instead of always returning to the dashboard.
  function pageFromHash() {
    const page = window.location.hash.slice(1);
    return Object.prototype.hasOwnProperty.call(titles, page) ? page : "dashboard";
  }

  function openPage(page, updateHistory = true) {
    if (!Object.prototype.hasOwnProperty.call(titles, page)) return;
    if (updateHistory && window.location.hash !== `#${page}`) {
      window.history.pushState(null, "", `#${page}`);
    }

    document.querySelectorAll(".page-section").forEach(section => {
      section.hidden = section.id !== page + "Page";
    });
    document.querySelectorAll(".nav-link[data-page]").forEach(button => {
      const active = button.dataset.page === page;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $("pageTitle").textContent = titles[page];
    if (!state.alerted) document.title = `${titles[page]} | Renz Barbershop`;
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (page === "dashboard" || page === "queue") loadQueue();
    if (page === "barbers") loadBarbers();
    if (page === "gallery") renderCustomerGallery();
    if (page === "booking") window.CustomerBooking?.render();
    if (page === "appointments") window.CustomerBookingHistory?.refresh();
    if (page === "visits") loadVisits();
    if (page === "account") {
      // Keep old #account bookmarks working without opening an empty page.
      openPage("dashboard", false);
      if (account) openCustomerProfile();
    }
    if (page === "notifications") refreshNotifications(true);
  }

  window.addEventListener("hashchange", () => openPage(pageFromHash(), false));

  document.querySelectorAll(".nav-link[data-page]").forEach(button => {
    button.addEventListener("click", () => openPage(button.dataset.page));
  });

  $("changePasswordLink").addEventListener("click", () => { if (account) openCustomerProfile("password"); else toast("Sign in to manage your account.", "info"); });

  // Customer-only My Account modal; never invokes staff account UI.
  let profileDialog = null;
  async function openCustomerProfile(section = "profile") {
    if (!account || profileDialog) return;
    const origin = document.activeElement;
    const shade = document.createElement("div");
    shade.className = "customer-account-overlay";
    shade.innerHTML = `<section class="customer-account-modal" role="dialog" aria-modal="true" aria-labelledby="customerAccountTitle">
      <header class="customer-account-head"><div><span>MY ACCOUNT</span><h2 id="customerAccountTitle">My Profile</h2><p>Manage your personal details and password.</p></div><button type="button" class="customer-account-x" data-account-close aria-label="Close profile">&times;</button></header>
      <div class="customer-account-scroll"><div class="customer-account-profile"><div class="customer-account-photo" id="customerAccountPhoto"></div><div class="customer-account-profile-info"><strong id="customerAccountName"></strong><small id="customerAccountEmail"></small><label class="customer-account-photo-upload">Change photo <input type="file" id="customerAccountPhotoInput" accept="image/jpeg,image/png,image/webp"></label><small>JPG, PNG or WebP, up to 2 MB</small></div></div>
      <nav class="customer-account-tabs" aria-label="Account settings"><button type="button" data-account-tab="profile" class="active">Personal Information</button><button type="button" data-account-tab="password">Change Password</button></nav>
      <section data-account-pane="profile"><form id="customerAccountPersonalForm"><div class="customer-account-fields"><label>Full name<input name="name" autocomplete="name" minlength="2" maxlength="60" required></label><label>Phone number<input name="phone" type="tel" maxlength="20" autocomplete="tel" placeholder="Optional"></label><label class="customer-account-wide">Email address <input name="email" type="email" readonly aria-readonly="true"><small>Email cannot be changed here.</small></label></div><div class="customer-account-actions"><button type="button" class="secondary-btn" data-account-close>Cancel</button><button type="submit" class="primary-btn">Save changes</button></div></form></section>
      <section data-account-pane="password" hidden><form id="customerAccountPasswordForm"><div class="customer-account-fields"><label class="customer-account-wide">Current password<input type="password" name="currentPassword" autocomplete="current-password" required></label><label>New password<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required></label><label>Confirm new password<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required></label></div><label class="customer-account-show"><input type="checkbox" id="customerAccountShowPassword"> Show passwords</label><p class="customer-account-help">Use at least 8 characters, including letters and numbers. Changing your password signs out other devices.</p><div class="customer-account-actions"><button type="submit" class="primary-btn">Change password</button></div></form></section>
      <p id="customerAccountMessage" class="message" role="status" aria-live="polite"></p></div></section>`;
    document.body.appendChild(shade);
    document.body.classList.add("customer-account-open");
    profileDialog = shade;
    let currentPhoto = "";
    const $$ = selector => shade.querySelector(selector);
    const message = (text, type = "") => { const el = $$("#customerAccountMessage"); el.textContent = text; el.className = "message" + (type ? " " + type : ""); };
    function close() { if (profileDialog !== shade) return; shade.remove(); profileDialog = null; document.body.classList.remove("customer-account-open"); document.removeEventListener("keydown", onKey); if (origin?.isConnected) origin.focus(); }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } if (e.key !== "Tab") return; const els = [...shade.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter(el => el.getClientRects().length); if (!els.length) return; const first = els[0], last = els[els.length - 1]; if (e.shiftKey && document.activeElement === first) {e.preventDefault();last.focus();} else if (!e.shiftKey && document.activeElement === last) {e.preventDefault();first.focus();} }
    document.addEventListener("keydown", onKey);
    shade.addEventListener("click", e => { if (e.target === shade || e.target.closest("[data-account-close]")) close(); });
    function tab(which) { shade.querySelectorAll("[data-account-tab]").forEach(btn => { const active = btn.dataset.accountTab === which; btn.classList.toggle("active",active); btn.setAttribute("aria-selected",String(active)); }); shade.querySelectorAll("[data-account-pane]").forEach(pane => pane.hidden = pane.dataset.accountPane !== which); message(""); }
    shade.querySelectorAll("[data-account-tab]").forEach(btn => btn.addEventListener("click", () => tab(btn.dataset.accountTab)));
    function renderPhoto() { const photo = $$("#customerAccountPhoto"); photo.replaceChildren(); if (currentPhoto && /^data:image\/(?:jpeg|png|webp);base64,/.test(currentPhoto)) { const img = document.createElement("img"); img.src = currentPhoto; img.alt = "Profile photo"; photo.appendChild(img); } else { photo.textContent = (account.name || "C").slice(0,1).toUpperCase(); } }
    async function refreshProfile() { const result = await api("/api/auth/customer-profile"); account = { ...account, ...result.user }; currentPhoto = result.user.photoUrl || ""; updateCustomerHeaderAvatar(currentPhoto); $$("#customerAccountName").textContent = account.name; $$("#customerAccountEmail").textContent = account.email; const form = $$("#customerAccountPersonalForm"); form.elements.name.value = account.name || ""; form.elements.phone.value = account.phone || ""; form.elements.email.value = account.email || ""; renderPhoto(); }
    try { await refreshProfile(); } catch(e) { message(e.message || "Unable to load your profile.","error"); }
    if (profileDialog !== shade) return;
    $$("#customerAccountPhotoInput").addEventListener("change", async e => { const file = e.target.files?.[0]; if (!file) return; if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 2*1024*1024) { message("Choose a JPG, PNG or WebP photo up to 2 MB.","error"); e.target.value=""; return; } try { const bitmap = await createImageBitmap(file); const scale = Math.min(1, 700 / Math.max(bitmap.width,bitmap.height)); const canvas = document.createElement("canvas"); canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale)); canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close(); const data = canvas.toDataURL("image/jpeg",.78); if (data.length > 750000) throw new Error("This image is too large after processing. Please choose a smaller photo."); await api("/api/auth/customer-profile", { method:"PATCH", body:{ photoUrl:data } }); await refreshProfile(); message("Profile photo updated.","success"); } catch(err) { message(err.message || "Could not upload photo.","error"); } finally { e.target.value=""; } });
    $$("#customerAccountPersonalForm").addEventListener("submit", async e => { e.preventDefault(); const form = e.currentTarget, button = form.querySelector('[type="submit"]'); await busy(button,async()=>{ try { await api("/api/auth/customer-profile",{method:"PATCH",body:{name:form.elements.name.value,phone:form.elements.phone.value}}); await refreshProfile(); name = account.name; $("welcomeTitle").textContent = `Hi, ${name}!`; $("customerGreeting").textContent = `Hi, ${name}`; message("Personal information saved.","success"); toast("Profile updated."); } catch(err) {message(err.message,"error");} }); });
    $$("#customerAccountShowPassword").addEventListener("change", e => { $$("#customerAccountPasswordForm").querySelectorAll('input[type="password"],input[data-password-visible]').forEach(input => { input.type = e.target.checked ? "text" : "password"; input.dataset.passwordVisible = e.target.checked ? "true" : ""; }); });
    $$("#customerAccountPasswordForm").addEventListener("submit", async e => { e.preventDefault(); const form=e.currentTarget, button=form.querySelector('[type="submit"]'); if (form.elements.newPassword.value !== form.elements.confirmPassword.value) {message("New passwords do not match.","error");return;} await busy(button,async()=>{try {await api("/api/auth/change-password",{method:"POST",body:{currentPassword:form.elements.currentPassword.value,newPassword:form.elements.newPassword.value}});form.reset();form.querySelectorAll('[data-password-visible]').forEach(input=>{input.type="password";delete input.dataset.passwordVisible;});$("passwordBanner").classList.add("hidden");message("Password changed. Other devices have been signed out.","success");}catch(err){message(err.message,"error");}}); });
    tab(section);
    $$("[data-account-close]").focus();
  }

  const profileTrigger = $("customerProfileTrigger");
  const profileMenu = $("customerProfileMenu");
  function closeProfileMenu() { profileMenu.classList.add("hidden"); profileTrigger.setAttribute("aria-expanded", "false"); }
  profileTrigger.addEventListener("click", event => { event.stopPropagation(); const opening = profileMenu.classList.contains("hidden"); profileMenu.classList.toggle("hidden", !opening); profileTrigger.setAttribute("aria-expanded", String(opening)); });
  document.addEventListener("click", event => { if (!event.target.closest(".customer-profile-wrap")) closeProfileMenu(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeProfileMenu(); });
  $("customerAccountMenu").addEventListener("click", () => { closeProfileMenu(); if (account) openCustomerProfile(); else toast("Sign in to manage your account.", "info"); });
  // Both logout entry points use the same confirmation dialog and logout API.
  async function confirmCustomerLogout() {
    closeProfileMenu();
    const ticket = state.ticket;
    const activeTicket = !account && ticket && ["waiting", "serving"].includes(ticket.status);
    const message = activeTicket
      ? `You're still in the queue as #${ticket.queueNumber}. If you sign out, this device won't show your ticket anymore. Please remember your queue number.`
      : "Are you sure you want to sign out of your account? You can sign in again anytime.";

    const confirmed = await new Promise(resolve => {
      let answered = false;
      const { element, close } = App.openDialog(`
        <div class="customer-logout-confirmation">
          <span class="customer-logout-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/></svg></span>
          <h2>Sign out?</h2>
          <p>${escapeHTML(message)}</p>
          <div class="customer-logout-actions">
            <button type="button" class="customer-logout-cancel" data-close>Cancel</button>
            <button type="button" class="customer-logout-confirm" data-customer-signout>Sign out</button>
          </div>
        </div>`, { onClose: () => { if (!answered) resolve(false); } });
      const signOut = element.querySelector('[data-customer-signout]');
      element.querySelector('[data-close]').focus();
      signOut.addEventListener('click', () => {
        answered = true;
        close();
        resolve(true);
      });
    });
    if (confirmed) await App.logout();
  }

  $("customerLogoutMenu").addEventListener("click", confirmCustomerLogout);
  $("customerSidebarLogout")?.addEventListener("click", confirmCustomerLogout);
  // Banner actions use the existing queue and booking pages.
  $("customerHeroQueueBtn").addEventListener("click", () => {
    const active = state.ticket && ["waiting", "serving"].includes(state.ticket.status);
    openPage("queue");
    const target = active ? $("queuePage").querySelector(".queue-overview") : $("joinPanel");
    if (target) window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  });
  $("customerHeroBookingBtn").addEventListener("click", () => openPage("booking"));

  document.querySelectorAll("[data-quick-page]").forEach(button => button.addEventListener("click", () => openPage(button.dataset.quickPage)));
  $("viewAllServices").addEventListener("click", () => openPage("gallery"));
  const shopHoursDialog = $("customerShopHoursDialog");
  $("customerShopHoursCard").addEventListener("click", () => shopHoursDialog.showModal());
  $("customerShopHoursClose").addEventListener("click", () => shopHoursDialog.close());
  shopHoursDialog.addEventListener("click", event => { if (event.target === shopHoursDialog) shopHoursDialog.close(); });
  // Filters are local to the Haircut Gallery; booking and queue selectors remain unchanged.
  const galleryFilters = { search: "", price: "all", duration: "all", sort: "default" };
  function renderCustomerGallery() {
    const target = $("customerGalleryContent");
    if (!target) return;
    if (!target.querySelector(".customer-gallery-filters")) {
      target.innerHTML = `<div class="customer-gallery-filters" role="search" aria-label="Filter haircuts">
        <label class="customer-gallery-search"><span class="sr-only">Search haircut</span><svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" data-gallery-filter="search" placeholder="Search haircut..." autocomplete="off" aria-label="Search haircut"></label>
        <label class="customer-gallery-field"><span class="sr-only">Price range</span><select data-gallery-filter="price" aria-label="Price range"><option value="all">All Prices</option><option value="under100">Below ₱100</option><option value="100to200">₱100–₱200</option><option value="over200">Above ₱200</option></select></label>
        <label class="customer-gallery-field"><span class="sr-only">Duration</span><select data-gallery-filter="duration" aria-label="Duration"><option value="all">All Durations</option><option value="upto30">30 Minutes or Less</option><option value="31to45">31–45 Minutes</option><option value="over45">Above 45 Minutes</option></select></label>
        <label class="customer-gallery-field"><span class="sr-only">Sort by</span><select data-gallery-filter="sort" aria-label="Sort by"><option value="default">Sort By</option><option value="name">Name A–Z</option><option value="priceAsc">Price: Low to High</option><option value="priceDesc">Price: High to Low</option><option value="duration">Shortest Duration</option></select></label>
        <button type="button" class="customer-gallery-clear hidden" data-gallery-clear>Clear Filters</button>
      </div><div class="customer-gallery-results" aria-live="polite"></div>`;
      target.querySelectorAll("[data-gallery-filter]").forEach(control => {
        control.addEventListener(control.tagName === "INPUT" ? "input" : "change", () => {
          galleryFilters[control.dataset.galleryFilter] = control.value;
          updateCustomerGalleryResults();
        });
      });
      target.querySelector("[data-gallery-clear]").addEventListener("click", () => {
        Object.assign(galleryFilters, { search: "", price: "all", duration: "all", sort: "default" });
        target.querySelectorAll("[data-gallery-filter]").forEach(control => {
          control.value = galleryFilters[control.dataset.galleryFilter];
        });
        updateCustomerGalleryResults();
        target.querySelector('[data-gallery-filter="search"]').focus();
      });
    }
    updateCustomerGalleryResults();
  }

  function updateCustomerGalleryResults() {
    const target = $("customerGalleryContent");
    const results = target?.querySelector(".customer-gallery-results");
    if (!results) return;
    const { search, price, duration, sort } = galleryFilters;
    const active = Boolean(search.trim()) || price !== "all" || duration !== "all" || sort !== "default";
    target.querySelector("[data-gallery-clear]").classList.toggle("hidden", !active);
    const query = search.trim().toLocaleLowerCase();
    const filtered = state.services.filter(service => {
      const cost = Number(service.price);
      const minutes = Number(service.durationMinutes);
      return (!query || String(service.name || "").toLocaleLowerCase().includes(query))
        && (price === "all" || (price === "under100" && cost < 100) || (price === "100to200" && cost >= 100 && cost <= 200) || (price === "over200" && cost > 200))
        && (duration === "all" || (duration === "upto30" && minutes <= 30) || (duration === "31to45" && minutes > 30 && minutes <= 45) || (duration === "over45" && minutes > 45));
    });
    if (sort !== "default") filtered.sort((a, b) => {
      if (sort === "name") return String(a.name || "").localeCompare(String(b.name || ""));
      if (sort === "priceAsc") return Number(a.price) - Number(b.price);
      if (sort === "priceDesc") return Number(b.price) - Number(a.price);
      return Number(a.durationMinutes) - Number(b.durationMinutes);
    });
    results.innerHTML = filtered.length ? `<div class="customer-gallery-grid">${filtered.map(service => {
      const photo = App.safePhoto(service.imageUrl);
      return `<article class="customer-gallery-card">
        <div class="customer-gallery-card__image">${photo ? `<img src="${escapeHTML(photo)}" alt="${escapeHTML(service.name)} haircut" loading="lazy">` : '<span>Photo coming soon</span>'}</div>
        <div class="customer-gallery-card__content">
          <h2>${escapeHTML(service.name)}</h2>
          <p class="customer-gallery-card__duration">◷ &nbsp; ${Number(service.durationMinutes) || 0} min</p>
          <strong class="customer-gallery-card__price">${money(service.price)}</strong>
          <button type="button" class="customer-gallery-card__select" data-gallery-service="${escapeHTML(service.id)}">Select Haircut</button>
        </div>
      </article>`;
    }).join("")}</div>` : `<div class="customer-gallery-no-results"><h2>${state.services.length ? "No matching haircuts" : "No haircuts available yet"}</h2><p>${state.services.length ? "Try a different search or adjust your filters." : "Please check back later for available services."}</p></div>`;
    results.querySelectorAll("[data-gallery-service]").forEach(button => button.addEventListener("click", () => {
      const service = state.services.find(item => String(item.id) === button.dataset.galleryService);
      if (service) chooseHaircutMethod(service);
    }));
  }
  // Keep the selected service when moving from Popular Haircuts to either flow.
  function selectQueueHaircut(service) {
    openPage("queue");
    $("service").value = service.id;
    window.HaircutGallery?.render($("queueHaircutGallery"), state.services, s => { $("service").value = s.id; }, service.id);
  }

  function chooseHaircutMethod(service) {
    const { element, close } = App.openDialog(`
      <div class="customer-haircut-choice">
        <h2>How would you like to proceed?</h2>
        <p class="muted">Selected haircut: <strong>${escapeHTML(service.name)}</strong> · ${money(service.price)} · ${Number(service.durationMinutes) || 0} min</p>
        <div class="customer-haircut-choice-actions">
          <button type="button" class="customer-haircut-choice-button" data-method="queue">
            <span class="customer-haircut-choice-icon" aria-hidden="true">☷</span>
            <strong>Join Queue</strong>
            <small>Join today's walk-in queue</small>
          </button>
          <button type="button" class="customer-haircut-choice-button" data-method="booking">
            <span class="customer-haircut-choice-icon" aria-hidden="true">▣</span>
            <strong>Book Appointment</strong>
            <small>Choose an available date and time</small>
          </button>
        </div>
        <div class="form-actions"><button type="button" class="secondary-btn" data-close>Cancel</button></div>
      </div>`);
    element.querySelector('[data-method="queue"]').addEventListener("click", () => {
      close();
      selectQueueHaircut(service);
    });
    element.querySelector('[data-method="booking"]').addEventListener("click", () => {
      close();
      openPage("booking");
      window.CustomerBooking?.render(service.id);
    });
  }

  function renderPopularHaircuts() {
    const target = $("popularHaircuts");
    if (!target) return;
    target.innerHTML = state.services.slice(0, 5).map(service => {
      const photo = App.safePhoto(service.imageUrl);
      return `<article class="customer-popular-card"><div class="customer-popular-image">${photo ? `<img src="${escapeHTML(photo)}" alt="${escapeHTML(service.name)}" loading="lazy">` : '<span>Photo coming soon</span>'}</div><strong>${escapeHTML(service.name)}</strong><small>◷ &nbsp; ${Number(service.durationMinutes) || 0} mins</small><b>${money(service.price)}</b><button type="button" data-popular-id="${escapeHTML(service.id)}">Select Haircut</button></article>`;
    }).join("") || '<p class="muted">No haircuts available yet.</p>';
    target.querySelectorAll("[data-popular-id]").forEach(button => button.addEventListener("click", () => {
      const service = state.services.find(item => item.id === button.dataset.popularId);
      if (!service) return;
      chooseHaircutMethod(service);
    }));
  }

  // Live summary data for the five dashboard cards. Use the existing customer-scoped APIs.
  const shortcutText = (key, value) => {
    const element = $("customerShortcut" + key);
    if (element) element.textContent = value;
  };

  function updateQueueShortcut() {
    const ticket = state.ticket;
    const active = ticket && ["waiting", "serving", "assigned"].includes(ticket.status);
    shortcutText("Queue", active ? `#${ticket.queueNumber} · ${ticket.status === "serving" ? "Serving" : "Waiting"}` : "Not queued");
  }

  function updateShopHoursShortcut() {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const part = type => parts.find(p => p.type === type)?.value;
    const time = Number(part("hour")) * 60 + Number(part("minute"));
    shortcutText("Hours", part("weekday") !== "Sun" && (time >= 480 && time < 720 || time >= 780 && time < 1140) ? "Open Now" : "Closed");
  }

  async function refreshDashboardShortcuts() {
    updateQueueShortcut();
    updateShopHoursShortcut();
    try {
      const barbers = await api("/api/barbers");
      const count = barbers.filter(b => b.status === "available").length;
      shortcutText("Barbers", `${count} Available`);
    } catch { shortcutText("Barbers", "Unavailable"); }

    if (!account) {
      shortcutText("Appointment", "Sign in to view");
      shortcutText("Visits", "Sign in to view");
      return;
    }
    try {
      const appointments = await api("/api/appointments/mine");
      const now = Date.now();
      const next = appointments.filter(a => ["pending", "confirmed", "checked-in"].includes(a.status) && new Date(a.startsAt).getTime() >= now)
        .sort((a,b) => new Date(a.startsAt) - new Date(b.startsAt))[0];
      shortcutText("Appointment", next ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(next.startsAt)) : "No upcoming");
    } catch { shortcutText("Appointment", "Unavailable"); }
    try {
      const { count } = await api("/api/queue/history/count");
      shortcutText("Visits", `${count} ${count === 1 ? "Visit" : "Visits"}`);
    } catch { shortcutText("Visits", "Unavailable"); }
  }

  // ---------- Joining ----------

  async function loadOptions() {
    try {
      // Load services independently: a barber API error must not hide the haircut gallery.
      const servicesRequest = api("/api/services");
      const barbersRequest = api("/api/barbers");
      const chosenService = $("service").value;
      const chosenBarber = $("preferredBarber").value;
      const servicesResult = await servicesRequest.then(value => ({ value }), error => ({ error }));
      if (servicesResult.error) throw servicesResult.error;
      if (!Array.isArray(servicesResult.value)) throw new Error("Unable to load haircuts. Please try again.");
      state.services = servicesResult.value;
      $("service").innerHTML = '<option value="">-- Select a service --</option>' + state.services.map(s =>
        `<option value="${s.id}">${escapeHTML(s.name)} · ${money(s.price)} · about ${s.durationMinutes} min</option>`
      ).join("");
      $("service").value = chosenService;
      window.HaircutGallery?.render($("queueHaircutGallery"),state.services,service=>{$("service").value=service.id;},chosenService);
      renderPopularHaircuts();
      if (!$('galleryPage').hidden) renderCustomerGallery();

      const barbersResult = await barbersRequest.then(value => ({ value }), error => ({ error }));
      if (barbersResult.error) throw barbersResult.error;
      state.barbers = Array.isArray(barbersResult.value) ? barbersResult.value : [];
      $("preferredBarber").innerHTML = '<option value="">Any barber (fastest)</option>' + state.barbers.map(b =>
        `<option value="${b.id}">${escapeHTML(b.name)}${b.status === "unavailable" ? " (off duty today)" : b.status === "busy" ? " (busy now)" : ""}</option>`
      ).join("");
      $("preferredBarber").value = chosenBarber;
    } catch (error) {
      if (!state.services.length) {
        $("popularHaircuts").innerHTML = '<p class="muted">Unable to load haircuts. Please refresh the page and try again.</p>';
        $("queueHaircutGallery").innerHTML = '<p class="muted">Unable to load haircuts. Please refresh the page and try again.</p>';
      }
      setMessage($("queueMessage"), error.message, "error");
    }
  }

  function waitText(ticket) {
    if (ticket.status === "serving") return "Now";
    if (ticket.status !== "waiting") return "—";
    return ticket.peopleAhead === 0 ? "You're next" : `About ${ticket.estimatedMinutes} min`;
  }

  const statusText = {
    waiting: "Waiting",
    serving: "It's your turn",
    completed: "Completed",
    "no-show": "Missed (no-show)",
    cancelled: "Left the queue",
    expired: "Expired"
  };

  function renderTicket() {
    const t = state.ticket;
    const active = t && ["waiting", "serving"].includes(t.status);

    const number = t ? `#${t.queueNumber}` : "—";
    const wait = t ? waitText(t) : "—";
    const status = t ? statusText[t.status] || t.status : "Not queued";
    updateQueueShortcut();
    const heroQueueButton = $("customerHeroQueueBtn");
    if (heroQueueButton) heroQueueButton.textContent = active ? "View My Queue" : "Join Queue";

    // A short queue summary for the My Queue UI; all ticket actions stay unchanged.
    $("queuePage").dataset.queueState = t?.status || "empty";
    $("queueSummaryText").textContent = !t
      ? "No active queue ticket yet. Choose a service below to get started."
      : t.status === "serving"
        ? `It's your turn! Please proceed to ${t.barberName || "your barber"}.`
        : t.status === "waiting"
          ? (t.peopleAhead === 0 ? "You're next in line. Please be ready." : `${t.peopleAhead} customer(s) ahead of you. We'll keep this updated.`)
          : t.status === "completed"
            ? "Your haircut visit is complete. Thanks for visiting!"
            : "There is no active queue ticket. You can join again below.";

    $("queueNumber2").textContent = number;
    $("waitTime2").textContent = wait;
    $("queueStatus2").textContent = status;

    // Show one structured ticket card only while the customer has an active ticket.
    $("queueVisitHeading").textContent = "Your haircut details";
    $("queuePage").querySelector(".queue-visit-card").classList.toggle("hidden", !active);
    $("queueTicketDetails").classList.toggle("hidden", !active);
    $("visitDetails").classList.add("hidden");
    if (active) {
      const matchingService = state.services.find(service => service.id === t.serviceId || service.name === t.service);
      const duration = t.durationMinutes ?? matchingService?.durationMinutes;
      $("queueDetailService").textContent = t.service || matchingService?.name || "—";
      $("queueDetailPrice").textContent = t.price == null ? (matchingService ? money(matchingService.price) : "—") : money(t.price);
      $("queueDetailBarber").textContent = t.barberName || t.preferredBarberName || "Any available barber";
      $("queueDetailDuration").textContent = Number.isFinite(Number(duration)) && Number(duration) > 0 ? `${duration} minutes` : "—";
    }
    $("leaveQueueBtn").classList.toggle("hidden", !(t && t.status === "waiting"));
    // Legacy controls remain in the DOM for existing listeners, but their duplicate panel stays hidden.
    $("leaveQueueBtn2").classList.add("hidden");
    $("joinPanel").classList.toggle("hidden", Boolean(active));
    $("inQueuePanel").classList.add("hidden");
    $("notifyBtn").classList.toggle("hidden", !(t?.status === "waiting" && "Notification" in window && Notification.permission !== "denied" && !state.notify));

    // Alert once when the customer is called.
    if (t && t.status === "serving" && !state.alerted) {
      state.alerted = true;
      $("turnBarber").textContent = t.barberName || "your barber";
      $("turnAlert").classList.remove("hidden");
      document.title = "Your turn! | Renz Barbershop";
      beep();
      // Phones only allow vibrating after the person has tapped the page.
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([300, 150, 300]);
      if (state.notify && Notification.permission === "granted") {
        try {
          new Notification("It's your turn!", { body: `Please go to ${t.barberName || "your barber"} at Renz Barbershop.`, icon: "/favicon.svg" });
        } catch {
          // Some browsers only allow notifications from a service worker.
        }
      }
    }
    if (!t || t.status !== "serving") {
      state.alerted = false;
      $("turnAlert").classList.add("hidden");
    }
  }

  function beep() {
    try {
      const context = new AudioContext();
      [0, 0.4].forEach(offset => {
        const tone = context.createOscillator();
        const volume = context.createGain();
        tone.frequency.value = 880;
        volume.gain.value = 0.15;
        tone.connect(volume).connect(context.destination);
        tone.start(context.currentTime + offset);
        tone.stop(context.currentTime + offset + 0.25);
      });
    } catch {
      // Sound is optional.
    }
  }

  $("dismissAlert").addEventListener("click", () => {
    $("turnAlert").classList.add("hidden");
    document.title = "Customer Dashboard | Renz Barbershop";
  });

  let queueRequest = null;
  async function loadQueue() {
    if (queueRequest) return queueRequest;
    queueRequest = (async () => {
    try {
      const { ticket } = await api("/api/queue/mine");
      state.ticket = ticket;
    } catch (error) {
      if (error.status !== 404) return; // Keep showing the last status if the server is unreachable.
      state.ticket = null;
    }
    renderTicket();
    })();
    try { return await queueRequest; } finally { queueRequest = null; }
  }

  $("joinPanel").addEventListener("submit", async event => {
    event.preventDefault();
    const serviceId = $("service").value;
    if (!serviceId) {
      setMessage($("queueMessage"), "Please select a service.", "error");
      $("service").focus();
      return;
    }

    await busy($("joinQueueBtn"), async () => {
      setMessage($("queueMessage"), "");
      try {
        const { ticket } = await api("/api/queue", {
          method: "POST",
          body: { name, serviceId, preferredBarberId: $("preferredBarber").value }
        });
        state.ticket = ticket;
        toast(`You're #${ticket.queueNumber} in the queue for ${ticket.service}.`);
      } catch (error) {
        setMessage($("queueMessage"), error.message, "error");
        await loadQueue();
      }
      renderTicket();
    });
  });

  async function leaveQueue(button) {
    const ok = await confirmDialog("Leave the queue? You'll lose your place.", { title: "Leave the queue", confirmText: "Leave the queue", danger: true });
    if (!ok) return;

    await busy(button, async () => {
      try {
        const result = await api("/api/queue/mine/leave", { method: "POST" });
        // Clear the cancelled ticket immediately; the next refresh checks the server.
        state.ticket = null;
        renderTicket();
        toast(result.message);
      } catch (error) {
        toast(error.message, "error");
      }
      await loadQueue();
    });
  }

  $("leaveQueueBtn").addEventListener("click", event => leaveQueue(event.target));
  $("leaveQueueBtn2").addEventListener("click", event => leaveQueue(event.target));
  $("viewQueueBtn").addEventListener("click", () => openPage("queue"));

  $("notifyBtn").addEventListener("click", async () => {
    const permission = await Notification.requestPermission();
    state.notify = permission === "granted";
    toast(state.notify ? "We'll notify you when it's your turn. Keep this page open." : "Notifications are blocked. Keep this page open and we'll beep instead.", state.notify ? "success" : "info");
    renderTicket();
  });

  document.addEventListener("click", event => {
    const target = event.target.closest("[data-open]");
    if (target) openPage(target.dataset.open);
  });

  // Customer section banners — presentation only; existing page logic is unchanged.
  const customerPageBanners = {
    visits: ['VISIT OVERVIEW', 'My Visit History', 'View your previous visits and completed services.', '/images/customerDashboard/MyVisit.png'],
    appointments: ['BOOKING OVERVIEW', 'My Appointments', 'Track upcoming bookings and review appointment history.', '/images/appointments/Upcoming.png'],
    gallery: ['STYLE COLLECTION', 'Haircut Gallery', 'Explore haircut styles and find your next look.', '/images/landingpage/Scissors.png'],
    barbers: ['OUR TEAM', 'Meet Our Barbers', 'Discover our barbers, specialties, and current availability.', '/images/AdminDashboard/Barbers.png']
  };
  for (const [pageName, [eyebrow, title, description, picture]] of Object.entries(customerPageBanners)) {
    const section = $(pageName + 'Page');
    if (!section || section.querySelector('.customer-section-banner')) continue;
    const banner = document.createElement('section');
    banner.className = 'customer-section-banner';
    banner.setAttribute('aria-label', title);
    banner.innerHTML = `<div class="customer-section-banner-copy"><span class="customer-section-banner-eyebrow"><i aria-hidden="true"></i>${eyebrow}</span><h2>${title}</h2><p>${description}</p>${pageName === 'appointments' ? '<button class="customer-section-banner-button" type="button" data-open="booking">+ Book Appointment</button>' : ''}</div><img class="customer-section-banner-art" src="${picture}" alt="" aria-hidden="true" loading="lazy" decoding="async">`;
    section.prepend(banner);
  }

  // The banners now provide these descriptions; remove the duplicate captions below them.
  $("galleryPage")?.querySelector(".section-heading p.muted")?.remove();
  $("barbersPage")?.querySelector(".section-heading p.muted")?.remove();

  // ---------- Barbers ----------

  // Barber discovery is customer-only; shared admin barber cards are unchanged.
  const barberHeading = $("barbersPage")?.querySelector(".section-heading");
  barberHeading?.querySelector(".eyebrow")?.remove();
  barberHeading?.querySelector("h1")?.remove();
  $("refreshBarbersBtn")?.remove();
  const barberPage = $("barbersPage");
  const barberTools = document.createElement("div");
  barberTools.className = "customer-barber-tools";
  barberTools.innerHTML = `<label class="customer-barber-search"><span class="sr-only">Search barber by name</span><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input type="search" id="customerBarberSearch" placeholder="Search barber by name..." autocomplete="off"></label>
    <div class="customer-barber-filter"><button type="button" id="customerBarberFilterTrigger" class="customer-barber-filter__trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="customerBarberFilterMenu"><span id="customerBarberFilterLabel">All Barbers</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div id="customerBarberFilterMenu" class="customer-barber-filter__menu hidden" role="listbox" aria-label="Filter barber availability"><button type="button" role="option" aria-selected="true" class="selected" data-barber-filter="all">All Barbers <span aria-hidden="true">✓</span></button><button type="button" role="option" aria-selected="false" data-barber-filter="available">Available <span aria-hidden="true">✓</span></button><button type="button" role="option" aria-selected="false" data-barber-filter="off-duty">Off Duty <span aria-hidden="true">✓</span></button></div></div><button type="button" id="customerBarberClearFilters" class="customer-barber-clear hidden">Clear Filters <span aria-hidden="true">×</span></button>`;
  barberPage?.insertBefore(barberTools, $("barbersMessage"));
  const barberSearch = $("customerBarberSearch");
  const barberFilterWrap = barberTools.querySelector(".customer-barber-filter");
  const barberFilterTrigger = $("customerBarberFilterTrigger");
  const barberFilterMenu = $("customerBarberFilterMenu");
  let barberFilter = "all";
  const barberClearFilters = $("customerBarberClearFilters");
  function syncBarberClearFilters() {
    barberClearFilters.classList.toggle("hidden", !barberSearch.value.trim() && barberFilter === "all");
  }
  barberClearFilters.addEventListener("click", () => { barberSearch.value = ""; setBarberFilter("all"); barberSearch.focus(); });
  function closeBarberFilter() { barberFilterMenu.classList.add("hidden"); barberFilterTrigger.setAttribute("aria-expanded", "false"); }
  function setBarberFilter(value) {
    barberFilter = value;
    barberFilterMenu.querySelectorAll("[data-barber-filter]").forEach(option => {
      const selected = option.dataset.barberFilter === value;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-selected", String(selected));
      if (selected) $("customerBarberFilterLabel").textContent = option.textContent.replace("✓", "").trim();
    });
    closeBarberFilter();
    syncBarberClearFilters();
    drawBarbers();
  }
  barberFilterTrigger.addEventListener("click", () => {
    const opening = barberFilterMenu.classList.contains("hidden");
    barberFilterMenu.classList.toggle("hidden", !opening);
    barberFilterTrigger.setAttribute("aria-expanded", String(opening));
    if (opening) barberFilterMenu.querySelector(".selected")?.focus();
  });
  barberFilterMenu.addEventListener("click", event => {
    const option = event.target.closest("[data-barber-filter]");
    if (option) { setBarberFilter(option.dataset.barberFilter); barberFilterTrigger.focus(); }
  });
  barberFilterMenu.addEventListener("keydown", event => {
    const options = [...barberFilterMenu.querySelectorAll("[data-barber-filter]")];
    const index = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
    } else if (event.key === "Escape") { closeBarberFilter(); barberFilterTrigger.focus(); }
  });
  document.addEventListener("pointerdown", event => { if (!barberFilterWrap.contains(event.target)) closeBarberFilter(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeBarberFilter(); });
  let barbersLoading = false;
  let barbersError = "";
  let barbersRequest = 0;

  function barberAvailability(barber) {
    if (barber.status === "available") return "Available now";
    if (barber.status === "busy") return "Busy right now";
    return "Off duty";
  }

  function drawBarbers() {
    syncBarberClearFilters();
    const target = $("barberList");
    if (!target) return;
    if (barbersLoading) {
      target.setAttribute("aria-busy", "true");
      target.innerHTML = '<div class="customer-barber-state" role="status"><span class="customer-barber-spinner" aria-hidden="true"></span><h2>Loading barbers...</h2><p>Getting the latest barber profiles and availability.</p></div>';
      return;
    }
    target.removeAttribute("aria-busy");
    if (barbersError) {
      target.innerHTML = `<div class="customer-barber-state" role="alert"><h2>Unable to load barbers</h2><p>${escapeHTML(barbersError)}</p><button class="secondary-btn" type="button" data-barber-retry>Try again</button></div>`;
      return;
    }
    const search = barberSearch.value.trim().toLocaleLowerCase();
    const filter = barberFilter;
    const matches = state.barbers.filter(barber => {
      const matchedName = String(barber.name || "").toLocaleLowerCase().includes(search);
      // Busy barbers are on duty; the Off Duty filter excludes them.
      const matchedStatus = filter === "all" || (filter === "available" && barber.status === "available") || (filter === "off-duty" && barber.status === "unavailable");
      return matchedName && matchedStatus;
    });
    if (!matches.length) {
      target.innerHTML = `<div class="customer-barber-state"><h2>${state.barbers.length ? "No barbers found" : "No barber profiles yet"}</h2><p>${state.barbers.length ? "Try another name or availability filter." : "Please check back soon."}</p>${state.barbers.length ? '<button type="button" class="secondary-btn" data-barber-clear>Clear filters</button>' : ''}</div>`;
      return;
    }
    target.innerHTML = matches.map(barber => {
      const id = escapeHTML(barber.id);
      return App.barberCard(barber, `<button type="button" class="secondary-btn" data-barber-profile="${id}">View Profile</button><button type="button" class="primary-btn" data-barber-book="${id}">Book Appointment</button>`);
    }).join("");
  }

  async function loadBarbers() {
    const version = ++barbersRequest;
    barbersLoading = true;
    barbersError = "";
    setMessage($("barbersMessage"), "");
    drawBarbers();
    try {
      const result = await api("/api/barbers");
      if (version !== barbersRequest) return;
      if (!Array.isArray(result)) throw new Error("Unexpected barber information received.");
      state.barbers = result;
    } catch (error) {
      if (version !== barbersRequest) return;
      barbersError = error.message || "Please try again.";
    } finally {
      if (version === barbersRequest) {
        barbersLoading = false;
        drawBarbers();
      }
    }
  }

  function showBarberProfile(barber) {
    const photo = App.safePhoto(barber.photoUrl);
    const years = Number(barber.experienceYears) || 0;
    const initial = escapeHTML(String(barber.name || "B").charAt(0).toUpperCase());
    const status = barber.status === "available" ? "available" : barber.status === "busy" ? "busy" : "unavailable";
    const { element, close } = App.openDialog(`<div class="customer-barber-profile">
      <div class="customer-barber-profile__photo">${photo ? `<img src="${escapeHTML(photo)}" alt="${escapeHTML(barber.name)}" data-initial="${initial}">` : `<div class="barber-avatar" aria-hidden="true">${initial}</div>`}</div>
      <div class="customer-barber-profile__content"><span class="eyebrow">BARBER PROFILE</span><h2>${escapeHTML(barber.name)}</h2>
      <span class="barber-status ${status}">${barberAvailability(barber)}</span>
      <div class="customer-barber-profile__details"><div><span>Specialty</span><strong>${escapeHTML(barber.specialty || "General Barber")}</strong></div><div><span>Experience</span><strong>${years ? `${years} year${years === 1 ? "" : "s"}` : "Not specified"}</strong></div></div>
      <h3>About this barber</h3><p>${escapeHTML(barber.bio || "Welcome to our barbershop!")}</p>
      <p class="customer-barber-profile__note">Current availability may change. Available appointment times are checked when you select a date.</p>
      <div class="customer-barber-profile__actions"><button type="button" class="secondary-btn" data-close>Close</button><button type="button" class="primary-btn" data-barber-profile-book>Book Appointment</button></div></div>
    </div>`);
    element.querySelector("[data-barber-profile-book]").addEventListener("click", () => {
      close();
      bookWithBarber(barber);
    });
    const img = element.querySelector(".customer-barber-profile__photo img");
    if (img) img.addEventListener("error", () => {
      img.replaceWith(Object.assign(document.createElement("div"), { className: "barber-avatar", textContent: barber.name.charAt(0).toUpperCase() }));
    }, { once: true });
  }

  function bookWithBarber(barber) {
    if (!account) {
      toast("Please sign in as a customer to book an appointment.", "info");
      return;
    }
    // Selection is pending until the existing Booking form has finished loading.
    window.CustomerBooking?.selectBarber(barber.id);
    openPage("booking");
  }

  barberSearch.addEventListener("input", drawBarbers);
  
  $("barberList").addEventListener("click", event => {
    if (event.target.closest("[data-barber-retry]")) { loadBarbers(); return; }
    if (event.target.closest("[data-barber-clear]")) { barberSearch.value = ""; setBarberFilter("all"); return; }
    const profile = event.target.closest("[data-barber-profile]");
    const book = event.target.closest("[data-barber-book]");
    const id = profile?.dataset.barberProfile || book?.dataset.barberBook;
    if (!id) return;
    const barber = state.barbers.find(item => String(item.id) === id);
    if (!barber) return;
    if (profile) showBarberProfile(barber);
    else bookWithBarber(barber);
  });

  // ---------- Rating ----------

  // ---------- Visits ----------

  // My Visits: server-side filtering and pagination, with no changes to queue operations.
  const visitFilters = { search: "", status: "all", from: "", to: "", sort: "newest", page: 1, pageSize: "10" };
  let visitLoadVersion = 0;
  const visitDate = value => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(date);
  };
  const visitTime = value => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(date);
  };
  // Use the saved visit photo when available, otherwise match the service's current photo.
  function visitServicePhoto(visit, availableServices) {
    const names = String(visit.service || "").trim().toLocaleLowerCase();
    const services = Array.isArray(availableServices) ? availableServices : state.services;
    const service = services.find(s => String(s.id) === String(visit.serviceId || ""))
      || services.find(s => String(s.name || "").trim().toLocaleLowerCase() === names);
    return App.safePhoto(visit.imageUrl || service?.imageUrl || "");
  }
  function visitServiceCell(visit, availableServices) {
    const photo = visitServicePhoto(visit, availableServices);
    return `<span class="customer-visit-service">${photo
      ? `<img class="customer-visit-service-photo" src="${escapeHTML(photo)}" alt="" loading="lazy" decoding="async">`
      : '<span class="customer-visit-service-photo customer-visit-service-placeholder" aria-hidden="true">✂</span>'}
      <span class="customer-visit-service-name">${escapeHTML(visit.service || "—")}</span></span>`;
  }
  function visitDetails(visit) {
    App.openDialog(`<div class="customer-visit-dialog"><span class="eyebrow">VISIT INFORMATION</span><h2>Visit Details</h2>
      <div class="customer-visit-dialog-status">${statusPill(visit.status)}</div>
      <dl class="customer-visit-detail-grid">
        <div><dt>Date</dt><dd>${escapeHTML(visit.queueDate || "—")}</dd></div>
        <div><dt>Time Joined</dt><dd>${escapeHTML(visitTime(visit.createdAt))}</dd></div>
        <div><dt>Service</dt><dd>${escapeHTML(visit.service || "—")}</dd></div>
        <div><dt>Barber</dt><dd>${escapeHTML(visit.barberName || "—")}</dd></div>
        <div><dt>Queue Number</dt><dd>${visit.queueNumber == null ? "—" : `#${escapeHTML(visit.queueNumber)}`}</dd></div>
        <div><dt>Duration</dt><dd>${Number(visit.durationMinutes) > 0 ? `${escapeHTML(visit.durationMinutes)} min` : "—"}</dd></div>
        <div><dt>Amount Paid</dt><dd>${visit.amountPaid != null ? money(visit.amountPaid) : "—"}</dd></div>
        <div><dt>Completed At</dt><dd>${visit.completedAt ? `${escapeHTML(visitDate(visit.completedAt))}, ${escapeHTML(visitTime(visit.completedAt))}` : "—"}</dd></div>
      </dl><div class="form-actions"><button type="button" class="secondary-btn" data-close>Close</button></div></div>`);
  }
  async function fetchVisits() {
    const box = $("visitsContent");
    if (!box || !account) return;
    const version = ++visitLoadVersion;
    const tbody = box.querySelector("[data-visits-results]");
    if (tbody) tbody.innerHTML = '<div class="customer-visits-message" role="status">Loading your visits…</div>';
    const params = new URLSearchParams({ format: "paginated", page: String(visitFilters.page), pageSize: visitFilters.pageSize, sort: visitFilters.sort });
    if (visitFilters.search.trim()) params.set("search", visitFilters.search.trim());
    if (visitFilters.status !== "all") params.set("status", visitFilters.status);
    if (visitFilters.from) params.set("from", visitFilters.from);
    if (visitFilters.to) params.set("to", visitFilters.to);
    try {
      // Fetch active service photos alongside history; a failed photo lookup must not block visits.
      const [result, availableServices] = await Promise.all([
        api(`/api/queue/history?${params}`),
        api("/api/services").catch(() => state.services)
      ]);
      if (version !== visitLoadVersion || !box.isConnected) return;
      const visits = result.visits || [];
      const total = Number(result.total) || 0;
      const pages = Math.max(1, Number(result.totalPages) || 1);
      box.querySelector("[data-visits-results]").innerHTML = visits.length ? `<div class="customer-visits-table-scroll"><table class="data-table customer-visits-table"><thead><tr><th>Date &amp; Time</th><th>Service</th><th>Barber</th><th>Status</th><th>Amount Paid</th><th>Actions</th></tr></thead><tbody>${visits.map((v, i) => `<tr><td><strong>${escapeHTML(v.queueDate || "—")}</strong><small>${escapeHTML(visitTime(v.createdAt))}</small></td><td>${visitServiceCell(v, availableServices)}</td><td>${escapeHTML(v.barberName || "—")}</td><td>${statusPill(v.status)}</td><td>${v.amountPaid != null ? money(v.amountPaid) : "—"}</td><td><button type="button" class="customer-visit-details-btn" data-visit-index="${i}" aria-label="View details for ${escapeHTML(v.service || "visit")}">View Details</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="customer-visits-message"><h2>${total ? "No visits on this page" : "No matching visits"}</h2><p>${total ? "Choose another page." : "Try adjusting your search or filters."}</p></div>`;
      box.querySelectorAll("[data-visit-index]").forEach(button => button.addEventListener("click", () => visitDetails(visits[Number(button.dataset.visitIndex)])));
      const pager = box.querySelector("[data-visits-pager]");
      pager.innerHTML = `<span>Showing ${total ? (visitFilters.page - 1) * (visitFilters.pageSize === "all" ? total : Number(visitFilters.pageSize)) + 1 : 0}–${total ? Math.min(total, visitFilters.page * (visitFilters.pageSize === "all" ? total : Number(visitFilters.pageSize))) : 0} of ${total} visits</span><div class="customer-visits-pager-actions"><button type="button" data-visit-page="prev" ${visitFilters.page <= 1 ? "disabled" : ""} aria-label="Previous page">‹</button><span>Page ${visitFilters.page} of ${pages}</span><button type="button" data-visit-page="next" ${visitFilters.page >= pages ? "disabled" : ""} aria-label="Next page">›</button></div>`;
      pager.querySelectorAll("[data-visit-page]").forEach(button => button.addEventListener("click", () => { visitFilters.page += button.dataset.visitPage === "next" ? 1 : -1; fetchVisits(); }));
    } catch (error) {
      if (version !== visitLoadVersion || !box.isConnected) return;
      box.querySelector("[data-visits-results]").innerHTML = `<div class="customer-visits-message" role="alert"><p>${escapeHTML(error.message || "Unable to load visits.")}</p><button type="button" class="secondary-btn" data-visits-retry>Try again</button></div>`;
      box.querySelector("[data-visits-retry]")?.addEventListener("click", fetchVisits);
      box.querySelector("[data-visits-pager]").innerHTML = "";
    }
  }
  let visitsSearchTimer;
  function updateVisitsFilters() {
    const box = $("visitsContent");
    if (!box) return;
    const active = visitFilters.search.trim() || visitFilters.status !== "all" || visitFilters.from || visitFilters.to || visitFilters.sort !== "newest";
    box.querySelector("[data-visits-clear]")?.classList.toggle("hidden", !active);
    visitFilters.page = 1;
    fetchVisits();
  }
  async function loadVisits() {
    const box = $("visitsContent");
    if (!box) return;
    // Preserve the top-bar navigation title but remove the duplicate heading in content.
    $("visitsPage")?.querySelector(":scope > .eyebrow")?.remove();
    $("visitsPage")?.querySelector(":scope > h1")?.remove();
    if (!account) {
      box.innerHTML = `<section class="customer-appointment-guest customer-visits-guest" aria-labelledby="customerVisitsGuestTitle">
        <img class="customer-appointment-guest__image" src="/images/customerDashboard/MyVisit.png" alt="" decoding="async">
        <span class="customer-appointment-guest__eyebrow">MY VISITS</span>
        <h2 id="customerVisitsGuestTitle">Sign In to View Your Visits</h2>
        <p>Sign in to view your haircut history and previous visits, or create an account to get started. You can still join the walk-in queue without an account.</p>
        <div class="customer-appointment-guest__actions">
          <a class="customer-appointment-guest__primary" href="/login.html#signin">Sign In</a>
          <a class="customer-appointment-guest__secondary" href="/login.html#register">Create an Account</a>
        </div>
        <small>Creating an account is optional for walk-in customers.</small>
      </section>`;
      return;
    }
    if (!box.querySelector(".customer-visits-ui")) {
      box.innerHTML = `<section class="customer-visits-ui" aria-label="My visit records"><div class="customer-visits-filter-card"><div class="customer-visits-filter-row">
        <label class="customer-visits-search"><span class="sr-only">Search service or barber</span><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" data-visit-filter="search" placeholder="Search service or barber..." aria-label="Search service or barber"></label>
        <label><span class="sr-only">Status</span><select data-visit-filter="status" aria-label="Visit status"><option value="all">All Status</option><option value="waiting">Waiting</option><option value="serving">Being served</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no-show">No-show</option><option value="expired">Expired</option></select></label>
        <label><span class="sr-only">From date</span><input type="date" data-visit-filter="from" aria-label="From date"></label>
        <label><span class="sr-only">To date</span><input type="date" data-visit-filter="to" aria-label="To date"></label>
        <label><span class="sr-only">Sort</span><select data-visit-filter="sort" aria-label="Sort visits"><option value="newest">Newest First</option><option value="oldest">Oldest First</option></select></label>
        <button type="button" class="customer-visits-clear hidden" data-visits-clear>Clear Filters</button>
      </div></div><div class="customer-visits-table-card"><div data-visits-results aria-live="polite"></div><div class="customer-visits-footer"><label>Rows per page <select data-visit-filter="pageSize" aria-label="Rows per page"><option value="10">10</option><option value="50">50</option><option value="100">100</option><option value="all">All</option></select></label><div data-visits-pager></div></div></div></section>`;
      box.querySelectorAll("[data-visit-filter]").forEach(control => {
        const key = control.dataset.visitFilter;
        control.value = visitFilters[key];
        control.addEventListener(key === "search" ? "input" : "change", () => {
          visitFilters[key] = control.value;
          if (key === "search") { clearTimeout(visitsSearchTimer); visitsSearchTimer = setTimeout(updateVisitsFilters, 280); }
          else updateVisitsFilters();
        });
      });
      box.querySelector("[data-visits-clear]").addEventListener("click", () => {
        Object.assign(visitFilters, { search: "", status: "all", from: "", to: "", sort: "newest", page: 1 });
        box.querySelectorAll("[data-visit-filter]").forEach(control => control.value = visitFilters[control.dataset.visitFilter]);
        updateVisitsFilters();
      });
    }
    await fetchVisits();
  }


  // Appointment notifications: dropdown and full history share the existing customer API.
  const notificationButton = $("customerNotifications");
  const dropdown = $("customerNotificationDropdown");
  const notificationState = { items: [], filter: "all", search: "", page: 1, pageSize: 10, loading: false, error: "" };
  const dateInManila = date => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = type => parts.find(item => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const ageInDays = value => {
    const today = dateInManila(new Date());
    const created = dateInManila(new Date(value));
    return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${created}T00:00:00Z`)) / 86400000);
  };
  const notificationGroup = item => {
    const days = ageInDays(item.createdAt);
    if (days === 0) return "TODAY";
    if (days >= 1 && days <= 6) return "THIS WEEK";
    if (days >= 7 && days <= 13) return "LAST WEEK";
    return "EARLIER";
  };
  const timeAgo = value => {
    const delta = Math.max(0, Date.now() - new Date(value).getTime());
    if (delta < 60000) return "Just now";
    if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
    if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`;
    if (delta < 604800000) return `${Math.floor(delta / 86400000)}d ago`;
    return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  };
  const notificationSymbol = type => ({
    "created": `<svg class="customer-notification-status-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 13v6M9 16h6"/></svg>`,
    "confirmed": `<svg class="customer-notification-status-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-12 6 2 2 4-4"/></svg>`,
    "cancelled": `<svg class="customer-notification-status-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-12 4 6 6m0-6-6 6"/></svg>`,
    "checked-in": `<svg class="customer-notification-status-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>`,
    "no-show": `<svg class="customer-notification-status-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>`,
    "reminder-30": `<svg class="customer-notification-status-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  })[type] || `<svg class="customer-notification-status-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
  const notificationRow = (item, compact = false) => `
    <article class="customer-notification-item${item.read ? "" : " unread"}${compact ? " compact" : ""}">
      <span class="customer-notification-type-icon" aria-hidden="true">${notificationSymbol(item.type)}</span>
      <div class="customer-notification-info">
        <div class="customer-notification-item-head"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(timeAgo(item.createdAt))}</small>${!item.read ? '<i class="customer-notification-dot" aria-label="Unread"></i>' : ""}</div>
        <p>${escapeHTML(item.message)}</p>
        ${compact ? "" : `<div class="customer-notification-item-actions"><button type="button" data-notification-view="${escapeHTML(item.id)}">View Details →</button>${!item.read ? `<button type="button" data-notification-read="${escapeHTML(item.id)}">✓ Mark as read</button>` : ""}</div>`}
      </div>
    </article>`;
  const groupedNotifications = (list, compact = false) => {
    if (!list.length) return '<div class="customer-notification-empty">No notifications to show.</div>';
    let group = "";
    return list.map(item => {
      const next = notificationGroup(item);
      const heading = next !== group ? `<h3 class="customer-notification-group">${next}</h3>` : "";
      group = next;
      return heading + notificationRow(item, compact);
    }).join("");
  };
  const unreadTotal = () => notificationState.items.filter(item => !item.read).length;
  function updateUnreadBadge() {
    const count = unreadTotal();
    $("customerUnread").textContent = count ? `(${count})` : "";
    $("customerNotificationUnreadTab").textContent = count || "";
  }
  function closeNotificationDropdown() {
    dropdown.classList.add("hidden");
    notificationButton.setAttribute("aria-expanded", "false");
  }
  function renderNotificationDropdown() {
    const list = notificationState.items.slice(0, 7);
    dropdown.innerHTML = `<div class="customer-notification-dropdown-head"><span class="customer-notification-mini-icon" aria-hidden="true"><svg class="customer-ui-icon" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg></span><strong>Notifications</strong><button type="button" data-notification-all-read ${unreadTotal() ? "" : "disabled"}>Mark all as read</button></div><div class="customer-notification-dropdown-body">${notificationState.error ? `<p class="customer-notification-empty">${escapeHTML(notificationState.error)}</p>` : groupedNotifications(list, true)}</div><button type="button" class="customer-notification-view-all" data-notification-view-all>View all notifications <svg class="customer-notification-view-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>`;
  }
  function filteredNotificationList() {
    const q = notificationState.search.toLocaleLowerCase();
    return notificationState.items.filter(item =>
      (notificationState.filter === "all" || (notificationState.filter === "read" ? item.read : !item.read)) &&
      (!q || `${item.title} ${item.message}`.toLocaleLowerCase().includes(q))
    );
  }
  function renderNotificationsPage() {
    const filtered = filteredNotificationList();
    const maxPages = Math.max(1, Math.ceil(filtered.length / notificationState.pageSize));
    notificationState.page = Math.min(notificationState.page, maxPages);
    const start = (notificationState.page - 1) * notificationState.pageSize;
    $("customerNotificationsList").innerHTML = notificationState.error
      ? `<div class="customer-notification-empty">${escapeHTML(notificationState.error)}</div>`
      : groupedNotifications(filtered.slice(start, start + notificationState.pageSize));
    $("customerNotificationPager").innerHTML = maxPages > 1
      ? `<button type="button" data-notification-page="prev" ${notificationState.page <= 1 ? "disabled" : ""}>‹ Previous</button><span>Page ${notificationState.page} of ${maxPages}</span><button type="button" data-notification-page="next" ${notificationState.page >= maxPages ? "disabled" : ""}>Next ›</button>`
      : "";
    document.querySelectorAll("[data-notification-filter]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.notificationFilter === notificationState.filter);
      btn.setAttribute("aria-pressed", String(btn.dataset.notificationFilter === notificationState.filter));
    });
    $("customerMarkAllRead").disabled = !unreadTotal();
    updateUnreadBadge();
  }
  async function refreshNotifications(full = false) {
    if (!account) return;
    try {
      // The all flag only changes the customer response; staff's existing endpoint remains intact.
      const items = await api(full ? "/api/appointments/notifications?all=1" : "/api/appointments/notifications");
      if (full || notificationState.items.length <= items.length) notificationState.items = items;
      notificationState.error = "";
    } catch (e) {
      notificationState.error = e.message;
    }
    updateUnreadBadge();
    if (!dropdown.classList.contains("hidden")) renderNotificationDropdown();
    if (!$("notificationsPage").hidden) renderNotificationsPage();
  }
  async function markNotificationRead(id) {
    const item = notificationState.items.find(entry => entry.id === id);
    if (!item || item.read) return;
    try {
      await api(`/api/appointments/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
      item.read = true;
      renderNotificationDropdown();
      renderNotificationsPage();
    } catch (e) { toast(e.message, "error"); }
  }
  async function markAllNotificationsRead() {
    if (!unreadTotal()) return;
    try {
      await api("/api/appointments/notifications/read-all", { method: "PATCH" });
      notificationState.items.forEach(item => { item.read = true; });
      renderNotificationDropdown();
      renderNotificationsPage();
    } catch (e) { toast(e.message, "error"); }
  }
  notificationButton?.addEventListener("click", async event => {
    event.stopPropagation();
    if (!account) { toast("Sign in to receive appointment notifications.", "info"); return; }
    const open = dropdown.classList.contains("hidden");
    closeProfileMenu();
    if (!open) { closeNotificationDropdown(); return; }
    dropdown.classList.remove("hidden");
    notificationButton.setAttribute("aria-expanded", "true");
    renderNotificationDropdown();
    await refreshNotifications();
  });
  document.addEventListener("click", event => {
    if (!dropdown.contains(event.target) && !notificationButton?.contains(event.target)) closeNotificationDropdown();
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeNotificationDropdown(); });
  dropdown.addEventListener("click", async event => {
    const all = event.target.closest("[data-notification-all-read]");
    if (all) { await markAllNotificationsRead(); return; }
    if (event.target.closest("[data-notification-view-all]")) {
      closeNotificationDropdown();
      openPage("notifications");
      return;
    }
    const row = event.target.closest(".customer-notification-item");
    if (row) { closeNotificationDropdown(); openPage("notifications"); }
  });
  $("customerNotificationsList").addEventListener("click", async event => {
    const read = event.target.closest("[data-notification-read]");
    if (read) { await markNotificationRead(read.dataset.notificationRead); return; }
    const view = event.target.closest("[data-notification-view]");
    if (view) { await markNotificationRead(view.dataset.notificationView); openPage("appointments"); }
  });
  $("customerNotificationBack").addEventListener("click", () => openPage("dashboard"));
  $("customerNotificationSearch").addEventListener("input", event => {
    notificationState.search = event.target.value.trim();
    notificationState.page = 1;
    renderNotificationsPage();
  });
  document.querySelectorAll("[data-notification-filter]").forEach(button => button.addEventListener("click", () => {
    notificationState.filter = button.dataset.notificationFilter;
    notificationState.page = 1;
    renderNotificationsPage();
  }));
  $("customerMarkAllRead").addEventListener("click", markAllNotificationsRead);
  $("customerNotificationPager").addEventListener("click", event => {
    const btn = event.target.closest("[data-notification-page]");
    if (!btn) return;
    notificationState.page += btn.dataset.notificationPage === "next" ? 1 : -1;
    renderNotificationsPage();
    $("notificationsPage").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  refreshNotifications();
  setInterval(() => refreshNotifications($("notificationsPage").hidden === false), 30000);

  // ---------- Start ----------

  // The markup defaults to Dashboard; restore any page from a bookmarked URL.
  if (window.location.hash) openPage(pageFromHash(), false);
  renderTicket();
  await Promise.all([loadOptions(), loadQueue()]);
  refreshDashboardShortcuts();
  setInterval(() => { if (!$("dashboardPage").hidden) refreshDashboardShortcuts(); }, 30000);
  setInterval(() => {
    if (!document.hidden && (!$(`dashboardPage`).hidden || !$(`queuePage`).hidden)) loadQueue();
  }, 10000);
})();
