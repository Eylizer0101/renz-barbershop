// Admin Inventory CRUD module, extracted from AdminPage.js.
(function () {
  "use strict";
  const { api, escapeHTML, money, setMessage, openDialog, confirmDialog, toast, busy } = App;
  const { emptyRow } = Desk;
  // Inventory's monthly chart is self-contained; AdminAnalytics only exports render().
  function barChart(values, emptyMessage) {
    const rows = Array.isArray(values) ? values : [];
    const max = Math.max(0, ...rows.map(row => Number(row.count) || 0));
    if (!max) return `<p class="muted small" style="padding:20px 0;text-align:center">${escapeHTML(emptyMessage)}</p>`;
    return `<div class="bar-chart" role="img" aria-label="Monthly product sales">${rows.map(row => {
      const count = Math.max(0, Number(row.count) || 0);
      const height = Math.max(2, count / max * 100);
      return `<div class="bar-col" title="${escapeHTML(row.label)}: ${count} sold"><span class="bar-value">${count}</span><div class="bar" style="height:${height}%"></div><span class="bar-label">${escapeHTML(row.label)}</span></div>`;
    }).join("")}</div>`;
  }

  // ---------- Inventory ----------
  async function inventory(body, actions) {
    actions.innerHTML = `<button class="primary-btn" type="button" id="addItem">+ Add a product</button>
      <span class="inventory-actions-divider" aria-hidden="true"></span>
      <div class="inventory-tabs" role="group" aria-label="Inventory list">
        <button type="button" class="inventory-tab active" data-inventory-tab="active" aria-pressed="true">Active <span id="inventoryActiveCount">0</span></button>
        <button type="button" class="inventory-tab" data-inventory-tab="archived" aria-pressed="false">Archived <span id="inventoryArchivedCount">0</span></button>
      </div>`;
    body.innerHTML = `
      <section class="inventory-stats" aria-label="Inventory summary">
        <article class="inventory-stat"><span>Total Products</span><strong id="invTotal">0</strong><small>Active products</small></article>
        <article class="inventory-stat"><span>In Stock</span><strong id="invAvailable">0</strong><small>Healthy stock levels</small></article>
        <article class="inventory-stat inventory-stat-warning"><span>Low Stock</span><strong id="invLow">0</strong><small>Restock recommended</small></article>
        <article class="inventory-stat inventory-stat-danger"><span>Out of Stock</span><strong id="invOut">0</strong><small>Needs attention</small></article>
      </section>
      <section class="card inventory-filter-card" aria-label="Filter inventory">
        <label class="inventory-search-field"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input type="search" id="invSearch" placeholder="Search product or supplier..." aria-label="Search products"></label>
        <select id="invCategory" aria-label="Category"><option value="all">All Categories</option></select>
        <select id="invStatus" aria-label="Stock status"><option value="all">All Stock Status</option><option value="in">In Stock</option><option value="low">Low Stock</option><option value="out">Out of Stock</option></select>
        <select id="invSort" aria-label="Sort inventory"><option value="name">Name A - Z</option><option value="name-desc">Name Z - A</option><option value="low-first">Lowest Stock First</option><option value="high-first">Highest Stock First</option><option value="value">Highest Stock Value</option></select>
        <button class="secondary-btn inventory-clear" id="invClear" type="button" hidden>Clear</button>
      </section>
      <article class="card inventory-table-card">
        <div class="inventory-table-heading"><div><h2 id="invTableTitle">Active Products</h2><p>Manage supplies, product details, availability and stock movements.</p></div><span id="invResultCount" aria-live="polite"></span></div>
        <div class="table-wrap"><table class="data-table inventory-table"><thead><tr><th>No.</th><th>Product</th><th>Category</th><th>Stock</th><th>Unit</th><th>Min.</th><th>Unit Cost</th><th>Stock Value</th><th>Supplier</th><th>Status</th><th>Actions</th></tr></thead><tbody id="itemRows"></tbody></table></div>
        <div class="inventory-pagination"><span id="invSummary"></span><div><button type="button" class="secondary-btn small" id="invPrevious">Previous</button><span id="invPage"></span><button type="button" class="secondary-btn small" id="invNext">Next</button></div></div>
      </article>
      <article class="card spaced inventory-chart-card"><div class="card-heading"><h2>Products sold per month</h2><span class="muted">${new Date().getFullYear()}</span></div><div id="monthlyChart"></div></article>`;

    let list = [], currentTab = "active", page = 1;
    const pageSize = 10;
    const $ = id => body.querySelector("#" + id);
    const search = $("invSearch"), category = $("invCategory"), status = $("invStatus"), sort = $("invSort");
    const stockStatus = item => item.quantity <= 0 ? "out" : item.quantity <= item.minimumStock ? "low" : "in";
    const statusLabel = item => stockStatus(item) === "out" ? "Out of Stock" : stockStatus(item) === "low" ? "Low Stock" : "In Stock";
    const svgIcons = {
      view: '<circle cx="12" cy="12" r="3"/><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/>',
      edit: '<path d="M12 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 4 4 4-9 9-4 1 1-4 9-9a2.8 2.8 0 0 1 4 4"/>',
      more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
      restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'
    };
    const icon = name => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svgIcons[name]}</svg>`;
    const iconButton = (type, item, text) => `<button type="button" class="inventory-icon-btn" data-inv-${type}="${escapeHTML(item.id)}" title="${text}" aria-label="${text} ${escapeHTML(item.name)}">${icon(type === "restore" ? "restore" : type)}</button>`;

    function filteredList() {
      let result = list.filter(item => (item.active !== false) === (currentTab === "active"));
      const q = search.value.trim().toLocaleLowerCase();
      if (q) result = result.filter(item => `${item.name} ${item.category || ""} ${item.supplier || ""}`.toLocaleLowerCase().includes(q));
      if (category.value !== "all") result = result.filter(item => (item.category || "") === category.value);
      if (status.value !== "all") result = result.filter(item => stockStatus(item) === status.value);
      result.sort((a, b) => {
        const nameCompare = String(a.name).localeCompare(String(b.name));
        switch (sort.value) {
          case "name-desc": return -nameCompare;
          case "low-first": return a.quantity - b.quantity || nameCompare;
          case "high-first": return b.quantity - a.quantity || nameCompare;
          case "value": return (b.quantity * (b.unitCost || 0)) - (a.quantity * (a.unitCost || 0)) || nameCompare;
          default: return nameCompare;
        }
      });
      return result;
    }
    function draw() {
      const active = list.filter(item => item.active !== false);
      $("invTotal").textContent = active.length;
      $("invAvailable").textContent = active.filter(item => stockStatus(item) === "in").length;
      $("invLow").textContent = active.filter(item => stockStatus(item) === "low").length;
      $("invOut").textContent = active.filter(item => stockStatus(item) === "out").length;
      actions.querySelector("#inventoryActiveCount").textContent = active.length;
      actions.querySelector("#inventoryArchivedCount").textContent = list.length - active.length;
      actions.querySelectorAll("[data-inventory-tab]").forEach(tab => { const on = tab.dataset.inventoryTab === currentTab; tab.classList.toggle("active", on); tab.setAttribute("aria-pressed", String(on)); });
      $("invClear").hidden = !(search.value || category.value !== "all" || status.value !== "all" || sort.value !== "name");
      $("invTableTitle").textContent = currentTab === "active" ? "Active Products" : "Archived Products";
      const filtered = filteredList();
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      page = Math.min(page, pages);
      const start = (page - 1) * pageSize;
      const visible = filtered.slice(start, start + pageSize);
      $("invResultCount").textContent = `${filtered.length} product${filtered.length === 1 ? "" : "s"}`;
      $("itemRows").innerHTML = visible.length ? visible.map((item, idx) => {
        const state = stockStatus(item);
        const actionsHTML = currentTab === "archived" ? iconButton("view", item, "View") + iconButton("restore", item, "Restore") :
          iconButton("view", item, "View") + iconButton("edit", item, "Edit") + `<button type="button" class="inventory-icon-btn" data-inv-more="${escapeHTML(item.id)}" title="More actions" aria-label="More actions for ${escapeHTML(item.name)}">${icon("more")}</button>`;
        return `<tr><td>${start + idx + 1}</td><td class="inventory-product-name"><strong>${escapeHTML(item.name)}</strong><small>Selling price ${money(item.price)}</small></td><td>${escapeHTML(item.category || "—")}</td><td><strong>${Number(item.quantity)}</strong></td><td>${escapeHTML(item.unit || "pcs")}</td><td>${Number(item.minimumStock)}</td><td>${money(item.unitCost || 0)}</td><td><strong>${money((item.unitCost || 0) * item.quantity)}</strong></td><td>${escapeHTML(item.supplier || "—")}</td><td><span class="inventory-stock-tag inventory-stock-${state}">${item.active === false ? "Archived" : statusLabel(item)}</span></td><td class="row-actions"><span class="inventory-action-group">${actionsHTML}</span></td></tr>`;
      }).join("") : emptyRow(11, "No matching products found.");
      $("invSummary").textContent = `Showing ${filtered.length ? start + 1 : 0}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`;
      $("invPage").textContent = `Page ${page} of ${pages}`;
      $("invPrevious").disabled = page <= 1;
      $("invNext").disabled = page >= pages;
    }
    async function load() {
      const items = await api("/api/inventory");
      list = Array.isArray(items) ? items : [];
      const categories = [...new Set(list.map(i => i.category || "").filter(Boolean))].sort();
      const selectedCategory = category.value;
      category.innerHTML = '<option value="all">All Categories</option>' + categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
      category.value = categories.includes(selectedCategory) ? selectedCategory : "all";
      draw();
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      // A chart request failure must not hide the inventory table or its actions.
      try {
        const monthly = await api("/api/analytics/inventory-monthly");
        $("monthlyChart").innerHTML = barChart((monthly.months || []).map(m => ({ label: months[m.month - 1], count: m.sold })), "No products sold this year yet.");
      } catch (error) {
        $("monthlyChart").innerHTML = `<p class="muted small" style="padding:20px 0;text-align:center">Monthly sales chart is unavailable right now.</p>`;
        console.error("Inventory monthly chart:", error);
      }
    }
    function details(item) {
      openDialog(`<div class="inventory-detail-dialog"><h2>Product Details</h2><h3>${escapeHTML(item.name)}</h3><dl>
        <div><dt>Category</dt><dd>${escapeHTML(item.category || "—")}</dd></div><div><dt>Available Stock</dt><dd>${item.quantity} ${escapeHTML(item.unit || "pcs")}</dd></div><div><dt>Minimum Stock</dt><dd>${item.minimumStock}</dd></div><div><dt>Unit Cost</dt><dd>${money(item.unitCost || 0)}</dd></div><div><dt>Stock Value</dt><dd>${money(item.quantity * (item.unitCost || 0))}</dd></div><div><dt>Selling Price</dt><dd>${money(item.price)}</dd></div><div><dt>Supplier</dt><dd>${escapeHTML(item.supplier || "—")}</dd></div><div><dt>Status</dt><dd>${item.active === false ? "Archived" : statusLabel(item)}</dd></div>
      </dl><div class="form-actions"><button type="button" class="secondary-btn" data-close>Close</button></div></div>`);
    }
    function itemForm(item) {
      const { element, close } = openDialog(`<form class="inventory-editor"><h2>${item ? `Edit ${escapeHTML(item.name)}` : "Add a product"}</h2><p class="muted">Keep stock and pricing details accurate.</p><div class="form-grid">
        <div><label for="ifName">Product name *</label><input id="ifName" name="name" maxlength="100" required value="${escapeHTML(item?.name || "")}"></div>
        <div><label for="ifCategory">Category</label><input id="ifCategory" name="category" maxlength="60" placeholder="e.g. Hair care" value="${escapeHTML(item?.category || "")}"></div>
        <div><label for="ifUnit">Stock unit *</label><select id="ifUnit" name="unit"><option value="pcs" ${!item?.unit || item.unit === "pcs" ? "selected" : ""}>Pieces (pcs)</option><option value="g" ${item?.unit === "g" ? "selected" : ""}>Grams (g)</option><option value="ml" ${item?.unit === "ml" ? "selected" : ""}>Milliliters (ml)</option><option value="bottles" ${item?.unit === "bottles" ? "selected" : ""}>Bottles</option><option value="boxes" ${item?.unit === "boxes" ? "selected" : ""}>Boxes</option><option value="packs" ${item?.unit === "packs" ? "selected" : ""}>Packs</option><option value="jars" ${item?.unit === "jars" ? "selected" : ""}>Jars</option><option value="cans" ${item?.unit === "cans" ? "selected" : ""}>Cans</option></select></div>
        <div><label for="ifQty">In stock *</label><input id="ifQty" name="quantity" type="number" min="0" required value="${item?.quantity ?? 0}"></div>
        <div><label for="ifMin">Minimum Stock *</label><input id="ifMin" name="minimumStock" type="number" min="0" required value="${item?.minimumStock ?? 5}"></div>
        <div><label for="ifPrice">Selling Price (₱) *</label><input id="ifPrice" name="price" type="number" min="0" step="0.01" required value="${item?.price ?? ""}"></div>
        <div><label for="ifCost">Unit Cost (₱)</label><input id="ifCost" name="unitCost" type="number" min="0" step="0.01" value="${item?.unitCost ?? 0}"></div>
        <div><label for="ifSupplier">Supplier</label><input id="ifSupplier" name="supplier" maxlength="100" placeholder="Supplier name (optional)" value="${escapeHTML(item?.supplier || "")}"></div></div>
        <div class="form-actions"><button type="submit" class="primary-btn">${item ? "Save changes" : "Add product"}</button><button type="button" class="secondary-btn" data-close>Cancel</button></div><p class="message" id="ifMessage" role="status"></p></form>`);
      element.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = Object.fromEntries(new FormData(form).entries());
        const data = { name: values.name, category: values.category, unit: values.unit, quantity: Number(values.quantity), minimumStock: Number(values.minimumStock), price: Number(values.price), unitCost: Number(values.unitCost), supplier: values.supplier };
        await busy(event.submitter, async () => { try {
          await api(item ? `/api/inventory/${item.id}` : "/api/inventory", { method: item ? "PATCH" : "POST", body: data });
          close(); await load(); toast(`${data.name} saved.`);
        } catch (error) { setMessage(element.querySelector("#ifMessage"), error.message, "error"); } });
      });
    }
    function stockForm(item, direction) {
      const isOut = direction === "out";
      const { element, close } = openDialog(`<form class="inventory-editor"><h2>${isOut ? "Stock Out" : "Stock In"}: ${escapeHTML(item.name)}</h2><p class="muted">Currently ${item.quantity} ${escapeHTML(item.unit || "pcs")} in stock.</p>
        <label for="stockQty">Quantity *</label><input id="stockQty" name="quantity" type="number" min="1" ${isOut ? `max="${item.quantity}"` : 'max="100000"'} required value="1">
        <label for="stockReason">Reason ${isOut ? "*" : "(optional)"}</label><input id="stockReason" name="reason" maxlength="200" ${isOut ? "required" : ""} placeholder="${isOut ? "e.g. Used for service" : "e.g. New delivery"}">
        <div class="form-actions"><button class="primary-btn" type="submit">${isOut ? "Confirm Stock Out" : "Add Stock"}</button><button class="secondary-btn" type="button" data-close>Cancel</button></div><p class="message" id="stockMessage" role="status"></p></form>`);
      element.querySelector("form").addEventListener("submit", async event => { event.preventDefault(); const f = event.currentTarget;
        await busy(event.submitter, async () => { try {
          await api(`/api/inventory/${item.id}/stock`, { method: "POST", body: { type: direction, quantity: Number(f.elements.namedItem("quantity").value), reason: f.elements.namedItem("reason").value } });
          close(); await load(); toast(`${item.name} stock updated.`);
        } catch (error) { setMessage(element.querySelector("#stockMessage"), error.message, "error"); } });
      });
    }
    async function history(item) {
      const { element } = openDialog(`<div class="inventory-detail-dialog"><h2>Stock History</h2><p class="muted">${escapeHTML(item.name)} · Latest 100 movements</p><div id="invHistoryRows" class="inventory-history">Loading history…</div><div class="form-actions"><button type="button" class="secondary-btn" data-close>Close</button></div></div>`);
      try {
        const events = await api(`/api/inventory/${item.id}/history`);
        const rows = element.querySelector("#invHistoryRows");
        if (!rows) return;
        rows.innerHTML = events.length ? events.map(e => `<div class="inventory-history-row"><span><strong>${escapeHTML(e.type.replace(/-/g, " "))}</strong><small>${escapeHTML(new Date(e.createdAt).toLocaleString("en-PH"))} · ${escapeHTML(e.actorName || "—")}</small>${e.reason ? `<small>${escapeHTML(e.reason)}</small>` : ""}</span><strong class="${e.quantityChange < 0 ? "inventory-negative" : ""}">${e.quantityChange > 0 ? "+" : ""}${e.quantityChange}</strong></div>`).join("") : '<p class="muted">No stock changes recorded yet.</p>';
      } catch (error) { const target = element.querySelector("#invHistoryRows"); if (target) target.textContent = error.message; }
    }
    actions.querySelector("#addItem").addEventListener("click", () => itemForm(null));
    actions.querySelectorAll("[data-inventory-tab]").forEach(tab => tab.addEventListener("click", () => { currentTab = tab.dataset.inventoryTab; page = 1; draw(); }));
    [search, category, status, sort].forEach(el => el.addEventListener(el === search ? "input" : "change", () => { page = 1; draw(); }));
    $("invClear").addEventListener("click", () => { search.value = ""; category.value = "all"; status.value = "all"; sort.value = "name"; page = 1; draw(); search.focus(); });
    $("invPrevious").addEventListener("click", () => { if (page > 1) { page--; draw(); } });
    $("invNext").addEventListener("click", () => { if (page < Math.ceil(filteredList().length / pageSize)) { page++; draw(); } });
    function moreActions(item) {
      const { element, close } = openDialog(`<div class="inventory-detail-dialog"><h2>${escapeHTML(item.name)}</h2><p class="muted">Choose an inventory action.</p><div class="inventory-modal-menu"><button type="button" data-action="in">+ Stock In</button><button type="button" data-action="out">− Stock Out</button><button type="button" data-action="history">Stock History</button><button type="button" class="inventory-menu-danger" data-action="archive">Archive Product</button></div><div class="form-actions"><button type="button" class="secondary-btn" data-close>Cancel</button></div></div>`);
      element.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => {
        const action = button.dataset.action; close();
        if (action === "in" || action === "out") stockForm(item, action);
        else if (action === "history") history(item);
        else if (action === "archive") archiveProduct(item, false);
      }));
    }
    async function archiveProduct(item, active) {
      const restore = active;
      try {
        if (!await confirmDialog(`${restore ? "Restore" : "Archive"} ${item.name}? ${restore ? "The product will be available again." : "This hides it from active inventory without deleting its history."}`, { title: `${restore ? "Restore" : "Archive"} product`, confirmText: restore ? "Restore" : "Archive", danger: !restore })) return;
        await api(`/api/inventory/${item.id}/archive`, { method: "PATCH", body: { active: restore } });
        await load(); toast(`${item.name} ${restore ? "restored" : "archived"}.`);
      } catch (error) { toast(error.message, "error"); }
    }
    body.addEventListener("click", async event => {
      const button = event.target.closest("button");
      if (!button) return;
      const match = Object.keys(button.dataset).find(k => /^inv(View|Edit|More|In|Out|History|Archive|Restore)$/.test(k));
      if (!match) return;
      const item = list.find(i => i.id === button.dataset[match]);
      if (!item) return;
      const action = match.slice(3).toLowerCase();
      try {
        if (action === "view") details(item);
        else if (action === "edit") itemForm(item);
        else if (action === "more") moreActions(item);
        else if (action === "in" || action === "out") stockForm(item, action);
        else if (action === "history") await history(item);
        else await archiveProduct(item, action === "restore");
      } catch (error) { toast(error.message, "error"); }
    });
    await load();
  }
  window.AdminManageInventory = { render: inventory };
})();
