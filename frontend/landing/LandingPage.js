// Renz Barbershop public landing page.
// The existing router loads this page for / and /index.html.
(function () {
  "use strict";
  document.body.innerHTML = "<header class=\"landing-nav\"><a class=\"landing-logo\" href=\"/\" aria-label=\"Renz Barbershop Home\"><span class=\"landing-scissors\"><img src=\"/images/GoldenScissors.png\" alt=\"\" aria-hidden=\"true\" decoding=\"async\"></span><span><strong>RENZ</strong><small>BARBERSHOP</small></span></a><nav aria-label=\"Main navigation\"><a href=\"#home\">Home</a><a href=\"#services\">Services</a><a href=\"#about\">About Us</a></nav><div class=\"landing-auth\"><a class=\"landing-register\" href=\"/login.html#register\">Register</a><a class=\"landing-login\" href=\"/login.html#signin\">Log In</a></div></header><main id=\"home\"><section class=\"landing-hero\"><div class=\"landing-copy\"><div class=\"landing-kicker\">WELCOME TO RENZ BARBERSHOP</div><h1>Fresh Cut.<br><em>Fresh Confidence.</em></h1><p>Great haircuts, good vibes, and a style that feels like you. Your style. Your turn. Your time.</p><div class=\"landing-actions\"><a href=\"/login.html\" data-landing-auth-modal>Book Your Cut <span aria-hidden=\"true\">→</span></a><a href=\"#services\">Explore Services</a></div><div class=\"landing-highlights\"><span>✦ Quality Haircuts</span><span>✦ Skilled Barbers</span><span>✦ Easy Booking</span></div></div><div class=\"landing-hero-photo\"><img src=\"/images/landingpage/1.png\" alt=\"Barber giving a fresh haircut\"/></div></section><section id=\"services\" class=\"landing-section landing-services\"><div class=\"landing-heading\"><span>WHAT WE DO</span><h2>Your next great look starts here.</h2><p>From a clean trim to a fresh new style, we've got you covered.</p></div><div class=\"landing-tiles\" id=\"landingServiceTiles\" aria-live=\"polite\" aria-busy=\"true\"><p class=\"landing-services-message\">Loading services...</p></div><a class=\"landing-outline\" href=\"/login.html\" data-landing-auth-modal>Get Started →</a></section><section id=\"about\" class=\"landing-about\"><div class=\"landing-about-image\"><img src=\"/images/landingpage/1.png\" alt=\"Inside Renz Barbershop\"></div><div><span class=\"landing-kicker\">MORE THAN JUST A HAIRCUT</span><h2>Look good.<br>Feel even better.</h2><p>At Renz Barbershop, every visit is about finding the look that fits you. Enjoy a welcoming space, dedicated barbers, and a simple way to plan your next visit.</p><a href=\"/login.html#register\" data-landing-auth-modal>Join Renz Barbershop →</a></div></section><section class=\"landing-cta\"><span>READY FOR A FRESH LOOK?</span><h2>Your chair is waiting.</h2><p>Start your next barbershop visit with Renz.</p><a href=\"/login.html\" data-landing-auth-modal>Get Started →</a></section></main><footer class=\"landing-footer\"><strong><img class=\"landing-footer-scissors\" src=\"/images/GoldenScissors.png\" alt=\"\" aria-hidden=\"true\"> RENZ BARBERSHOP</strong><small>© 2026 Renz Barbershop</small></footer>";


  // Public services use the same active records and uploaded photos as Admin Services.
  // The public API already filters archived services; no authentication is needed.
  const serviceTiles = document.querySelector("#landingServiceTiles");
  // Keep every active service in one horizontal row; show three cards at a time on desktop.
  const serviceViewport = document.createElement("div");
  serviceViewport.className = "landing-service-viewport";
  serviceViewport.setAttribute("role", "region");
  serviceViewport.setAttribute("aria-label", "Available barbershop services");
  serviceViewport.setAttribute("tabindex", "0");
  const serviceCarousel = document.createElement("div");
  serviceCarousel.className = "landing-service-carousel";
  const previousService = document.createElement("button");
  const nextService = document.createElement("button");
  const serviceArrows = [
    [previousService, "previous", "Previous services", "M15 19l-7-7 7-7"],
    [nextService, "next", "Next services", "M9 5l7 7-7 7"]
  ];
  serviceArrows.forEach(([button, direction, label, path]) => {
    button.type = "button";
    button.className = `landing-service-arrow landing-service-arrow-${direction}`;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-controls", "landingServiceTiles");
    button.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${path}"/></svg>`;
  });
  serviceTiles.parentNode.insertBefore(serviceCarousel, serviceTiles);
  serviceViewport.appendChild(serviceTiles);
  serviceCarousel.append(previousService, serviceViewport, nextService);

  function updateServiceArrows() {
    const maxScroll = Math.max(0, serviceViewport.scrollWidth - serviceViewport.clientWidth);
    const hasOverflow = maxScroll > 2;
    previousService.hidden = !hasOverflow;
    nextService.hidden = !hasOverflow;
    previousService.disabled = serviceViewport.scrollLeft <= 2;
    nextService.disabled = serviceViewport.scrollLeft >= maxScroll - 2;
  }
  function moveServices(direction) {
    const first = serviceTiles.querySelector(".landing-service-card");
    if (!first) return;
    const gap = parseFloat(getComputedStyle(serviceTiles).columnGap) || 0;
    serviceViewport.scrollBy({ left: direction * (first.getBoundingClientRect().width + gap), behavior: "smooth" });
  }
  previousService.addEventListener("click", () => moveServices(-1));
  nextService.addEventListener("click", () => moveServices(1));
  serviceViewport.addEventListener("scroll", updateServiceArrows, { passive: true });
  window.addEventListener("resize", updateServiceArrows);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(updateServiceArrows).observe(serviceViewport);
  }
  const serviceFallback = "/images/landingpage/2.png";
  const formatPrice = value => new Intl.NumberFormat("en-PH", {
    style: "currency", currency: "PHP", minimumFractionDigits: 2
  }).format(Number(value) || 0);
  const safeServiceImage = value => {
    if (typeof value !== "string") return serviceFallback;
    const url = value.trim();
    if (/^\/api\/services\/images\/[a-f0-9]{24}$/i.test(url) ||
        /^\/images\/[a-z0-9._/-]+$/i.test(url) ||
        /^https:\/\/[^\s]+$/i.test(url)) return url;
    return serviceFallback;
  };
  function renderPublicServices(services) {
    serviceTiles.replaceChildren();
    const active = Array.isArray(services) ? services.filter(item => item && item.active !== false) : [];
    if (!active.length) {
      const empty = document.createElement("p");
      empty.className = "landing-services-message";
      empty.textContent = "No services available at the moment. Please check back soon.";
      serviceTiles.appendChild(empty);
      updateServiceArrows();
      return;
    }
    active.forEach((service, index) => {
      const article = document.createElement("article");
      article.className = "landing-service-card";
      const img = document.createElement("img");
      img.src = safeServiceImage(service.imageUrl);
      img.alt = `${String(service.name || "Barbershop service")} service photo`;
      img.loading = index < 3 ? "eager" : "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        if (!img.src.endsWith(serviceFallback)) img.src = serviceFallback;
      });
      const info = document.createElement("div");
      info.className = "landing-service-info";
      const kicker = document.createElement("span");
      kicker.className = "landing-service-number";
      kicker.textContent = `SERVICE ${String(index + 1).padStart(2, "0")}`;
      const title = document.createElement("h3");
      title.textContent = String(service.name || "Barbershop Service");
      const details = document.createElement("div");
      details.className = "landing-service-details";
      const price = document.createElement("strong");
      price.textContent = formatPrice(service.price);
      const duration = document.createElement("span");
      duration.textContent = `${Number(service.durationMinutes) || 0} min`;
      details.append(price, duration);
      info.append(kicker, title, details);
      article.append(img, info);
      serviceTiles.appendChild(article);
    });
    serviceViewport.scrollLeft = 0;
    updateServiceArrows();
  }
  async function loadPublicServices() {
    try {
      const response = await fetch("/api/services", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Services request failed");
      renderPublicServices(await response.json());
    } catch (error) {
      serviceTiles.replaceChildren();
      const message = document.createElement("p");
      message.className = "landing-services-message";
      message.textContent = "Services couldn't be loaded. Please refresh the page to try again.";
      serviceTiles.appendChild(message);
      updateServiceArrows();
      console.error("Failed to load landing services:", error);
    } finally {
      serviceTiles.setAttribute("aria-busy", "false");
    }
  }
  loadPublicServices();

  // Mobile landing navigation: keep the desktop navigation intact.
  const landingHeader = document.querySelector(".landing-nav");
  const landingNav = landingHeader?.querySelector("nav");
  const landingAuth = landingHeader?.querySelector(".landing-auth");
  if (landingHeader && landingNav && landingAuth) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "landing-menu-toggle";
    toggle.setAttribute("aria-label", "Open navigation menu");
    toggle.setAttribute("aria-controls", "landingMobileNavigation");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    const menu = document.createElement("div");
    menu.id = "landingMobileNavigation";
    menu.className = "landing-mobile-navigation";
    menu.hidden = true;
    menu.setAttribute("inert", "");
    const navCopy = landingNav.cloneNode(true);
    navCopy.setAttribute("aria-label", "Mobile navigation");
    const authCopy = landingAuth.cloneNode(true);
    menu.append(navCopy, authCopy);
    landingHeader.append(toggle, menu);
    function setLandingOpen(open) {
      landingHeader.classList.toggle("landing-menu-open", open);
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
      toggle.innerHTML = open
        ? '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>'
        : '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
      if (open) menu.removeAttribute("inert"); else menu.setAttribute("inert", "");
    }
    toggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      setLandingOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    menu.addEventListener("click", event => { if (event.target.closest("a")) setLandingOpen(false); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") setLandingOpen(false); });
    document.addEventListener("click", event => { if (!landingHeader.contains(event.target)) setLandingOpen(false); });
    window.matchMedia("(min-width: 701px)").addEventListener("change", event => { if (event.matches) setLandingOpen(false); });
  }

  // Landing-only sign in / registration prompt for the three booking CTAs.
  // Styles are scoped to this modal; the existing landing layout stays unchanged.
  const modalStyles = document.createElement("style");
  modalStyles.textContent = `
    .renz-auth-overlay[hidden] { display: none !important; }
    .renz-auth-overlay {
      position: fixed; inset: 0; z-index: 1000;
      display: flex; align-items: center; justify-content: center;
      padding: 22px; overflow-y: auto;
      background: rgba(20, 17, 14, .68);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      animation: renz-auth-fade .18s ease-out;
    }
    .renz-auth-card {
      position: relative; width: min(100%, 440px); max-height: min(90vh, 740px);
      overflow-y: auto; box-sizing: border-box;
      border: 1px solid rgba(191, 151, 91, .22);
      border-radius: 23px; background: #fffdfa;
      padding: 39px 36px 34px; text-align: center;
      box-shadow: 0 30px 90px rgba(0, 0, 0, .27);
      color: #29221b; font-family: Arial, Helvetica, sans-serif;
      animation: renz-auth-rise .23s ease-out;
    }
    .renz-auth-card * { box-sizing: border-box; }
    .renz-auth-close {
      position: absolute; top: 16px; right: 16px;
      width: 36px; height: 36px; border-radius: 50%;
      background: #f6f1e9; border: 1px solid #eee3d3; color: #554a3d;
      display: grid; place-items: center; cursor: pointer;
      font-size: 23px; line-height: 1; transition: background .2s, transform .2s;
    }
    .renz-auth-close:hover { background: #ead9be; transform: rotate(90deg); }
    .renz-auth-mark {
      width: 65px; height: 65px; margin: 0 auto 18px;
      display: grid; place-items: center; border-radius: 19px;
      background: #f5e9d8; color: #be9251; font-size: 36px;
    }
    .renz-auth-mark img { width: 57px; height: 57px; object-fit: contain; display: block; }
    .renz-auth-brand { font: 700 21px/1.2 Georgia, 'Times New Roman', serif; letter-spacing: .06em; }
    .renz-auth-kicker { margin: 8px 0 25px; font: 700 10px/1.5 Arial, sans-serif; letter-spacing: .21em; color: #ac7f40; }
    .renz-auth-card h2 { margin: 0 0 12px; font: 700 clamp(25px, 5vw, 31px)/1.18 Georgia, 'Times New Roman', serif; color: #29221b; }
    .renz-auth-description { margin: 0 auto 27px; max-width: 325px; font-size: 14px; line-height: 1.75; color: #746b60; }
    .renz-auth-buttons { display: grid; gap: 12px; }
    .renz-auth-buttons a {
      display: flex; justify-content: center; align-items: center; gap: 9px;
      width: 100%; min-height: 51px; padding: 12px 17px;
      border-radius: 11px; text-decoration: none; font-size: 15px;
      font-family: Arial, Helvetica, sans-serif; font-weight: 700;
      transition: background .18s, border-color .18s, transform .18s;
    }
    .renz-auth-buttons a:hover { transform: translateY(-1px); }
    .renz-auth-register { background: #cda464; color: #251e16; border: 1px solid #cda464; }
    .renz-auth-register:hover { background: #dcb77e; border-color: #dcb77e; }
    .renz-auth-signin { background: #fffdfa; color: #78582f; border: 1px solid #cda464; }
    .renz-auth-signin:hover { background: #fcf3e6; }
    .renz-auth-bottom { margin: 23px 0 0; color: #93887b; font-size: 12px; line-height: 1.5; }
    .renz-auth-card :focus-visible { outline: 3px solid #b78948; outline-offset: 3px; }
    body.renz-auth-open { overflow: hidden; }
    @keyframes renz-auth-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes renz-auth-rise { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @media (max-width: 480px) { .renz-auth-card { padding: 37px 23px 27px; border-radius: 18px; } }
    @media (prefers-reduced-motion: reduce) { .renz-auth-overlay, .renz-auth-card { animation: none; } .renz-auth-buttons a, .renz-auth-close { transition: none; } }
  `;
  document.head.appendChild(modalStyles);

  const overlay = document.createElement("div");
  overlay.className = "renz-auth-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="renz-auth-card" role="dialog" aria-modal="true" aria-labelledby="renzAuthTitle" aria-describedby="renzAuthDescription">
      <button class="renz-auth-close" type="button" aria-label="Close dialog" data-renz-auth-close>×</button>
      <div class="renz-auth-mark" aria-hidden="true"><img src="/images/GoldenScissors.png" alt="" decoding="async"></div>
      <div class="renz-auth-brand">RENZ BARBERSHOP</div>
      <p class="renz-auth-kicker">YOUR STYLE. YOUR CONFIDENCE.</p>
      <h2 id="renzAuthTitle">Ready for a Fresh Cut?</h2>
      <p class="renz-auth-description" id="renzAuthDescription">Create an account or log in to book your next haircut and manage your appointments.</p>
      <div class="renz-auth-buttons">
        <a class="renz-auth-register" href="/login.html#register">Create an Account <span aria-hidden="true">→</span></a>
        <a class="renz-auth-signin" href="/login.html#signin">Log In <span aria-hidden="true">→</span></a>
      </div>
      <p class="renz-auth-bottom">Book easily. Stay fresh. Look your best.</p>
    </section>`;
  document.body.appendChild(overlay);

  let previousFocus = null;
  const closeButton = overlay.querySelector("[data-renz-auth-close]");
  function closeAuthModal() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    document.body.classList.remove("renz-auth-open");
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    previousFocus = null;
  }
  function openAuthModal(event) {
    event.preventDefault();
    previousFocus = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add("renz-auth-open");
    closeButton.focus();
  }
  document.querySelectorAll("[data-landing-auth-modal]").forEach(link => {
    link.addEventListener("click", openAuthModal);
  });
  closeButton.addEventListener("click", closeAuthModal);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeAuthModal();
  });
  document.addEventListener("keydown", event => {
    if (overlay.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); closeAuthModal(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(overlay.querySelectorAll('button:not([disabled]), a[href]'));
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
})();
