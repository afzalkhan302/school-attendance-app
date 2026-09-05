/* ==========================================================================
   app.js — shell: decides between the auth screens and the app, owns tab
   navigation, school branding, and the shared UI pieces (backdrop, bottom
   sheet, confirm dialog, toast) that the feature screens reuse.
   ========================================================================== */

(function (window, document) {
  'use strict';

  function $(selector) { return document.querySelector(selector); }

  var Auth = window.SchoolDB.Auth;

  var SCREENS = ['dashboard', 'students', 'attendance', 'records', 'settings'];

  var DEFAULT_SUBTITLES = {
    dashboard: 'Overview',
    students: 'Student register',
    attendance: 'Mark attendance',
    records: 'Attendance records',
    settings: 'School settings'
  };

  var LOGO_MAX_EDGE = 256;      // px — plenty for an app bar mark
  var LOGO_MAX_BYTES = 4000000; // reject enormous originals before reading

  var backdrop, toastEl, toastTimer = null;
  var activeScreen = null;
  var screensReady = false;

  /* Both views start hidden, so nothing is on screen until boot routes to one
     of them. If storage never answers, that has to stop being a blank page. */
  var BOOT_TIMEOUT_MS = 9000;
  var bootTimer = null;
  var routed = false;

  /* ------------------------------------------------------------- overlays */

  /* Only one overlay is ever open, so a single flag keeps the backdrop, the
     Escape key and the tap-outside gesture in agreement. */
  var openOverlay = null; // { el, onClose }

  /* The root element is the page's scroll container, so the lock goes there.
     Hiding its overflow drops the scroll offset on Android, hence putting it
     back — otherwise closing a sheet returns the teacher to the top of a long
     register instead of the row they were working on. */
  var lockedScrollY = 0;

  function lockScroll(locked) {
    var root = document.documentElement;
    if (locked) {
      lockedScrollY = window.pageYOffset || root.scrollTop || 0;
      root.classList.add('is-locked');
      return;
    }
    if (!root.classList.contains('is-locked')) return;
    root.classList.remove('is-locked');
    try { window.scrollTo(0, lockedScrollY); } catch (err) { /* ignore */ }
  }

  function showOverlay(el, onClose) {
    if (openOverlay) closeOverlay();
    openOverlay = { el: el, onClose: onClose || null };
    backdrop.hidden = false;
    el.hidden = false;
    lockScroll(true);
  }

  function closeOverlay() {
    if (!openOverlay) return;
    var current = openOverlay;
    openOverlay = null;
    current.el.hidden = true;
    backdrop.hidden = true;
    lockScroll(false);
    if (current.onClose) current.onClose();
  }

  function isOverlayOpen(el) {
    return !!openOverlay && (!el || openOverlay.el === el);
  }

  /* ---------------------------------------------------------------- toast */

  function toast(message, kind) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = 'toast' + (kind ? ' toast--' + kind : '');
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  /* -------------------------------------------------------------- confirm */

  var confirmState = null;

  function confirmDialog(options) {
    var el = $('#confirm');
    $('#confirm-title').textContent = options.title || 'Are you sure?';
    $('#confirm-text').textContent = options.text || '';

    var yes = $('#confirm-yes');
    yes.textContent = options.confirmLabel || 'Confirm';
    yes.className = 'btn ' + (options.tone === 'primary' ? 'btn--primary' : 'btn--danger');
    $('#confirm-no').textContent = options.cancelLabel || 'Cancel';

    confirmState = { onConfirm: options.onConfirm || null };
    showOverlay(el, function () { confirmState = null; });
    $('#confirm-no').focus();
  }

  /* ------------------------------------------------------------ event bus */

  /* Screens are independent modules, so they announce changes rather than
     reaching into each other. Signing in as another school, for instance, has
     to reach every screen at once. */
  var listeners = {};

  function on(event, handler) {
    (listeners[event] = listeners[event] || []).push(handler);
  }

  function emit(event, payload) {
    (listeners[event] || []).forEach(function (handler) { handler(payload); });
  }

  /* --------------------------------------------------------------- brand */

  /** Up to two initials, so a school without a logo still gets a mark. */
  function initials(name) {
    var words = String(name || '').split(' ').filter(Boolean);
    if (!words.length) return '?';
    var first = words[0].charAt(0);
    var last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  }

  /** Paint a logo (or initials) into a mark element. */
  function paintMark(el, account) {
    if (!el) return;
    el.textContent = '';
    if (account && account.logo) {
      var img = document.createElement('img');
      img.src = account.logo;
      img.alt = '';
      el.appendChild(img);
      el.classList.add('has-logo');
    } else {
      el.textContent = initials(account && account.schoolName);
      el.classList.remove('has-logo');
    }
  }

  /** The school name follows the app everywhere: app bar, reports, settings. */
  function applyBranding() {
    var account = Auth.current();
    var name = account ? account.schoolName : 'School Attendance';

    $('#appbar-school').textContent = name;
    paintMark($('#appbar-logo'), account);
    document.title = account ? name + ' — School Attendance' : 'School Attendance';

    emit('branding-changed', account);
  }

  /* ----------------------------------------------------------- navigation */

  /* A screen may register a guard to intercept leaving it — used by the
     attendance screen to protect unsaved marks. A guard is handed a
     `proceed` callback and decides when (or whether) to call it. */
  var guards = {};
  var enterHooks = {};

  function setGuard(screen, guard) { guards[screen] = guard; }
  function onEnter(screen, hook) { enterHooks[screen] = hook; }

  function showScreen(name, force) {
    if (SCREENS.indexOf(name) === -1) return;
    if (name === activeScreen) return;

    var guard = activeScreen && guards[activeScreen];
    if (guard && !force) {
      guard(function () { showScreen(name, true); });
      return;
    }

    activeScreen = name;

    SCREENS.forEach(function (screen) {
      var el = $('#screen-' + screen);
      if (!el) return;
      var active = screen === name;
      el.classList.toggle('is-active', active);
      el.hidden = !active;
    });

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      var on = tab.getAttribute('data-screen') === name;
      tab.classList.toggle('is-active', on);
      if (on) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }

    $('#appbar-sub').textContent = DEFAULT_SUBTITLES[name] || '';
    $('#fab-add').hidden = name !== 'students';
    $('#savebar').hidden = name !== 'attendance';

    window.scrollTo(0, 0);

    var hook = enterHooks[name];
    if (hook) hook();
  }

  /** Screens own their subtitle, but only while they are the visible one. */
  function setSubtitle(screen, value) {
    if (screen !== activeScreen) return;
    $('#appbar-sub').textContent = value;
  }

  /* -------------------------------------------------------- auth routing */

  function showAuth(mode) {
    closeOverlay();
    activeScreen = null;
    routed = true;

    $('#app-view').hidden = true;
    $('#auth-view').hidden = false;
    $('#fab-add').hidden = true;
    $('#savebar').hidden = true;

    document.title = 'School Attendance';
    if (window.AuthUI) window.AuthUI.show(mode);
    window.scrollTo(0, 0);
  }

  /** Called after a successful sign-in, and on boot with a live session. */
  function enterApp() {
    if (!Auth.isSignedIn()) { showAuth('login'); return; }

    routed = true;
    closeOverlay();

    $('#auth-view').hidden = true;
    $('#app-view').hidden = false;

    if (!screensReady) {
      screensReady = true;
      if (window.DashboardUI) window.DashboardUI.init();
      if (window.StudentsUI) window.StudentsUI.init();
      if (window.AttendanceUI) window.AttendanceUI.init();
      if (window.RecordsUI) window.RecordsUI.init();
      if (window.SettingsUI) window.SettingsUI.init();
    }

    applyBranding();

    // Every screen holds cached rows and filters from whoever was signed in
    // before — make them all rebuild against the new account.
    activeScreen = null;
    emit('account-changed', Auth.current());

    showScreen('dashboard', true);
  }

  function signOut() {
    Auth.logout();
    emit('account-changed', null);
    showAuth('login');
    toast('Signed out');
  }

  /* ------------------------------------------------------------ download */

  /**
   * Hand the viewer a generated file. Blob URLs are the good path; the data:
   * URI fallback covers older WebViews where createObjectURL is missing.
   */
  function download(filename, content, mime) {
    var type = (mime || 'text/csv') + ';charset=utf-8';
    var url, revoke = false;

    try {
      url = window.URL.createObjectURL(new window.Blob([content], { type: type }));
      revoke = true;
    } catch (err) {
      url = 'data:' + type + ',' + encodeURIComponent(content);
    }

    try {
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      return false;
    }

    if (revoke) {
      window.setTimeout(function () {
        try { window.URL.revokeObjectURL(url); } catch (err) { /* ignore */ }
      }, 2000);
    }
    return true;
  }

  /* --------------------------------------------------- cross-screen jumps */

  /** Dashboard rows open the matching day in the records report. */
  function openRecordsOn(date) {
    showScreen('records');
    if (window.RecordsUI && window.RecordsUI.showDate) window.RecordsUI.showDate(date);
  }

  /* ------------------------------------------------------- image picking */

  /**
   * Read a picked image and shrink it to something a phone can store. Falls
   * back to the original data URL where canvas is unavailable, and refuses
   * anything that is still too large afterwards.
   */
  function readImageFile(file, done) {
    if (!file) { done({ ok: false, error: 'No image chosen.' }); return; }

    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      done({ ok: false, error: 'Choose a PNG, JPG or WebP image.' });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      done({ ok: false, error: 'That image is too large. Choose one under 4 MB.' });
      return;
    }

    var reader = new window.FileReader();

    reader.onerror = function () { done({ ok: false, error: 'That image could not be read.' }); };

    reader.onload = function () {
      var dataUrl = String(reader.result || '');
      shrink(dataUrl, function (resized) {
        var out = resized || dataUrl;
        if (out.length > 400000) {
          done({ ok: false, error: 'That image is too large to store. Try a smaller one.' });
          return;
        }
        done({ ok: true, dataUrl: out });
      });
    };

    reader.readAsDataURL(file);
  }

  function shrink(dataUrl, done) {
    var image = new window.Image();

    image.onerror = function () { done(null); };

    image.onload = function () {
      try {
        var width = image.naturalWidth || image.width;
        var height = image.naturalHeight || image.height;
        if (!width || !height) { done(null); return; }

        var scale = Math.min(1, LOGO_MAX_EDGE / Math.max(width, height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));

        var context = canvas.getContext('2d');
        if (!context) { done(null); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        done(canvas.toDataURL('image/png'));
      } catch (err) {
        // No canvas (or a tainted one) — keep the original.
        done(null);
      }
    };

    image.src = dataUrl;
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    backdrop = $('#backdrop');
    toastEl = $('#toast');

    backdrop.addEventListener('click', closeOverlay);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && openOverlay) {
        event.preventDefault();
        closeOverlay();
      }
    });

    $('#confirm-no').addEventListener('click', closeOverlay);
    $('#confirm-yes').addEventListener('click', function () {
      var action = confirmState && confirmState.onConfirm;
      closeOverlay();
      if (action) action();
    });

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        showScreen(this.getAttribute('data-screen'));
      });
    }

    if (window.AuthUI) window.AuthUI.init();

    /* Last resort. storage.js bounds each of its own steps, but a WebView that
       stalls somewhere unforeseen must still end up at a sign-in form rather
       than a blank screen. This only ever shows the auth view — signing in is
       the one thing it must not do on the user's behalf. */
    bootTimer = window.setTimeout(function () {
      bootTimer = null;
      if (routed) return;
      showAuth('login');
      toast('Storage is taking longer than usual to open.', 'error');
    }, BOOT_TIMEOUT_MS);

    // Opening IndexedDB is asynchronous, so nothing may be shown until the
    // stored data has been loaded — otherwise the first paint would claim the
    // device is empty.
    window.SchoolDB.ready(function (status) {
      if (bootTimer) { window.clearTimeout(bootTimer); bootTimer = null; }

      // A remembered session goes straight in; otherwise set up or sign in.
      // This runs even if the failsafe above already showed a form, because
      // only now is it known whether there is a session to restore.
      if (Auth.isSignedIn()) enterApp();
      else showAuth(Auth.hasAccounts() ? 'login' : 'register');

      if (!status.persistent) {
        toast('No storage available — nothing you enter will be kept.', 'error');
      }
      emit('storage-ready', status);
    });
  }

  /* --------------------------------------------------------- safe writes */

  /**
   * Wait for the writes a change started to reach the disk before telling the
   * teacher anything. A failed write has already been rolled back by
   * storage.js, so `onFailure` re-renders against what is actually saved.
   */
  function afterSave(onSuccess, onFailure) {
    window.SchoolDB.flush(function (err) {
      if (!err) { if (onSuccess) onSuccess(); return; }

      toast(window.SchoolDB.isPersistent()
        ? 'Could not save — device storage may be full. Nothing was changed.'
        : 'Could not save — this device has no storage available.', 'error');

      if (onFailure) onFailure(err);
    });
  }

  window.UI = {
    $: $,
    showOverlay: showOverlay,
    closeOverlay: closeOverlay,
    isOverlayOpen: isOverlayOpen,
    toast: toast,
    confirm: confirmDialog,
    showScreen: showScreen,
    setSubtitle: setSubtitle,
    activeScreen: function () { return activeScreen; },
    setGuard: setGuard,
    onEnter: onEnter,
    on: on,
    emit: emit,

    // auth + branding
    enterApp: enterApp,
    showAuth: showAuth,
    signOut: signOut,
    applyBranding: applyBranding,
    paintMark: paintMark,
    initials: initials,
    readImageFile: readImageFile,
    download: download,
    openRecordsOn: openRecordsOn,
    afterSave: afterSave
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}(window, document));
