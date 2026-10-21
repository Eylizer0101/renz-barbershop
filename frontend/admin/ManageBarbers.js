// Admin Barber Management: extracted from AdminPage.js without changing its CRUD behavior.
// Loaded before AdminPage.js by shared/router.js.
(function () {
  "use strict";
  const { api, escapeHTML, setMessage, openDialog, confirmDialog, toast, busy } = App;

  // ---------- Barbers ----------

  async function barbers(body, actions) {
    actions.classList.add("barber-header-controls");
    actions.innerHTML = `<button class="primary-btn" type="button" id="addBarber">+ Add a barber</button>
      <span class="barber-header-divider" aria-hidden="true"></span>
      <div class="barber-view-tabs" role="group" aria-label="Barber list">
        <button class="barber-view-tab active" type="button" data-barber-tab="active" aria-pressed="true">Active <span id="activeBarberCount">0</span></button>
        <button class="barber-view-tab" type="button" data-barber-tab="archived" aria-pressed="false">Archived <span id="archivedBarberCount">0</span></button>
      </div>`;
    body.innerHTML = '<div class="barber-grid admin-barber-grid" id="barberGrid" aria-live="polite"></div>';
    let list = [];
    let currentTab = "active";
    const addButton = actions.querySelector("#addBarber");
    const MAX_ACTIVE_BARBERS = 3;

    function cardActions(b) {
      if (!b.active) return `<button class="secondary-btn barber-restore" type="button" data-restore="${b.id}">Restore barber</button>`;

      return `
        <button class="secondary-btn" type="button" data-edit="${b.id}">Edit</button>
        ${b.status !== "busy" ? `<button class="secondary-btn" type="button" data-duty="${b.id}">${b.available ? "Set off duty" : "Set on duty"}</button>` : ""}
        <button class="danger-btn" type="button" data-remove="${b.id}">Remove</button>`;
    }

    function renderList() {
      const activeCount = list.filter(b => b.active).length;
      const archivedCount = list.length - activeCount;
      actions.querySelector("#activeBarberCount").textContent = activeCount;
      actions.querySelector("#archivedBarberCount").textContent = archivedCount;
      addButton.disabled = activeCount >= MAX_ACTIVE_BARBERS;
      addButton.title = addButton.disabled ? "Maximum of 3 active barbers reached." : "Add a barber";
      actions.querySelectorAll("[data-barber-tab]").forEach(tab => {
        const selected = tab.dataset.barberTab === currentTab;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-pressed", String(selected));
      });
      const visible = list.filter(b => currentTab === "active" ? b.active : !b.active);
      body.querySelector("#barberGrid").innerHTML = visible.length
        ? visible.map(b => App.barberCard(b, cardActions(b))).join("")
        : `<div class="empty-state">${currentTab === "active" ? "No active barbers yet." : "No archived barbers yet."}</div>`;
    }

    async function load() {
      list = await api("/api/barbers/all");
      renderList();
    }

    function barberForm(barber) {
      const { element, close } = openDialog(`
        <form class="barber-editor">
          <div class="barber-editor__heading"><div><span class="eyebrow">BARBER PROFILE</span><h2>${barber ? `Edit ${escapeHTML(barber.name)}` : "Add a barber"}</h2><p class="muted">Keep your barber's information and photo up to date.</p></div></div>
          <div class="barber-editor__photo-area"><div class="barber-editor__preview" id="bfPreview">${App.safePhoto(barber?.photoUrl) ? `<img src="${escapeHTML(App.safePhoto(barber.photoUrl))}" alt="Current barber photo">` : '<span aria-hidden="true">✂</span>'}</div><div class="barber-editor__photo-control"><label for="bfPhoto">Upload Photo</label><input id="bfPhoto" name="photo" type="file" accept="image/jpeg,image/png,image/webp"><small>JPEG, PNG or WebP · up to 2 MB. Leave empty to keep the current photo.</small></div></div>
          <div class="form-grid">
            <div><label for="bfName">Full name *</label><input id="bfName" name="name" maxlength="60" required value="${escapeHTML(barber?.name || "")}"></div>
            <div><label for="bfSpecialty">Specialty</label><input id="bfSpecialty" name="specialty" maxlength="80" placeholder="e.g. Fades and classic cuts" value="${escapeHTML(barber?.specialty === "General Barber" ? "" : barber?.specialty || "")}"></div>
            <div><label for="bfYears">Years of experience</label><input id="bfYears" name="experienceYears" type="number" min="0" max="60" value="${barber?.experienceYears || 0}"></div>
            <div class="full"><label for="bfBio">Short biography</label><textarea id="bfBio" name="bio" maxlength="500" rows="3">${escapeHTML(barber?.bio || "")}</textarea></div>
          </div>
          <div class="form-actions">
            <button class="primary-btn" type="submit">${barber ? "Save changes" : "Add barber"}</button>
            <button class="secondary-btn" type="button" data-close>Cancel</button>
          </div>
          <p class="message" id="bfMessage"></p>
        </form>`);

      const photoInput = element.querySelector("#bfPhoto");
      const preview = element.querySelector("#bfPreview");
      let previewRequest = 0;
      photoInput.addEventListener("change", () => {
        const request = ++previewRequest;
        const file = photoInput.files?.[0];
        if (!file) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
          photoInput.value = "";
          setMessage(element.querySelector("#bfMessage"), "Choose a JPEG, PNG, or WebP photo up to 2 MB.", "error");
          return;
        }
        setMessage(element.querySelector("#bfMessage"), "");
        // The server's image CSP permits data: URLs, but not blob: URLs.
        const reader = new FileReader();
        reader.onload = () => {
          if (request !== previewRequest) return;
          const img = document.createElement("img");
          img.alt = "New barber photo preview";
          img.src = reader.result;
          img.onerror = () => setMessage(element.querySelector("#bfMessage"), "Unable to preview this photo. Please choose another image.", "error");
          preview.replaceChildren(img);
        };
        reader.onerror = () => {
          if (request === previewRequest) setMessage(element.querySelector("#bfMessage"), "Unable to read the selected photo.", "error");
        };
        reader.readAsDataURL(file);
      });
      element.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault();
        const f = event.target;
        const data = {
          name: f.elements.namedItem("name").value,
          specialty: f.elements.namedItem("specialty").value,
          photoUrl: barber?.photoUrl || "",
          experienceYears: Number(f.elements.namedItem("experienceYears").value),
          bio: f.elements.namedItem("bio").value
        };

        await busy(event.submitter, async () => {
          try {
            const file = photoInput.files?.[0];
            if (file) {
              data.photoData = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error("Unable to read the selected photo."));
                reader.readAsDataURL(file);
              });
            }
            await api(barber ? `/api/barbers/${barber.id}` : "/api/barbers", { method: barber ? "PATCH" : "POST", body: data });
            close();
            await load();
            toast(barber ? `${data.name} updated.` : `${data.name} added.`);
          } catch (error) {
            setMessage(element.querySelector("#bfMessage"), error.message, "error");
          }
        });
      });
    }

    addButton.addEventListener("click", () => {
      if (list.filter(b => b.active).length >= MAX_ACTIVE_BARBERS) {
        toast("Maximum of 3 active barbers reached. Archive one before adding another.", "error");
        return;
      }
      barberForm(null);
    });
    actions.querySelectorAll("[data-barber-tab]").forEach(tab => tab.addEventListener("click", () => {
      currentTab = tab.dataset.barberTab;
      renderList();
    }));

    body.addEventListener("click", async event => {
      const button = event.target.closest("button");
      if (!button) return;
      const id = button.dataset.edit || button.dataset.duty || button.dataset.remove || button.dataset.restore;
      const barber = list.find(b => b.id === id);
      if (!barber) return;

      try {
        if (button.dataset.edit) barberForm(barber);
        else if (button.dataset.duty) {
          await busy(button, () => api(`/api/barbers/${id}/availability`, { method: "PATCH", body: { available: !barber.available } }));
          await load();
          toast(`${barber.name} is now ${barber.available ? "off duty" : "on duty"}.`);
        } else if (button.dataset.remove) {
          if (!await confirmDialog(`Remove ${barber.name}? Customers waiting for them can then be served by anyone. Past visits are kept, and you can restore them later.`, { title: "Remove barber", confirmText: "Remove", danger: true })) return;
          const result = await api(`/api/barbers/${id}`, { method: "DELETE" });
          currentTab = "archived";
          await load();
          toast(result.message);
        } else if (button.dataset.restore) {
          if (list.filter(b => b.active).length >= MAX_ACTIVE_BARBERS) {
            toast("Maximum of 3 active barbers reached. Archive one before restoring another.", "error");
            return;
          }
          if (!await confirmDialog(`Restore ${barber.name} to the active barber list?`, { title: "Restore barber", confirmText: "Restore barber" })) return;
          await busy(button, () => api(`/api/barbers/${id}`, { method: "PATCH", body: { ...barber, active: true } }));
          currentTab = "active";
          await load();
          toast(`${barber.name} restored.`);
        }
      } catch (error) {
        toast(error.message, "error");
      }
    });

    await load();
  }

  window.AdminManageBarbers = { render: barbers };
})();
