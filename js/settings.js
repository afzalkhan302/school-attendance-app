/* ==========================================================================
   settings.js — school profile, credentials, logo and sign-out.
   Every change goes through SchoolDB.Auth, which owns the validation.
   ========================================================================== */

(function (window, document) {
  'use strict';

  var Auth = window.SchoolDB.Auth;

  var PROFILE_FIELDS = ['schoolName', 'directorName'];
  var USERNAME_FIELDS = ['username', 'currentPassword'];
  var PASSWORD_FIELDS = ['currentPassword', 'password', 'confirmPassword'];

  var PROFILE_INPUTS = { schoolName: 's-school', directorName: 's-director' };
  var USERNAME_INPUTS = { username: 's-username', currentPassword: 's-username-pw' };
  var PASSWORD_INPUTS = { currentPassword: 's-current', password: 's-new', confirmPassword: 's-confirm' };

  var el = {};
  var started = false;

  function $(id) { return document.getElementById(id); }

  /* --------------------------------------------------------------- errors */

  function clear(prefix, fields, inputs) {
    fields.forEach(function (field) {
      var error = $(prefix + field);
      if (error) { error.textContent = ''; error.hidden = true; }
      var input = $(inputs[field]);
      if (input) input.classList.remove('is-invalid');
    });
  }

  function show(prefix, fields, inputs, errors) {
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

  /* --------------------------------------------------------------- render */

  function render() {
    var account = Auth.current();
    if (!account) return;

    el.school.textContent = account.schoolName;
    el.director.textContent = account.directorName ? 'Director: ' + account.directorName : '';
    el.username.textContent = 'Username: ' + account.username;

    window.UI.paintMark(el.logoPreview, account);

    el.schoolInput.value = account.schoolName;
    el.directorInput.value = account.directorName;
    el.usernameInput.value = account.username;

    el.logoClear.hidden = !account.logo;

    clear('se-', PROFILE_FIELDS, PROFILE_INPUTS);
    clear('se-', USERNAME_FIELDS, USERNAME_INPUTS);
    clear('pe-', PASSWORD_FIELDS, PASSWORD_INPUTS);

    window.UI.setSubtitle('settings', 'School settings');
  }

  /* -------------------------------------------------------------- profile */

  function submitProfile(event) {
    event.preventDefault();

    var result = Auth.updateProfile({
      schoolName: el.schoolInput.value,
      directorName: el.directorInput.value
    });

    if (!result.ok) {
      show('se-', PROFILE_FIELDS, PROFILE_INPUTS, result.errors);
      return;
    }

    window.UI.applyBranding();
    render();

    window.UI.afterSave(function () {
      window.UI.toast('School profile saved');
    }, function () {
      // The change was rolled back; put the stored values back on screen.
      window.UI.applyBranding();
      render();
    });
  }

  /* ------------------------------------------------------------- username */

  function submitUsername(event) {
    event.preventDefault();

    var result = Auth.changeUsername({
      username: el.usernameInput.value,
      currentPassword: el.usernamePassword.value
    });

    if (!result.ok) {
      show('se-', USERNAME_FIELDS, USERNAME_INPUTS, result.errors);
      return;
    }

    el.usernamePassword.value = '';
    render();

    window.UI.afterSave(function () {
      window.UI.toast('Username updated');
    }, render);
  }

  /* ------------------------------------------------------------- password */

  function submitPassword(event) {
    event.preventDefault();

    var result = Auth.changePassword({
      currentPassword: el.currentPassword.value,
      password: el.newPassword.value,
      confirmPassword: el.confirmPassword.value
    });

    if (!result.ok) {
      show('pe-', PASSWORD_FIELDS, PASSWORD_INPUTS, result.errors);
      return;
    }

    el.passwordForm.reset();
    clear('pe-', PASSWORD_FIELDS, PASSWORD_INPUTS);

    window.UI.afterSave(function () {
      window.UI.toast('Password changed');
    });
  }

  /* ----------------------------------------------------------------- logo */

  function pickLogo(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';

    window.UI.readImageFile(file, function (read) {
      var error = $('se-logo');

      if (!read.ok) {
        error.textContent = read.error;
        error.hidden = false;
        return;
      }

      var result = Auth.setLogo(read.dataUrl);
      if (!result.ok) {
        error.textContent = result.errors.logo || 'That logo could not be saved.';
        error.hidden = false;
        return;
      }

      error.textContent = '';
      error.hidden = true;
      window.UI.applyBranding();
      render();

      window.UI.afterSave(function () {
        window.UI.toast('Logo updated');
      }, function () {
        window.UI.applyBranding();
        render();
      });
    });
  }

  function removeLogo() {
    var result = Auth.setLogo('');
    if (!result.ok) return;
    window.UI.applyBranding();
    render();

    window.UI.afterSave(function () {
      window.UI.toast('Logo removed');
    }, function () {
      window.UI.applyBranding();
      render();
    });
  }

  /* --------------------------------------------------------------- logout */

  function logout() {
    var account = Auth.current();
    window.UI.confirm({
      title: 'Log out?',
      text: (account ? account.schoolName + '’s data' : 'Your data') +
            ' stays on this device. You will need your username and password to sign back in.',
      confirmLabel: 'Log out',
      onConfirm: function () { window.UI.signOut(); }
    });
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    if (started) return;
    started = true;

    el.school = $('settings-school');
    el.director = $('settings-director');
    el.username = $('settings-username');
    el.logoPreview = $('s-logo-preview');

    el.profileForm = $('profile-form');
    el.schoolInput = $('s-school');
    el.directorInput = $('s-director');

    el.usernameForm = $('username-form');
    el.usernameInput = $('s-username');
    el.usernamePassword = $('s-username-pw');

    el.passwordForm = $('password-form');
    el.currentPassword = $('s-current');
    el.newPassword = $('s-new');
    el.confirmPassword = $('s-confirm');

    el.logoInput = $('s-logo');
    el.logoPick = $('s-logo-pick');
    el.logoClear = $('s-logo-clear');

    el.profileForm.addEventListener('submit', submitProfile);
    el.usernameForm.addEventListener('submit', submitUsername);
    el.passwordForm.addEventListener('submit', submitPassword);

    el.logoPick.addEventListener('click', function () { el.logoInput.click(); });
    el.logoInput.addEventListener('change', pickLogo);
    el.logoClear.addEventListener('click', removeLogo);

    $('logout-btn').addEventListener('click', logout);

    // Clear a field's error as soon as it is being corrected.
    [[PROFILE_FIELDS, PROFILE_INPUTS, 'se-'],
     [USERNAME_FIELDS, USERNAME_INPUTS, 'se-'],
     [PASSWORD_FIELDS, PASSWORD_INPUTS, 'pe-']].forEach(function (group) {
      group[0].forEach(function (field) {
        var input = $(group[1][field]);
        if (!input) return;
        input.addEventListener('input', function () {
          this.classList.remove('is-invalid');
          var error = $(group[2] + field);
          if (error) { error.textContent = ''; error.hidden = true; }
        });
      });
    });

    window.UI.onEnter('settings', render);
    window.UI.on('account-changed', function () {
      if (Auth.isSignedIn()) render();
    });
  }

  window.SettingsUI = { init: init, render: render };

}(window, document));
