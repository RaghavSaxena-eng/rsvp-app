(function () {
  'use strict';
  const { api } = window.RSVP;
  const $ = (id) => document.getElementById(id);
  let mode = 'login', status = { needsSetup: false, allowSignup: false };

  function paint() {
    const setup = status.needsSetup, reg = mode === 'register';
    $('nameField').hidden = !(setup || reg);
    $('keyField').hidden = !(setup && status.needsSetupKey);
    $('pwhint').hidden = !(setup || reg);
    $('password').autocomplete = (setup || reg) ? 'new-password' : 'current-password';
    if (setup) {
      $('heading').textContent = 'Create the owner account';
      $('lead').textContent = 'This account can add accounts for your clients later.';
      $('go').textContent = 'Create account';
      $('swap').hidden = true;
    } else if (reg) {
      $('heading').textContent = 'Create your account';
      $('lead').textContent = 'Start planning your first invitation in a minute.';
      $('go').textContent = 'Create account';
      $('swap').hidden = false; $('swap').textContent = 'I already have an account';
    } else {
      $('heading').textContent = 'Sign in';
      $('lead').textContent = 'Manage invitations, replies and plate counts in one calm place.';
      $('go').textContent = 'Sign in';
      $('swap').hidden = !status.allowSignup; $('swap').textContent = 'Create an account';
    }
    $('err').textContent = '';
  }

  $('swap').addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; paint(); });
  $('showpw').addEventListener('click', () => {
    const p = $('password'), show = p.type === 'password';
    p.type = show ? 'text' : 'password'; $('showpw').textContent = show ? 'Hide' : 'Show';
  });

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('err'), btn = $('go');
    err.textContent = '';
    const email = $('email').value.trim(), password = $('password').value;
    if (!email || !password) { err.textContent = 'Enter your email and password.'; return; }
    const create = status.needsSetup || mode === 'register';
    btn.disabled = true;
    try {
      if (create) await api('/auth/register', { method: 'POST', body: { name: $('name').value, email, password, setupKey: $('setupKey').value } });
      else await api('/auth/login', { method: 'POST', body: { email, password } });
      location.replace('/app');
    } catch (ex) {
      err.textContent = ex.message; btn.disabled = false;
    }
  });

  (async function init() {
    $('loginArt').innerHTML = window.RSVP.art('welcome');
    try { await api('/me'); location.replace('/app'); return; } catch (e) {}
    try { status = await api('/auth/status'); } catch (e) {}
    paint();
    $('email').focus();
  })();
})();
