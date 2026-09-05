/* ==========================================================================
   auth.js — first-time school setup and sign-in.

   Both forms live in #auth-view, which replaces the whole app shell until
   there is a session. Nothing here talks to a network; every check runs
   against the accounts stored on this device.
   ========================================================================== */

(function (window, document) {
  'use strict';

  var Auth = window.SchoolDB.Auth;

  var REGISTER_FIELDS = ['schoolName', 'directorName', 'username', 'password', 'confirmPassword', 'logo'];
  var LOGIN_FIELDS = ['identifier', 'password'];

  var REGISTER_INPUTS = {
    schoolName: 'r-school',
    directorName: 'r-director',
    username: 'r-username',
    password: 'r-password',
    confirmPassword: 'r-confirm'
  };

  var LOGIN_INPUTS = {
    identifier: 'l-identifier',
    password: 'l-password'
  };

  var el = {};
  var started = false;
  var mode = 'login';
  var pendingLogo = '';

  function $(id) { return document.getElementById(id); }

  /* --------------------------------------------------------------- errors */

  function clearErrors(prefix, fields) {
    fields.forEach(function (field) {
      var error = $(prefix + field);
      if (error) { error.textContent = ''; error.hidden = true; }
      var input = $((prefix === 're-' ? REGISTER_INPUTS : LOGIN_INPUTS)[field]);
      if (input) input.classList.remove('is-invalid');
    });
  }

  function showErrors(prefix, fields, errors) {
    var inputs = prefix === 're-' ? REGISTER_INPUTS : LOGIN_INPUTS;
    var firstInvalid = null;

    fields.forEach(function (field) {
      var message = errors[field];
      var error = $(prefix + field);
      var input = $(inputs[field]);

      if (message) {
        if (error) { error.textContent = message; error.hidden = false; }
        if (input) {
          input.classList.add('is-invalid');
          if (!firstInvalid) firstInvalid = input;
        }
      } else {
        if (error) { error.textContent = ''; error.hidden = true; }
        if (input) input.classList.remove('is-invalid');
      }
    });

    if (errors.form) window.UI.toast(errors.form, 'error');
    if (firstInvalid) firstInvalid.focus();
  }

  /* ---------------------------------------------------------------- logo */

  function paintLogoPreview(preview, clearButton, dataUrl, fallbackName) {
    preview.textContent = '';
    if (dataUrl) {
      var img = document.createElement('img');
      img.src = dataUrl;
      img.alt = '';
      preview.appendChild(img);
      preview.classList.add('has-logo');
      if (clearButton) clearButton.hidden = false;
    } else {
      preview.textContent = window.UI.initials(fallbackName || '');
      preview.classList.remove('has-logo');
      if (clearButton) clearButton.hidden = true;
    }
  }

  function pickLogo(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = ''; // let the same file be chosen again

    window.UI.readImageFile(file, function (result) {
      var error = $('re-logo');
      if (!result.ok) {
        error.textContent = result.error;
        error.hidden = false;
        return;
      }
      error.textContent = '';
      error.hidden = true;
      pendingLogo = result.dataUrl;
      paintLogoPreview(el.logoPreview, el.logoClear, pendingLogo, el.schoolName.value);
    });
  }

  /* ------------------------------------------------------------ register */

  function submitRegister(event) {
    event.preventDefault();

    var payload = {
      schoolName: el.schoolName.value,
      directorName: el.director.value,
      username: el.username.value,
      password: el.password.value,
      confirmPassword: el.confirm.value,
      logo: pendingLogo
    };

    var result = Auth.register(payload);

    if (!result.ok) {
      showErrors('re-', REGISTER_FIELDS, result.errors);
      return;
    }

    // The account must actually be on disk before anyone is signed into it.
    window.UI.afterSave(function () {
      // Registering does not create a session on its own, so sign the new
      // school straight in rather than making them retype what they chose.
      var signIn = Auth.login(payload.username, payload.password, true);
      if (!signIn.ok) {
        window.UI.toast('Account created. Please sign in.', 'error');
        show('login');
        el.identifier.value = payload.username;
        return;
      }

      window.UI.afterSave(function () {
        resetForms();
        window.UI.enterApp();
        window.UI.toast('Welcome, ' + result.account.schoolName);
      });
    });
  }

  /* --------------------------------------------------------------- login */

  function submitLogin(event) {
    event.preventDefault();

    var result = Auth.login(el.identifier.value, el.loginPassword.value, el.remember.checked);

    if (!result.ok) {
      showErrors('le-', LOGIN_FIELDS, result.errors);
      return;
    }

    // The app opens either way; a session that could not be written just
    // means this sign-in will not survive a restart, which afterSave reports.
    window.UI.afterSave(function () {
      resetForms();
      window.UI.enterApp();
      window.UI.toast('Signed in to ' + result.account.schoolName);
    }, function () {
      resetForms();
      window.UI.enterApp();
    });
  }

  /* ---------------------------------------------------------------- view */

  function resetForms() {
    el.registerForm.reset();
    el.loginForm.reset();
    el.remember.checked = true;
    pendingLogo = '';
    paintLogoPreview(el.logoPreview, el.logoClear, '', '');
    clearErrors('re-', REGISTER_FIELDS);
    clearErrors('le-', LOGIN_FIELDS);
    resetReveals();
  }

  function resetReveals() {
    var buttons = document.querySelectorAll('.reveal');
    for (var i = 0; i < buttons.length; i++) {
      var input = $(buttons[i].getAttribute('data-reveal'));
      if (input) input.type = 'password';
      buttons[i].textContent = 'Show';
      buttons[i].setAttribute('aria-label', 'Show password');
    }
  }

  /** Show the setup form or the sign-in form. */
  function show(next) {
    // With no account on the device there is nothing to sign in to.
    if (next !== 'register' && !Auth.hasAccounts()) next = 'register';
    mode = next === 'register' ? 'register' : 'login';

    el.registerForm.hidden = mode !== 'register';
    el.loginForm.hidden = mode !== 'login';

    // Only offer "sign in instead" when there is an account to sign in to.
    el.toLogin.parentNode.hidden = !Auth.hasAccounts();

    el.brandName.textContent = 'School Attendance';
    resetReveals();

    var first = mode === 'register' ? el.schoolName : el.identifier;
    window.setTimeout(function () { try { first.focus(); } catch (err) { /* ignore */ } }, 60);
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    if (started) return;
    started = true;

    el.registerForm = $('register-form');
    el.loginForm = $('login-form');
    el.brandName = $('auth-brand-name');

    el.schoolName = $('r-school');
    el.director = $('r-director');
    el.username = $('r-username');
    el.password = $('r-password');
    el.confirm = $('r-confirm');
    el.logoInput = $('r-logo');
    el.logoPreview = $('r-logo-preview');
    el.logoPick = $('r-logo-pick');
    el.logoClear = $('r-logo-clear');

    el.identifier = $('l-identifier');
    el.loginPassword = $('l-password');
    el.remember = $('l-remember');

    el.toLogin = $('to-login');
    el.toRegister = $('to-register');

    el.registerForm.addEventListener('submit', submitRegister);
    el.loginForm.addEventListener('submit', submitLogin);

    el.toLogin.addEventListener('click', function () { show('login'); });
    el.toRegister.addEventListener('click', function () { show('register'); });

    el.logoPick.addEventListener('click', function () { el.logoInput.click(); });
    el.logoInput.addEventListener('change', pickLogo);
    el.logoClear.addEventListener('click', function () {
      pendingLogo = '';
      paintLogoPreview(el.logoPreview, el.logoClear, '', el.schoolName.value);
    });

    // Keep the placeholder mark in step with the name being typed.
    el.schoolName.addEventListener('input', function () {
      if (!pendingLogo) paintLogoPreview(el.logoPreview, el.logoClear, '', this.value);
    });

    // Clear a field's error as soon as it is being corrected.
    REGISTER_FIELDS.forEach(function (field) {
      var input = $(REGISTER_INPUTS[field]);
      if (!input) return;
      input.addEventListener('input', function () {
        this.classList.remove('is-invalid');
        var error = $('re-' + field);
        if (error) { error.textContent = ''; error.hidden = true; }
      });
    });

    LOGIN_FIELDS.forEach(function (field) {
      var input = $(LOGIN_INPUTS[field]);
      if (!input) return;
      input.addEventListener('input', function () {
        this.classList.remove('is-invalid');
        var error = $('le-' + field);
        if (error) { error.textContent = ''; error.hidden = true; }
      });
    });

    var reveals = document.querySelectorAll('.reveal');
    for (var i = 0; i < reveals.length; i++) {
      reveals[i].addEventListener('click', function () {
        var input = $(this.getAttribute('data-reveal'));
        if (!input) return;
        var hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        this.textContent = hidden ? 'Hide' : 'Show';
        this.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
        try { input.focus(); } catch (err) { /* ignore */ }
      });
    }

    paintLogoPreview(el.logoPreview, el.logoClear, '', '');
  }

  window.AuthUI = { init: init, show: show, mode: function () { return mode; } };

}(window, document));
