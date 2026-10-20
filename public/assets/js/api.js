/* Shared API client + small UI helpers (vanilla JS, no framework). */
(function () {
  'use strict';

  const TOKEN_KEY = 'fd_token';
  const SESSION_KEY = 'fd_session';

  function token() { return localStorage.getItem(TOKEN_KEY); }
  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function setSession(tok, user) {
    localStorage.setItem(TOKEN_KEY, tok);
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  async function request(path, options) {
    options = options || {};
    const headers = { 'Content-Type': 'application/json' };
    if (options.auth !== false && token()) {
      headers.Authorization = 'Bearer ' + token();
    }
    const res = await fetch('/api' + path, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }

    if (!res.ok) {
      if (res.status === 401) { clearSession(); }
      const msg = (data && data.error && data.error.message) || ('Request failed (' + res.status + ')');
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function requireLogin(roles) {
    const s = session();
    if (!s || !token()) {
      location.href = '/index.html';
      return null;
    }
    if (roles && roles.length && !roles.includes(s.role)) {
      location.href = defaultPageFor(s.role);
      return null;
    }
    return s;
  }

  function defaultPageFor(role) {
    if (role === 'admin' || role === 'analyst') return '/dashboard.html';
    if (role === 'merchant') return '/merchant.html';
    return '/customer.html';
  }

  function logout() {
    clearSession();
    location.href = '/index.html';
  }

  function formatMoney(v, currency) {
    const n = Number(v || 0);
    return (currency ? currency + ' ' : '') + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function formatDate(v) {
    if (!v) return '';
    const d = new Date(v);
    return d.toLocaleString();
  }
  function badge(status) {
    return '<span class="badge ' + status + '">' + status + '</span>';
  }
  function severity(s) {
    return '<span class="severity ' + s + '">' + s + '</span>';
  }

  function toast(message, type) {
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  window.API = {
    token, session, setSession, clearSession, request, requireLogin,
    defaultPageFor, logout, formatMoney, formatDate, badge, severity, toast, esc
  };
})();
