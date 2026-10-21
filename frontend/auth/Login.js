
function initializeAuthPage() {
  const $ = id => document.getElementById(id);
  const loginMessage = $("loginMessage");

  const notes = {
    guestForm: "Walk-in guests can join the queue without creating an account.",
    customerLoginForm: "Sign in to access your account and visit history.",
    registerForm: "Create a customer account once. We will email a verification code before activating your account.",
    staffForm: "For Admin and Cashier accounts created by the shop. Sign in with your email and password."
  };

  function showMessage(message, success = false) {
    loginMessage.textContent = message;
    loginMessage.classList.toggle("success", success);
  }

  function showForm(formId) {
    ["guestForm", "customerLoginForm", "registerForm", "staffForm"].forEach(id => {
      $(id).hidden = id !== formId;
    });
    $("loginNote").textContent = notes[formId];
    showMessage("");
    if (formId === "registerForm") {
      $("formTitle").textContent = "Create Account";
      $("formSubtitle").textContent = "Join Renz Barbershop and book your next fresh cut.";
    } else if (formId === "customerLoginForm") {
      $("formTitle").textContent = "Welcome Back!";
      $("formSubtitle").textContent = "Log in to your Renz Barbershop account.";
    } else if (formId === "guestForm") {
      $("formTitle").textContent = "Welcome!";
      $("formSubtitle").textContent = "Join the queue or sign in to your account.";
    }
  }

  function showCustomer(formId = "guestForm") {
    $("customerPanel").hidden = false;
    $("customerTab").classList.add("active");
    $("staffTab").classList.remove("active");
    $("formTitle").textContent = "Welcome!";
    $("formSubtitle").textContent = "Join the queue or sign in to your account.";
    showForm(formId);
  }

  function showStaff() {
    $("customerPanel").hidden = true;
    $("staffTab").classList.add("active");
    $("customerTab").classList.remove("active");
    $("formTitle").textContent = "Welcome back";
    $("formSubtitle").textContent = "Sign in to the front desk or admin dashboard.";
    showForm("staffForm");
  }

  async function post(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Something went wrong.");
      error.data = data;
      throw error;
    }
    return data;
  }

  // The server owns the lock expiration; browser storage is only a pointer so we
  // can restore the modal after navigating away or reopening the login page.
  const LOCK_EMAIL_KEY = "renzLockedLoginEmail";
  const lockOverlay = document.createElement("div");
  lockOverlay.className = "login-lock-overlay";
  lockOverlay.hidden = true;
  lockOverlay.innerHTML = `<section class="login-lock-dialog" role="alertdialog" aria-modal="true" aria-labelledby="loginLockHeading" aria-describedby="loginLockDescription">
    <img src="/images/Lock.png" alt="" class="login-lock-icon" onerror="this.style.display='none'">
    <h2 id="loginLockHeading">Account Locked</h2>
    <p id="loginLockDescription">Too many failed attempts. Please wait before trying again.</p>
    <p class="login-lock-countdown" role="timer">Time remaining: <strong id="loginLockSeconds">180 seconds</strong></p>
  </section>`;
  document.body.appendChild(lockOverlay);
  let lockUntil = 0;
  let lockInterval = null;
  let checkingLock = false;
  function clearLock() {
    lockUntil = 0;
    if (lockInterval) clearInterval(lockInterval);
    lockInterval = null;
    lockOverlay.hidden = true;
    document.body.classList.remove("login-is-locked");
    try { localStorage.removeItem(LOCK_EMAIL_KEY); } catch (_) { /* Storage may be disabled. */ }
  }
  function renderLockTimer() {
    const seconds = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
    if (!seconds) { clearLock(); return; }
    $("loginLockSeconds").textContent = `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }
  function showLock(email, until) {
    const expires = new Date(until).getTime();
    if (!Number.isFinite(expires) || expires <= Date.now()) return;
    lockUntil = expires;
    try { localStorage.setItem(LOCK_EMAIL_KEY, email.trim().toLowerCase()); } catch (_) { /* Storage may be disabled. */ }
    lockOverlay.hidden = false;
    document.body.classList.add("login-is-locked");
    renderLockTimer();
    if (lockInterval) clearInterval(lockInterval);
    lockInterval = setInterval(renderLockTimer, 1000);
  }
  async function checkLock(email) {
    if (!email || checkingLock) return;
    checkingLock = true;
    try {
      const response = await fetch("/api/auth/login-lock-status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify({ email })
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.locked && data.lockedUntil) showLock(email, data.lockedUntil);
      else if (!lockOverlay.hidden) clearLock();
      else { try { localStorage.removeItem(LOCK_EMAIL_KEY); } catch (_) {} }
    } catch (_) { /* A failed network request must not invent a lock state. */ }
    finally { checkingLock = false; }
  }
  try {
    const savedEmail = localStorage.getItem(LOCK_EMAIL_KEY);
    if (savedEmail) checkLock(savedEmail);
  } catch (_) { /* Storage may be disabled. */ }

  // Disables the form's button while a request runs.
  function handle(form, action) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      showMessage("Please wait...");

      try {
        await action();
      } catch (error) {
        if (error.data?.code === "ACCOUNT_LOCKED" && error.data.lockedUntil) {
          const email = form.id === "staffForm" ? $("staffEmail").value : $("customerEmail")?.value;
          showLock(email || "", error.data.lockedUntil);
        } else if (typeof error.data?.attempt === "number") {
          showMessage(`The email or password you entered is incorrect. Attempt ${error.data.attempt} of ${error.data.maxAttempts}.`);
        } else showMessage(error.message || "Unable to continue.");
      } finally {
        button.disabled = false;
      }
    });
  }

  function signIn(email, password) {
    return post("/api/auth/login", { email, password }).then(data => {
      if (data.requires2FA) showMessage("Check your email for a verification code.", true);
      window.location.href = data.redirectUrl;
    });
  }

  $("customerTab").addEventListener("click", () => showCustomer());
  $("staffTab").addEventListener("click", showStaff);
  document.querySelectorAll("#customerPanel [data-form]").forEach(button => {
    button.addEventListener("click", () => showForm(button.dataset.form));
  });

  let deviceTicket = null;

  handle($("guestForm"), async () => {
    const name = $("guestName").value.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 60) throw new Error("Your name must be 2 to 60 characters.");

    // The same person coming back keeps their ticket. Anyone else starts fresh, so a shared
    // device doesn't show the previous person's ticket or account.
    const samePerson = deviceTicket && deviceTicket.customerName.toLowerCase() === name.toLowerCase();
    if (!samePerson) await post("/api/auth/logout", {}).catch(() => {});

    sessionStorage.setItem("customerName", samePerson ? deviceTicket.customerName : name);
    window.location.href = "/dashboard.html";
  });

  handle($("customerLoginForm"), () => signIn($("customerEmail").value.trim(), $("customerPassword").value));
  handle($("staffForm"), () => signIn($("staffEmail").value.trim(), $("staffPassword").value));

  // Customer registration only: prevent non-digits and limit Philippine mobile input.
  $("registerPhone").addEventListener("input", () => {
    $("registerPhone").value = $("registerPhone").value.replace(/\D/g, "").slice(0, 11);
  });

  handle($("registerForm"), async () => {
    const fullName = $("registerName").value.trim().replace(/\s+/g, " ");
    const email = $("registerEmail").value.trim();
    const phone = $("registerPhone").value.trim();
    if (fullName.length < 2 || fullName.length > 30) throw new Error("Full Name must be 2 to 30 characters.");
    if (email.length > 30 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address (maximum 30 characters).");
    if (!/^09\d{9}$/.test(phone)) throw new Error("Phone number must start with 09 and contain exactly 11 digits.");
    const password = $("registerPassword").value;
    const confirmation = $("registerConfirmPassword").value;
    if (password !== confirmation) throw new Error("Passwords do not match.");
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw new Error("Password must be at least 8 characters with letters and numbers.");
    }
    const data = await post("/api/auth/register", {
      name: fullName,
      email,
      phone,
      password: $("registerPassword").value
    });
    sessionStorage.removeItem("customerName");
    window.location.href = data.redirectUrl || "/verify.html?flow=registration";
  });

  // Links such as /login.html#register open the right form (also when already on this page).
  function openFromHash() {
    const hash = window.location.hash.slice(1);
    if (hash === "staff") showStaff();
    else if (hash === "register") showCustomer("registerForm");
    else if (hash === "signin") showCustomer("customerLoginForm");
    else showCustomer();
    return hash;
  }

  window.addEventListener("hashchange", openFromHash);
  const start = openFromHash();

  if (start === "expired") showMessage("Your session has ended. Please sign in again.");
  if (start === "deleted") showMessage("Your account has been deleted.", true);

  // If this device is already signed in, or already has a ticket in today's queue, say so
  // instead of silently replacing it (a walk-in who closed the page can get back to their ticket).
  const notice = $("deviceNotice");

  function showNotice(html) {
    notice.innerHTML = html;
    notice.classList.remove("hidden");
  }

  async function checkDevice() {
    const me = await fetch("/api/auth/me", { credentials: "same-origin" }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (me?.user) {
      const home = { admin: "/admin.html", cashier: "/cashier.html", customer: "/dashboard.html" }[me.user.role];
      showNotice(`You're signed in as <strong>${App.escapeHTML(me.user.name)}</strong>. <a href="${home}">Continue</a> · <button class="link-btn" type="button" data-fresh>Sign out</button>`);
      return;
    }

    const mine = await fetch("/api/queue/mine", { credentials: "same-origin" }).then(r => r.ok ? r.json() : null).catch(() => null);
    const ticket = mine?.ticket;
    if (ticket && ["waiting", "serving"].includes(ticket.status)) {
      deviceTicket = ticket;
      showNotice(`You're in today's queue as <strong>#${ticket.queueNumber} ${App.escapeHTML(ticket.customerName)}</strong>. <a href="/dashboard.html">Go to my ticket</a> · <button class="link-btn" type="button" data-fresh>Not you? Start fresh</button>`);
    }
  }

  notice.addEventListener("click", async event => {
    if (!event.target.closest("[data-fresh]")) return;
    await post("/api/auth/logout", {}).catch(() => {});
    sessionStorage.removeItem("customerName");
    deviceTicket = null;
    notice.classList.add("hidden");
    showMessage("Signed out on this device.", true);
  });

  checkDevice();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeAuthPage, { once: true });
else initializeAuthPage();
