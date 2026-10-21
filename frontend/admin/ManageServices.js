// Admin Services CRUD module, extracted from AdminPage.js.
(function () {
  "use strict";
  const { api, escapeHTML, money, setMessage, openDialog, confirmDialog, toast, busy } = App;
  const { emptyRow } = Desk;

  // ---------- Services ----------

  async function services(body, actions) {
    actions.innerHTML = `
      <button class="primary-btn" type="button" id="addService">+ Add a service</button>
      <span class="service-actions-divider" aria-hidden="true"></span>
      <div class="service-tabs" role="group" aria-label="Service list">
        <button type="button" class="service-tab active" data-service-tab="active" aria-pressed="true">Active <span id="activeServiceCount">0</span></button>
        <button type="button" class="service-tab" data-service-tab="archived" aria-pressed="false">Archived <span id="archivedServiceCount">0</span></button>
      </div>`;
    body.innerHTML = `
      <section class="card service-filter-card" aria-label="Filter services">
        <label class="service-search-field"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="serviceSearch" type="search" placeholder="Search service name..." aria-label="Search service name" maxlength="60"></label>
        <select id="serviceStatus" aria-label="Filter service status"><option value="all">All Services</option><option value="active">Active</option><option value="archived">Archived</option></select>
        <select id="servicePrice" aria-label="Filter price"><option value="all">All Prices</option><option value="under100">Under ₱100</option><option value="100-199">₱100 - ₱199</option><option value="200plus">₱200 and above</option></select>
        <select id="serviceSort" aria-label="Sort services"><option value="name">Name A - Z</option><option value="name-desc">Name Z - A</option><option value="price-asc">Price: Low to High</option><option value="price-desc">Price: High to Low</option><option value="duration">Shortest Duration</option><option value="newest">Newest First</option></select>
        <button type="button" class="secondary-btn service-clear-btn" id="serviceClearFilters" hidden>Clear</button>
      </section>
      <article class="card service-table-card">
        <div class="service-table-heading"><div><h2 id="serviceTableTitle">Active Services</h2><p>Manage service details, availability and archived records.</p></div><span id="serviceResultCount" class="service-table-count" aria-live="polite"></span></div>
        <div class="table-wrap">
          <table class="data-table service-table">
            <thead><tr><th>No.</th><th>Photo</th><th>Service</th><th>Price</th><th>Duration</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody id="serviceRows"></tbody>
          </table>
        </div>
        <div class="service-pagination"><span id="servicePageSummary"></span><div><button type="button" id="servicePrevious" class="secondary-btn small">Previous</button><span id="servicePageNumber"></span><button type="button" id="serviceNext" class="secondary-btn small">Next</button></div></div>
      </article>
      <p class="muted small spaced">The price is charged by default at the front desk (the cashier can adjust it, with a reason for discounts). Durations are used for wait-time estimates. Archived services are unavailable for new bookings; past visits and payments remain unchanged.</p>`;

    let list = [];
    let currentTab = "active";
    let page = 1;
    const pageSize = 10;
    const filters = {
      search: body.querySelector("#serviceSearch"),
      status: body.querySelector("#serviceStatus"),
      price: body.querySelector("#servicePrice"),
      sort: body.querySelector("#serviceSort")
    };

    const clearFiltersButton = body.querySelector("#serviceClearFilters");
    function updateClearFilters() {
      clearFiltersButton.hidden = !Boolean(filters.search.value.trim() || filters.status.value !== "all" || filters.price.value !== "all" || filters.sort.value !== "name");
    }

    const icon = (name) => ({
      view: '<circle cx="11" cy="11" r="3"/><path d="M2 11s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z"/>',
      edit: '<path d="M12 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 4 4 4-9 9-4 1 1-4 9-9a2.8 2.8 0 0 1 4 4"/>',
      archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 14h4"/>',
      restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'
    }[name] || '');
    function actionButton(action, service, label) {
      return `<button type="button" class="service-icon-btn service-icon-${action}" data-${action}="${escapeHTML(service.id)}" aria-label="${label} ${escapeHTML(service.name)}" title="${label}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon(action)}</svg></button>`;
    }
    function displayedServices() {
      let result = list.filter(s => filters.status.value === "all" ? s.active === (currentTab === "active") : s.active === (filters.status.value === "active"));
      const term = filters.search.value.trim().toLocaleLowerCase();
      if (term) result = result.filter(s => String(s.name || "").toLocaleLowerCase().includes(term));
      result = result.filter(s => {
        const price = Number(s.price);
        return filters.price.value === "under100" ? price < 100 : filters.price.value === "100-199" ? price >= 100 && price < 200 : filters.price.value === "200plus" ? price >= 200 : true;
      });
      result.sort((a, b) => {
        switch (filters.sort.value) {
          case "name-desc": return b.name.localeCompare(a.name);
          case "price-asc": return a.price - b.price || a.name.localeCompare(b.name);
          case "price-desc": return b.price - a.price || a.name.localeCompare(b.name);
          case "duration": return a.durationMinutes - b.durationMinutes || a.name.localeCompare(b.name);
          case "newest": return new Date(b.createdAt || 0) - new Date(a.createdAt || 0) || a.name.localeCompare(b.name);
          default: return a.name.localeCompare(b.name);
        }
      });
      return result;
    }
    function draw() {
      updateClearFilters();
      const active = list.filter(s => s.active).length;
      const archived = list.length - active;
      actions.querySelector("#activeServiceCount").textContent = active;
      actions.querySelector("#archivedServiceCount").textContent = archived;
      actions.querySelectorAll("[data-service-tab]").forEach(tab => {
        const selected = tab.dataset.serviceTab === currentTab;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-pressed", String(selected));
      });
      const result = displayedServices();
      const pages = Math.max(1, Math.ceil(result.length / pageSize));
      page = Math.min(page, pages);
      const start = (page - 1) * pageSize;
      const visible = result.slice(start, start + pageSize);
      body.querySelector("#serviceTableTitle").textContent = filters.status.value === "all" ? (currentTab === "active" ? "Active Services" : "Archived Services") : (filters.status.value === "active" ? "Active Services" : "Archived Services");
      body.querySelector("#serviceResultCount").textContent = `${result.length} service${result.length === 1 ? "" : "s"}`;
      body.querySelector("#serviceRows").innerHTML = visible.length ? visible.map((s, index) => {
        const photo = App.safePhoto(s.imageUrl);
        return `<tr class="${s.active ? "" : "inactive"}">
          <td>${start + index + 1}</td>
          <td>${photo ? `<img src="${escapeHTML(photo)}" alt="${escapeHTML(s.name)}" loading="lazy" class="service-thumb">` : '<span class="service-no-photo">No photo</span>'}</td>
          <td class="service-name"><strong>${escapeHTML(s.name)}</strong></td>
          <td>${money(s.price)}</td>
          <td>${escapeHTML(s.durationMinutes)} min</td>
          <td>${s.active ? '<span class="status-pill completed">Active</span>' : '<span class="status-pill cancelled">Archived</span>'}</td>
          <td class="row-actions"><span class="service-action-group">${actionButton("view", s, "View")}${s.active ? `${actionButton("edit", s, "Edit")}${actionButton("archive", s, "Archive")}` : actionButton("restore", s, "Restore")}</span></td>
        </tr>`;
      }).join("") : emptyRow(7, "No matching services found.");
      body.querySelector("#servicePageSummary").textContent = `Showing ${result.length ? start + 1 : 0}–${Math.min(start + pageSize, result.length)} of ${result.length}`;
      body.querySelector("#servicePageNumber").textContent = `Page ${page} of ${pages}`;
      body.querySelector("#servicePrevious").disabled = page <= 1;
      body.querySelector("#serviceNext").disabled = page >= pages;
    }
    async function load() {
      list = await api("/api/services/all");
      draw();
    }
    actions.querySelectorAll("[data-service-tab]").forEach(tab => tab.addEventListener("click", () => {
      currentTab = tab.dataset.serviceTab;
      filters.status.value = "all";
      page = 1;
      draw();
    }));
    Object.values(filters).forEach(control => control.addEventListener(control === filters.search ? "input" : "change", () => {
      if (control === filters.status && control.value !== "all") currentTab = control.value;
      page = 1;
      draw();
    }));
    clearFiltersButton.addEventListener("click", () => {
      filters.search.value = "";
      filters.status.value = "all";
      filters.price.value = "all";
      filters.sort.value = "name";
      page = 1;
      draw();
      filters.search.focus();
    });
    body.querySelector("#servicePrevious").addEventListener("click", () => { if (page > 1) { page--; draw(); } });
    body.querySelector("#serviceNext").addEventListener("click", () => { if (page < Math.ceil(displayedServices().length / pageSize)) { page++; draw(); } });

    function serviceDetails(s) {
      const photo = App.safePhoto(s.imageUrl);
      openDialog(`<div class="service-detail-dialog"><h2>Service Details</h2>
        <div class="service-detail-photo">${photo ? `<img src="${escapeHTML(photo)}" alt="${escapeHTML(s.name)}">` : '<span>No photo available</span>'}</div>
        <h3>${escapeHTML(s.name)}</h3><dl><div><dt>Price</dt><dd>${money(s.price)}</dd></div><div><dt>Duration</dt><dd>${escapeHTML(s.durationMinutes)} minutes</dd></div><div><dt>Status</dt><dd>${s.active ? "Active" : "Archived"}</dd></div></dl>
        <div class="form-actions"><button class="secondary-btn" type="button" data-close>Close</button></div></div>`);
    }

    function serviceForm(service) {
      const { element, close } = openDialog(`
        <form>
          <h2>${service ? `Edit ${escapeHTML(service.name)}` : "Add a service"}</h2>
          <label for="sfName">Name *</label><input id="sfName" name="name" maxlength="60" required value="${escapeHTML(service?.name || "")}">
          <label for="sfImageFile">Haircut picture (JPG, PNG, WebP, up to 3 MB)</label><input id="sfImageFile" type="file" accept="image/png,image/jpeg,image/webp">
          <div id="sfImagePreview" style="margin-top:10px"></div>
          <div class="form-grid">
            <div><label for="sfPrice">Price (₱) *</label><input id="sfPrice" name="price" type="number" min="0" step="0.01" required value="${service?.price ?? ""}"></div>
            <div><label for="sfDuration">Duration (minutes) *</label><input id="sfDuration" name="durationMinutes" type="number" min="5" max="480" required value="${service?.durationMinutes ?? 30}"></div>
          </div>
          <div class="form-actions">
            <button class="primary-btn" type="submit">${service ? "Save changes" : "Add service"}</button>
            <button class="secondary-btn" type="button" data-close>Cancel</button>
          </div>
          <p class="message" id="sfMessage"></p>
        </form>`);

      const fileInput = element.querySelector("#sfImageFile");
      const preview = element.querySelector("#sfImagePreview");
      let objectURL = "";
      function showPreview(url) {
        preview.replaceChildren();
        if (!url) return;
        const img = document.createElement("img");
        img.src = url;
        img.alt = "Haircut photo preview";
        img.style.cssText = "width:130px;height:100px;object-fit:cover;border-radius:9px;border:1px solid #e5e0d8";
        preview.append(img);
      }
      showPreview(App.safePhoto(service?.imageUrl));
      fileInput.addEventListener("change", () => {
        if (objectURL) URL.revokeObjectURL(objectURL);
        objectURL = fileInput.files[0] ? URL.createObjectURL(fileInput.files[0]) : "";
        showPreview(objectURL || App.safePhoto(service?.imageUrl));
      });
      element.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const f = event.target;
        const data = { name: f.elements.namedItem("name").value, price: Number(f.elements.namedItem("price").value), durationMinutes: Number(f.elements.namedItem("durationMinutes").value), imageUrl: service?.imageUrl || "" };

        await busy(event.submitter, async () => {
          try {
            const file = fileInput.files[0];
            if (file) {
              if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024 || !file.size) {
                throw new Error("Choose a JPG, PNG, or WebP image no larger than 3 MB.");
              }
              const response = await fetch("/api/services/images", {
                method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type }, body: file
              });
              const uploaded = await response.json().catch(() => ({}));
              if (response.status === 404) throw new Error("Image upload API not found. Restart the backend server to load the updated services route, then try again.");
              if (!response.ok || !uploaded.imageUrl) throw new Error(uploaded.error || "Image upload failed.");
              data.imageUrl = uploaded.imageUrl;
            }
            await api(service ? `/api/services/${service.id}` : "/api/services", { method: service ? "PATCH" : "POST", body: { ...data, active: service ? service.active : true } });
            if (objectURL) URL.revokeObjectURL(objectURL);
            close();
            await load();
            toast(`${data.name} saved.`);
          } catch (error) {
            setMessage(element.querySelector("#sfMessage"), error.message, "error");
          }
        });
      });
    }

    actions.querySelector("#addService").addEventListener("click", () => serviceForm(null));

    body.addEventListener("click", async event => {
      const button = event.target.closest("button");
      if (!button) return;
      const id = button.dataset.view || button.dataset.edit || button.dataset.archive || button.dataset.restore;
      const service = list.find(s => s.id === id);
      if (!service) return;
      try {
        if (button.dataset.view) serviceDetails(service);
        else if (button.dataset.edit && service.active) serviceForm(service);
        else if (button.dataset.archive && service.active) {
          if (!await confirmDialog(`Archive ${service.name}? Customers won't be able to choose it for new bookings. Previous visits and payments will remain unchanged. You can restore it later.`, { title: "Archive service", confirmText: "Archive", danger: true })) return;
          await busy(button, () => api(`/api/services/${service.id}`, { method: "DELETE" }));
          await load();
          toast(`${service.name} archived.`);
        } else if (button.dataset.restore && !service.active) {
          if (!await confirmDialog(`Restore ${service.name}? It will be available for new bookings again.`, { title: "Restore service", confirmText: "Restore" })) return;
          await busy(button, () => api(`/api/services/${service.id}`, { method: "PATCH", body: { ...service, active: true } }));
          await load();
          toast(`${service.name} restored.`);
        }
      } catch (error) {
        toast(error.message, "error");
      }
    });

    await load();
  }

  window.AdminManageServices = { render: services };
})();
 