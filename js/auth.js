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

    /* Validated locally first, so a bad form is caught without a round trip
       and the field-level messages are the same either way. */
    var check = Auth.validate(payload, null, {});
    if (!check.valid) {
      showErrors('re-', REGISTER_FIELDS, check.errors);
      return;
    }

    busy(el.registerSubmit, true, 'Creating…');

    /* CloudSync creates the account in the cloud first when cloud accounts are
       switched on, and signs in locally either way. With them off this is the
       same local register + login as before. */
    window.CloudSync.register(payload, function (result) {
      busy(el.registerSubmit, false);

      if (!result.ok) {
        showErrors('re-', REGISTER_FIELDS, result.errors);
        return;
      }

      // The account must actually be on disk before anyone is let in.
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

    busy(el.loginSubmit, true, 'Signing in…');

    /* With cloud accounts on, this checks Firebase first so the same username
       and password work on a phone that has never seen this school — and falls
       back to the local check when there is no signal. With them off it is the
       same local sign-in as before. */
    window.CloudSync.login(
      el.identifier.value, el.loginPassword.value, el.remember.checked,
      function (result) {
        busy(el.loginSubmit, false);

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
    );
  }

  /* Sign-in and setup can now involve a network round trip, so the button has
     to say something is happening and refuse a second tap. */
  function busy(button, on, label) {
    if (!button) return;
    if (on) {
      button.dataset.idleLabel = button.dataset.idleLabel || button.textContent;
      button.textContent = label || button.textContent;
      button.disabled = true;
      return;
    }
    if (button.dataset.idleLabel) button.textContent = button.dataset.idleLabel;
    button.disabled = false;
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

  /** Show the sign-in form or the setup form. */
  function show(next) {
    /* Sign-in is offered even with no account on this device: the account may
       exist in the cloud and this may be the teacher's second phone. Both ways
       between the two forms stay open, so nobody can be stranded on one. */
    mode = next === 'register' ? 'register' : 'login';

    el.registerForm.hidden = mode !== 'register';
    el.loginForm.hidden = mode !== 'login';

    el.toLogin.parentNode.hidden = false;

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

    el.registerSubmit = $('r-submit');

    el.identifier = $('l-identifier');
    el.loginPassword = $('l-password');
    el.remember = $('l-remember');
    el.loginSubmit = $('l-submit');

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
