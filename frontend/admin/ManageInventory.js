// Admin Inventory CRUD module, extracted from AdminPage.js.
(function () {
  "use strict";
  const { api, escapeHTML, money, setMessage, openDialog, confirmDialog, toast, busy } = App;
  const { emptyRow } = Desk;
  const barChart = (...args) => window.AdminAnalytics.barChart(...args);

  // ---------- Inventory ----------

  async function inventory(body, actions) {
    actions.innerHTML = '<button class="primary-btn" type="button" id="addItem">+ Add a product</button>';
    body.innerHTML = `
      <article class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Product</th><th>Category</th><th>Unit</th><th>In stock</th><th>Minimum</th><th>Price</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody id="itemRows"></tbody>
          </table>
        </div>
      </article>
      <article class="card spaced">
        <div class="card-heading"><h2>Products sold per month</h2><span class="muted">${new Date().getFullYear()}</span></div>
        <div id="monthlyChart"></div>
      </article>`;

    let list = [];

    async function load() {
      const [items, monthly] = await Promise.all([api("/api/inventory"), api("/api/analytics/inventory-monthly")]);
      list = items;

      body.querySelector("#itemRows").innerHTML = list.length ? list.map(i => `
        <tr class="${i.lowStock ? "long-wait" : ""}">
          <td><strong>${escapeHTML(i.name)}</strong></td>
          <td>${escapeHTML(i.category || "—")}</td><td>${escapeHTML(i.unit || "pcs")}</td>
          <td>${i.quantity}</td>
          <td>${i.minimumStock}</td>
          <td>${money(i.price)}</td>
          <td>${i.quantity < 1 ? '<span class="status-pill no-show">Out of stock</span>' : i.lowStock ? '<span class="status-pill waiting">Low stock</span>' : '<span class="status-pill completed">OK</span>'}</td>
          <td class="row-actions">
            <button class="primary-btn small" type="button" data-restock="${i.id}">+ Stock</button>
            <button class="secondary-btn small" type="button" data-edit="${i.id}">Edit</button>
            <button class="danger-btn small" type="button" data-delete="${i.id}">Delete</button>
          </td>
        </tr>`).join("") : emptyRow(8, "No products yet. Click “Add a product”.");

      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      body.querySelector("#monthlyChart").innerHTML = barChart(monthly.months.map(m => ({ label: months[m.month - 1], count: m.sold })), "No products sold this year yet.");
    }

    async function saveItem(item, data) {
      return api(item ? `/api/inventory/${item.id}` : "/api/inventory", { method: item ? "PATCH" : "POST", body: data });
    }

    function itemForm(item) {
      const { element, close } = openDialog(`
        <form>
          <h2>${item ? `Edit ${escapeHTML(item.name)}` : "Add a product"}</h2>
          <div class="form-grid">
            <div><label for="ifName">Name *</label><input id="ifName" name="name" maxlength="100" required value="${escapeHTML(item?.name || "")}"></div>
            <div><label for="ifCategory">Category</label><input id="ifCategory" name="category" maxlength="60" placeholder="e.g. Hair products" value="${escapeHTML(item?.category || "")}"></div>
            <div><label for="ifUnit">Stock unit</label><select id="ifUnit" name="unit"><option value="pcs" ${!item?.unit||item.unit==="pcs"?"selected":""}>Pieces</option><option value="g" ${item?.unit==="g"?"selected":""}>Grams (g)</option><option value="ml" ${item?.unit==="ml"?"selected":""}>Milliliters (ml)</option></select></div>
            <div><label for="ifQty">In stock *</label><input id="ifQty" name="quantity" type="number" min="0" required value="${item?.quantity ?? 0}"></div>
            <div><label for="ifMin">Warn when stock is at or below *</label><input id="ifMin" name="minimumStock" type="number" min="0" required value="${item?.minimumStock ?? 5}"></div>
            <div><label for="ifPrice">Selling price (₱) *</label><input id="ifPrice" name="price" type="number" min="0" step="0.01" required value="${item?.price ?? ""}"></div>
          </div>
          <div class="form-actions">
            <button class="primary-btn" type="submit">${item ? "Save changes" : "Add product"}</button>
            <button class="secondary-btn" type="button" data-close>Cancel</button>
          </div>
          <p class="message" id="ifMessage"></p>
        </form>`);

      element.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const f = event.target;
        const data = {
          name: f.elements.namedItem("name").value,
          category: f.elements.namedItem("category").value,
          quantity: Number(f.elements.namedItem("quantity").value),
          minimumStock: Number(f.elements.namedItem("minimumStock").value),
          price: Number(f.elements.namedItem("price").value),
          unit: f.elements.namedItem("unit").value
        };

        await busy(event.submitter, async () => {
          try {
            await saveItem(item, data);
            close();
            await load();
            toast(`${data.name} saved.`);
          } catch (error) {
            setMessage(element.querySelector("#ifMessage"), error.message, "error");
          }
        });
      });
    }

    // Quick restock: add delivered items without editing the whole product.
    function restockForm(item) {
      const { element, close } = openDialog(`
        <form>
          <h2>Add stock: ${escapeHTML(item.name)}</h2>
          <p class="muted">Currently ${item.quantity} in stock.</p>
          <label for="rsQty">How many arrived? *</label>
          <input id="rsQty" name="added" type="number" min="1" max="10000" required value="1">
          <div class="form-actions">
            <button class="primary-btn" type="submit">Add to stock</button>
            <button class="secondary-btn" type="button" data-close>Cancel</button>
          </div>
          <p class="message" id="rsMessage"></p>
        </form>`);

      element.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const added = Number(event.target.elements.namedItem("added").value);
        await busy(event.submitter, async () => {
          try {
            await saveItem(item, { name: item.name, category: item.category, quantity: item.quantity + added, minimumStock: item.minimumStock, price: item.price });
            close();
            await load();
            toast(`Added ${added} × ${item.name}. Now ${item.quantity + added} in stock.`);
          } catch (error) {
            setMessage(element.querySelector("#rsMessage"), error.message, "error");
          }
        });
      });
    }

    actions.querySelector("#addItem").addEventListener("click", () => itemForm(null));

    body.addEventListener("click", async event => {
      const button = event.target.closest("button");
      const item = button && list.find(i => i.id === (button.dataset.edit || button.dataset.delete || button.dataset.restock));
      if (!item) return;

      try {
        if (button.dataset.restock) restockForm(item);
        else if (button.dataset.edit) itemForm(item);
        else {
          if (!await confirmDialog(`Delete ${item.name}? Past sales stay in the reports.`, { title: "Delete product", confirmText: "Delete", danger: true })) return;
          await api(`/api/inventory/${item.id}`, { method: "DELETE" });
          await load();
          toast(`${item.name} deleted.`);
        }
      } catch (error) {
        toast(error.message, "error");
      }
    });

    await load();
  }

  window.AdminManageInventory = { render: inventory };
})();
