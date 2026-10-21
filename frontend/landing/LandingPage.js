// Renz Barbershop public landing page.
// The existing router loads this page for / and /index.html.
(function () {
  "use strict";
  document.body.innerHTML = "<header class=\"landing-nav\"><a class=\"landing-logo\" href=\"/\" aria-label=\"Renz Barbershop Home\"><span class=\"landing-scissors\">✂</span><span><strong>RENZ</strong><small>BARBERSHOP</small></span></a><nav aria-label=\"Main navigation\"><a href=\"#home\">Home</a><a href=\"#services\">Services</a><a href=\"#about\">About Us</a><a href=\"#gallery\">Gallery</a></nav><div class=\"landing-auth\"><a class=\"landing-register\" href=\"/login.html#register\">Register</a><a class=\"landing-login\" href=\"/login.html#signin\">Log In</a></div></header><main id=\"home\"><section class=\"landing-hero\"><div class=\"landing-copy\"><div class=\"landing-kicker\">WELCOME TO RENZ BARBERSHOP</div><h1>Fresh Cut.<br><em>Fresh Confidence.</em></h1><p>Great haircuts, good vibes, and a style that feels like you. Your style. Your turn. Your time.</p><div class=\"landing-actions\"><a href=\"/login.html\" data-landing-auth-modal>Book Your Cut <span aria-hidden=\"true\">→</span></a><a href=\"#services\">Explore Services</a></div><div class=\"landing-highlights\"><span>✦ Quality Haircuts</span><span>✦ Skilled Barbers</span><span>✦ Easy Booking</span></div></div><div class=\"landing-hero-photo\"><img src=\"/images/landingpage/1.png\" alt=\"Barber giving a fresh haircut\"/></div></section><section id=\"services\" class=\"landing-section landing-services\"><div class=\"landing-heading\"><span>WHAT WE DO</span><h2>Your next great look starts here.</h2><p>From a clean trim to a fresh new style, we've got you covered.</p></div><div class=\"landing-tiles\"><article><img src=\"/images/landingpage/2.png\" alt=\"Barbershop service showcase\"><div><span>01 / PRECISION</span><h3>Classic Cuts</h3><p>Sharp, clean, and timeless looks.</p></div></article><article><img src=\"/images/landingpage/3.png\" alt=\"Modern haircut showcase\"><div><span>02 / YOUR STYLE</span><h3>Modern Styles</h3><p>Fresh cuts made for your personality.</p></div></article><article><img src=\"/images/landingpage/4.png\" alt=\"Barbershop grooming showcase\"><div><span>03 / DETAILS</span><h3>Grooming</h3><p>It's the little details that count.</p></div></article></div><a class=\"landing-outline\" href=\"/login.html\" data-landing-auth-modal>Get Started →</a></section><section id=\"about\" class=\"landing-about\"><div class=\"landing-about-image\"><img src=\"/images/landingpage/1.png\" alt=\"Inside Renz Barbershop\"></div><div><span class=\"landing-kicker\">MORE THAN JUST A HAIRCUT</span><h2>Look good.<br>Feel even better.</h2><p>At Renz Barbershop, every visit is about finding the look that fits you. Enjoy a welcoming space, dedicated barbers, and a simple way to plan your next visit.</p><a href=\"/login.html#register\" data-landing-auth-modal>Join Renz Barbershop →</a></div></section><section id=\"gallery\" class=\"landing-section landing-gallery\"><div class=\"landing-heading\"><span>OUR GALLERY</span><h2>Style inspiration</h2><p>Find your next look and make it your own.</p></div><div class=\"landing-gallery-grid\"><img src=\"/images/landingpage/2.png\" alt=\"Haircut gallery photo one\"><img src=\"/images/landingpage/3.png\" alt=\"Haircut gallery photo two\"><img src=\"/images/landingpage/4.png\" alt=\"Haircut gallery photo three\"></div></section><section class=\"landing-cta\"><span>READY FOR A FRESH LOOK?</span><h2>Your chair is waiting.</h2><p>Start your next barbershop visit with Renz.</p><a href=\"/login.html\" data-landing-auth-modal>Get Started →</a></section></main><footer class=\"landing-footer\"><strong>✂ RENZ BARBERSHOP</strong><small>© 2026 Renz Barbershop</small></footer>";


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
      <div class="renz-auth-mark" aria-hidden="true">✂</div>
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
