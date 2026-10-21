// Password recovery runs independently of sign-in and registration.
(function () {
  const requestForm = document.getElementById('forgotRequestForm');
  const resetForm = document.getElementById('forgotResetForm');
  const requestPanel = document.getElementById('forgotRequestPanel');
  const resetPanel = document.getElementById('forgotResetPanel');
  const message = document.getElementById('forgotMessage');
  if (!requestForm || !resetForm || !message) return;

  // Allow customers and staff to reveal either password while typing.
  ['resetPassword', 'resetConfirm'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'forgot-password-field';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'forgot-password-toggle';
    toggle.textContent = 'Show';
    toggle.setAttribute('aria-label', `Show ${id === 'resetPassword' ? 'new' : 'confirmation'} password`);
    toggle.setAttribute('aria-pressed', 'false');
    toggle.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      toggle.textContent = reveal ? 'Hide' : 'Show';
      toggle.setAttribute('aria-pressed', String(reveal));
      toggle.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} ${id === 'resetPassword' ? 'new' : 'confirmation'} password`);
    });
    wrapper.appendChild(toggle);
  });

  const token = new URLSearchParams(location.search).get('token') || '';
  requestPanel.hidden = Boolean(token);
  resetPanel.hidden = !token;

  function feedback(text, success = false) {
    message.textContent = text;
    message.classList.toggle('success', success);
  }
  async function post(url, body) {
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
    return data;
  }
  async function submit(form, action) {
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    feedback('Please wait…');
    try { await action(); }
    catch (error) { feedback(error.message || 'Please try again.'); }
    finally { button.disabled = false; }
  }
  requestForm.addEventListener('submit', event => {
    event.preventDefault();
    submit(requestForm, async () => {
      await post('/api/auth/forgot-password', { email: document.getElementById('forgotEmail').value.trim() });
      feedback('If this email is registered, a password reset link will be sent. Please check your inbox or spam folder.', true);
    });
  });
  resetForm.addEventListener('submit', event => {
    event.preventDefault();
    submit(resetForm, async () => {
      const password = document.getElementById('resetPassword').value;
      const confirmation = document.getElementById('resetConfirm').value;
      if (password !== confirmation) throw new Error('Passwords do not match.');
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new Error('Use at least 8 characters with letters and numbers.');
      await post('/api/auth/reset-password', { token, password });
      resetForm.hidden = true;
      history.replaceState(null, '', '/forgot-password.html');
      feedback('Password updated successfully. You can now sign in using your new password.', true);
    });
  });
})();
