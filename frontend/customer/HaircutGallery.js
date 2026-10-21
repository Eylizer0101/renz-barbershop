// Reusable haircut selector; uses actual service photos configured by the admin.
(function () {
  function render(container,services,onSelect,selectedId='') {
    const {escapeHTML,safePhoto,money}=App;
    container.innerHTML=`<div class="haircut-gallery">${services.map(s=>{
      const src=safePhoto(s.imageUrl);
      return `<button type="button" class="haircut-card${selectedId===s.id?' selected':''}" data-haircut="${s.id}" aria-pressed="${selectedId===s.id}">
        <div class="haircut-picture">${src?`<img src="${escapeHTML(src)}" alt="${escapeHTML(s.name)} haircut" loading="lazy">`:'<span>Photo coming soon</span>'}</div>
        <strong>${escapeHTML(s.name)}</strong><span>${money(s.price)} · ${s.durationMinutes} min</span><small>Select haircut</small></button>`;
    }).join('')}</div>`;
    container.querySelectorAll('[data-haircut]').forEach(button=>button.addEventListener('click',()=>{
      const selected=services.find(s=>s.id===button.dataset.haircut);
      container.querySelectorAll('[data-haircut]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});
      if(selected)onSelect(selected);
    }));
  }
  window.HaircutGallery={render};
})();
