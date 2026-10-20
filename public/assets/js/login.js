(function () {
  'use strict';

  // If already signed in, jump straight to the right portal.
  const existing = API.session();
  if (existing && API.token()) {
    location.href = API.defaultPageFor(existing.role);
    return;
  }

  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    try {
      const res = await API.request('/auth/login', {
        method: 'POST',
        auth: false,
        body: { username, password }
      });
      API.setSession(res.token, res.user);
      location.href = API.defaultPageFor(res.user.role);
    } catch (err) {
      API.toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  // ---- Register (self-service) ----
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');
  const demoBox = document.querySelector('.muted');

  function show(which) {
    loginForm.hidden = which !== 'login';
    regForm.hidden = which !== 'register';
    if (demoBox) demoBox.hidden = which === 'register';
  }

  const showReg = document.getElementById('show-register');
  const showLogin = document.getElementById('show-login');
  if (showReg) showReg.addEventListener('click', (e) => { e.preventDefault(); show('register'); });
  if (showLogin) showLogin.addEventListener('click', (e) => { e.preventDefault(); show('login'); });

  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = regForm.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Creating…';

      const body = {
        fullName: document.getElementById('fullName').value.trim(),
        username: document.getElementById('reg-username').value.trim(),
        email: document.getElementById('reg-email').value.trim(),
        phone: document.getElementById('reg-phone').value.trim() || null,
        accountType: document.getElementById('reg-accountType').value,
        password: document.getElementById('reg-password').value
      };

      try {
        const res = await API.request('/auth/register', {
          method: 'POST',
          auth: false,
          body
        });
        API.setSession(res.token, res.user);
        API.toast('Welcome, ' + res.user.username + '! Account ' + res.user.accountNumber + ' created.', 'success');
        setTimeout(() => { location.href = API.defaultPageFor(res.user.role); }, 800);
      } catch (err) {
        API.toast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Create account';
      }
    });
  }
})();
