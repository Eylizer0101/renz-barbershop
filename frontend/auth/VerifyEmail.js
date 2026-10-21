
function initializeAuthPage() {
  const verifyForm = document.getElementById("verifyForm");
  const verifyMessage = document.getElementById("verifyMessage");

  function showMessage(message, success = false) {
    verifyMessage.textContent = message;
    verifyMessage.classList.toggle("success", success);
  }

  const customerFlow = new URLSearchParams(location.search).get("flow") === "registration";
  const subtitle = document.querySelector(".login-subtitle");
  const rememberRow = document.querySelector(".remember-row");
  const submitLabel = verifyForm.querySelector('button[type="submit"]');
  const note = document.querySelector(".login-note");
  const resend = document.getElementById("resendBtn");
  let resendUntil = 0;
  if (customerFlow) {
    if (subtitle) subtitle.textContent = "Enter the 6-digit code emailed to you to activate your customer account.";
    if (rememberRow) rememberRow.style.display = "none";
    submitLabel.textContent = "Verify Email";
    if (note) {
      note.firstChild.textContent = "Your code expires in 5 minutes. ";
      const back = note.querySelector("a");
      if (back) { back.href = "/login.html#register"; back.textContent = "Back to registration"; }
    }
    fetch("/api/auth/registration-status", { credentials: "same-origin" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error); resendUntil = Date.now() + d.resendAfterSeconds * 1000; updateCountdown(); })
      .catch(e => showMessage(e.message));
  }
  function updateCountdown() {
    if (!customerFlow) return;
    const seconds = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
    resend.disabled = seconds > 0;
    resend.textContent = seconds ? `Resend in ${seconds}s` : "Send a new code";
  }
  if (customerFlow) setInterval(updateCountdown, 1000);

  verifyForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const code = document.getElementById("verifyCode").value.trim();
    const submitButton = verifyForm.querySelector('button[type="submit"]');

    if (!/^\d{6}$/.test(code)) {
      showMessage("Enter the 6-digit code from your email.");
      return;
    }

    showMessage("Verifying...");
    submitButton.disabled = true;

    try {
      const response = await fetch(customerFlow ? "/api/auth/verify-registration" : "/api/auth/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(customerFlow ? { code } : { code, remember: document.getElementById("rememberDevice").checked })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Verification failed.");
      }

      showMessage("Verified. Redirecting...", true);
      window.location.href = data.redirectUrl || "/admin.html";
    } catch (error) {
      showMessage(error.message || "Unable to verify the code.");
    } finally {
      submitButton.disabled = false;
    }
  });

  document.getElementById("resendBtn").addEventListener("click", async event => {
    const button = event.target;
    button.disabled = true;

    try {
      const response = await fetch(customerFlow ? "/api/auth/resend-registration" : "/api/auth/resend-code", { method: "POST", credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not send a new code.");
      if (customerFlow) { resendUntil = Date.now() + 120000; updateCountdown(); }
      showMessage(data.message, true);
    } catch (error) {
      showMessage(error.message);
    } finally {
      // Short pause so the button isn't pressed repeatedly.
      if (!customerFlow) setTimeout(() => { button.disabled = false; }, 30000);
      else updateCountdown();
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeAuthPage, { once: true });
else initializeAuthPage();
