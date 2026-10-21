// Hidden Admin/Cashier registration; authorization and OTP are enforced by the backend.
(function () {
  "use strict";
  const register = document.getElementById("staffRegisterForm");
  const verify = document.getElementById("staffVerifyForm");
  const registerMessage = document.getElementById("staffRegisterMessage");
  const verifyMessage = document.getElementById("staffVerifyMessage");
  const resend = document.getElementById("staffResend");
  if (!register || !verify) return;
  let nextResend = 0;
  const status = (element, value, ok = false) => { element.textContent = value; element.classList.toggle("success", ok); };
  async function request(url, body) {
    const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Unable to continue. Please try again.");
    return data;
  }
  function tick() {
    if (verify.hidden) return;
    const seconds = Math.max(0, Math.ceil((nextResend - Date.now()) / 1000));
    resend.disabled = seconds > 0;
    resend.textContent = seconds ? `Resend in ${seconds}s` : "Resend code";
  }
  setInterval(tick, 1000);
  async function showVerify() {
    register.hidden = true; verify.hidden = false;
    document.getElementById("staffRegisterTitle").textContent = "Verify Your Email";
    try { const data = await request("/api/auth/staff-registration-status"); nextResend = Date.now() + data.resendAfterSeconds * 1000; }
    catch (error) { status(verifyMessage, error.message); }
    tick();
  }
  register.addEventListener("submit", async event => {
    event.preventDefault();
    const button = register.querySelector('button[type="submit"]');
    const password = document.getElementById("newStaffPassword").value;
    if (password !== document.getElementById("newStaffConfirm").value) { status(registerMessage, "Passwords do not match."); return; }
    if (password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) { status(registerMessage, "Password must have 10+ characters, uppercase, lowercase, number and symbol."); return; }
    button.disabled = true; status(registerMessage, "Sending verification code...");
    try {
      const data = await request("/api/auth/register-staff", { name: document.getElementById("newStaffName").value, email: document.getElementById("newStaffEmail").value, role: document.getElementById("newStaffRole").value, password, registrationCode: document.getElementById("newStaffCode").value });
      register.reset(); nextResend = Date.now() + data.resendAfterSeconds * 1000; await showVerify();
    } catch (error) { status(registerMessage, error.message); }
    finally { button.disabled = false; }
  });
  verify.addEventListener("submit", async event => {
    event.preventDefault();
    const button = verify.querySelector('button[type="submit"]');
    button.disabled = true; status(verifyMessage, "Verifying...");
    try { const data = await request("/api/auth/verify-staff-registration", { code: document.getElementById("newStaffOtp").value.trim() }); window.location.replace(data.redirectUrl || "/login.html#staff"); }
    catch (error) { status(verifyMessage, error.message); button.disabled = false; }
  });
  resend.addEventListener("click", async () => {
    resend.disabled = true;
    try { const data = await request("/api/auth/resend-staff-registration", {}); nextResend = Date.now() + data.resendAfterSeconds * 1000; status(verifyMessage, data.message, true); }
    catch (error) { status(verifyMessage, error.message); }
    tick();
  });
  request("/api/auth/staff-registration-status").then(data => { nextResend = Date.now() + data.resendAfterSeconds * 1000; showVerify(); }).catch(() => {});
})();
