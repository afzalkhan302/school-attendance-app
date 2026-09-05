/* Loads the real index.html in jsdom over a real HTTP server, so the actual
   markup, script order and event wiring are exercised — not a mock.
   jsdom is a devDependency; nothing here ships with the app. */

'use strict';

var path = require('path');
var { JSDOM, VirtualConsole } = require('jsdom');
var { createServer } = require(path.resolve(__dirname, '..', 'tools', 'serve.js'));

// The app's own hashing, so seeded accounts have real, verifiable passwords.
require(path.resolve(__dirname, '..', 'js', 'crypto.js'));
var Crypto = globalThis.SchoolCrypto;

var ACCOUNTS_KEY = 'sa.accounts.v1';
var SESSION_KEY = 'sa.session.v1';

var DEFAULT_ACCOUNT = {
  id: 'acc_test_a',
  schoolName: 'Test School',
  directorName: 'Test Director',
  username: 'test_admin',
  password: 'secret123'
};

/* Hashing is deliberately slow, so cache it — fixtures reuse a few passwords. */
var hashCache = {};

function hashFor(password, salt) {
  var key = password + '|' + salt;
  if (!hashCache[key]) {
    hashCache[key] = Crypto.hashPassword(password, salt, Crypto.DEFAULT_ITERATIONS);
  }
  return hashCache[key];
}

/** A stored account row, exactly as the app writes one. */
function buildAccount(spec) {
  spec = spec || {};
  var salt = spec.salt || 'ffeeddccbbaa99887766554433221100';
  var password = spec.password || DEFAULT_ACCOUNT.password;

  return {
    id: spec.id || DEFAULT_ACCOUNT.id,
    schoolName: spec.schoolName || DEFAULT_ACCOUNT.schoolName,
    directorName: spec.directorName || DEFAULT_ACCOUNT.directorName,
    username: spec.username || DEFAULT_ACCOUNT.username,
    salt: salt,
    iterations: Crypto.DEFAULT_ITERATIONS,
    passwordHash: hashFor(password, salt),
    logo: spec.logo || '',
    createdAt: spec.createdAt || 1,
    updatedAt: spec.updatedAt || 1
  };
}

var server = null;
var origin = '';

function startServer() {
  server = createServer();
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      origin = 'http://127.0.0.1:' + server.address().port + '/';
      resolve();
    });
  });
}

function stopServer() {
  if (server) server.close();
  server = null;
}

/**
 * Open the app fresh.
 *
 *   openApp()                       one school, signed in, no data
 *   openApp({ account: null })      a blank device — the setup screen
 *   openApp({ signedIn: false })    an account exists but nobody is signed in
 *   openApp({ accounts: [a, b] })   two schools on one device
 *   openApp({ students, attendance })  seeded data for the first school
 */
async function openApp(seed) {
  seed = seed || {};

  var accounts = null;
  var primary = null;

  if (seed.account !== null) {
    accounts = (seed.accounts || [seed.account || {}]).map(buildAccount);
    primary = accounts[0];
  }

  var signedIn = !!primary && seed.signedIn !== false;

  var virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', function (err) {
    if (/Could not parse CSS|Not implemented/.test(err.message)) return;
    console.error('  [page error] ' + err.message);
  });

  var dom = await JSDOM.fromURL(origin, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: virtualConsole,
    beforeParse: function (window) {
      window.scrollTo = function () {};
      window.localStorage.clear();
      try { window.sessionStorage.clear(); } catch (err) { /* ignore */ }

      // jsdom ships no IndexedDB, so a suite that wants the IndexedDB code
      // path supplies a factory (fake-indexeddb) here. Reusing one factory
      // across openApp calls models the same device being relaunched.
      if (seed.indexedDB) {
        Object.defineProperty(window, 'indexedDB', {
          configurable: true, writable: true, value: seed.indexedDB
        });
      }

      if (accounts) {
        window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
      }
      if (signedIn) {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify({
          accountId: primary.id, remember: true, at: 1
        }));
      }
      if (primary && seed.students !== undefined) {
        window.localStorage.setItem('sa.' + primary.id + '.students.v1',
          JSON.stringify(seed.students));
      }
      if (primary && seed.attendance !== undefined) {
        window.localStorage.setItem('sa.' + primary.id + '.attendance.v1',
          JSON.stringify(seed.attendance));
      }
      if (seed.legacyStudents !== undefined) {
        window.localStorage.setItem('sa.students.v1', JSON.stringify(seed.legacyStudents));
      }
    }
  });

  await new Promise(function (resolve) {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
  });

  var page = buildPage(dom);
  page.account = primary;

  // Opening IndexedDB is asynchronous, so wait until the app has decided
  // what to show rather than asserting against a blank first paint.
  await page.settled();
  return page;
}

function buildPage(dom) {
  var document = dom.window.document;

  var page = {
    dom: dom,
    window: dom.window,
    document: document,

    $: function (selector) { return document.querySelector(selector); },
    $$: function (selector) {
      return Array.prototype.slice.call(document.querySelectorAll(selector));
    },

    close: function () { dom.window.close(); },
    tick: function () {
      return new Promise(function (resolve) { dom.window.setTimeout(resolve, 60); });
    },

    /**
     * Poll until `condition` holds. Writes settle asynchronously on the
     * IndexedDB backend, and password hashing blocks in between, so a fixed
     * delay is not a reliable way to wait for a chain of saves.
     */
    waitFor: async function (condition, label) {
      for (var i = 0; i < 80; i++) {
        if (condition()) return true;
        await page.tick();
      }
      throw new Error('timed out waiting for ' + (label || 'condition'));
    },

    /** Resolve once the boot has produced either the auth view or the app. */
    settled: async function () {
      for (var i = 0; i < 60; i++) {
        var auth = page.$('#auth-view'), app = page.$('#app-view');
        if (auth && app && (!auth.hidden || !app.hidden)) break;
        await page.tick();
      }
      return page.tick();
    },

    backend: function () { return dom.window.SchoolDB.backend(); },
    migration: function () { return dom.window.SchoolDB.migration(); },

    /** Student names straight from the model, whatever the backend. */
    dbStudents: function () {
      return dom.window.SchoolDB.Students.all().map(function (s) { return s.name; });
    },

    dbAttendanceCount: function () { return dom.window.SchoolDB.Attendance.count(); },
    signedIn: function () { return dom.window.SchoolDB.Auth.isSignedIn(); },

    text: function (selector) {
      var el = page.$(selector);
      return el ? el.textContent : null;
    },

    /* -------------------------------------------------------- storage */

    /** The account the page is currently signed in as, or '' when signed out. */
    accountId: function () {
      return dom.window.SchoolDB.Auth.activeAccountId();
    },

    accounts: function () {
      var raw = dom.window.localStorage.getItem(ACCOUNTS_KEY);
      return raw ? JSON.parse(raw) : [];
    },

    session: function () {
      var raw = dom.window.localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    },

    rawKey: function (key) { return dom.window.localStorage.getItem(key); },

    storedFor: function (accountId) {
      var raw = dom.window.localStorage.getItem('sa.' + accountId + '.students.v1');
      return raw ? JSON.parse(raw) : [];
    },

    attendanceFor: function (accountId) {
      var raw = dom.window.localStorage.getItem('sa.' + accountId + '.attendance.v1');
      return raw ? JSON.parse(raw) : {};
    },

    stored: function () {
      var id = page.accountId();
      return id ? page.storedFor(id) : [];
    },

    storedAttendance: function () {
      var id = page.accountId();
      return id ? page.attendanceFor(id) : {};
    },

    attendanceCount: function () {
      return Object.keys(page.storedAttendance()).length;
    },

    /* ------------------------------------------------------ interaction */

    type: function (selector, value) {
      var input = page.$(selector);
      input.value = value;
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      return input;
    },

    /** Set a <select> or date input and fire `change`, as a tap would. */
    pick: function (selector, value) {
      var control = page.$(selector);
      control.value = value;
      control.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      return control;
    },

    check: function (selector, on) {
      var box = page.$(selector);
      box.checked = !!on;
      box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      return box;
    },

    submitForm: function (selector) {
      page.$(selector).dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true })
      );
    },

    press: function (key) {
      document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: key, bubbles: true }));
    },

    goTo: function (screen) {
      page.$('.tab[data-screen="' + screen + '"]').click();
    },

    confirmYes: function () { page.$('#confirm-yes').click(); },
    confirmNo: function () { page.$('#confirm-no').click(); },
    confirmOpen: function () { return page.$('#confirm').hidden === false; },
    toastText: function () {
      var toast = page.$('#toast');
      return toast.hidden ? '' : toast.textContent;
    },

    /* ------------------------------------------------------------- auth */

    authVisible: function () { return page.$('#auth-view').hidden === false; },
    appVisible: function () { return page.$('#app-view').hidden === false; },
    registerVisible: function () { return page.$('#register-form').hidden === false; },
    loginVisible: function () { return page.$('#login-form').hidden === false; },

    /** Error text under an auth field, or '' when clear. */
    authError: function (id) {
      var el = page.$('#' + id);
      return !el || el.hidden ? '' : el.textContent;
    },

    fillRegister: function (data) {
      page.type('#r-school', data.schoolName || '');
      page.type('#r-director', data.directorName || '');
      page.type('#r-username', data.username || '');
      page.type('#r-password', data.password || '');
      page.type('#r-confirm', data.confirmPassword !== undefined
        ? data.confirmPassword : (data.password || ''));
    },

    doRegister: function (data) {
      page.fillRegister(data);
      page.submitForm('#register-form');
    },

    doLogin: function (identifier, password, remember) {
      page.type('#l-identifier', identifier);
      page.type('#l-password', password);
      if (remember !== undefined) page.check('#l-remember', remember);
      page.submitForm('#login-form');
    },

    schoolName: function () { return page.text('#appbar-school'); },

    /** Sign out through the settings screen, confirming the dialog. */
    doLogout: function () {
      page.goTo('settings');
      page.$('#logout-btn').click();
      page.confirmYes();
    },

    /* --------------------------------------------------------- students */

    cards: function () { return page.$$('#student-list .card'); },

    names: function () {
      return page.cards().map(function (card) {
        return card.querySelector('.card__name').textContent;
      });
    },

    groupLabels: function () {
      return page.$$('#student-list .group__head').map(function (head) {
        return head.firstChild.textContent;
      });
    },

    errorFor: function (field) {
      var el = page.$('#e-' + field);
      return el.hidden ? '' : el.textContent;
    },

    fillForm: function (student) {
      page.type('#f-name', student.name);
      page.type('#f-father', student.fatherName || '');
      page.type('#f-roll', student.roll);
      page.type('#f-class', student.className);
      page.type('#f-section', student.section);
    },

    /** Father-name line on a student card, or '' when the student has none. */
    fatherOf: function (name) {
      var card = page.cards().filter(function (c) {
        return c.querySelector('.card__name').textContent === name;
      })[0];
      if (!card) return null;
      var line = card.querySelector('.card__father');
      return line ? line.textContent : '';
    },

    openDetail: function (name) {
      var card = page.cards().filter(function (c) {
        return c.querySelector('.card__name').textContent === name;
      })[0];
      if (!card) throw new Error('no student card for "' + name + '"');
      card.querySelector('.card__body').click();
    },

    /* --------------------------------------------------------- dashboard */

    dash: function () {
      return {
        school: page.text('#dash-school'),
        director: page.text('#dash-director'),
        date: page.text('#dash-today'),
        total: Number(page.text('#dash-total')),
        present: Number(page.text('#dash-present')),
        absent: Number(page.text('#dash-absent')),
        leave: Number(page.text('#dash-leave')),
        percent: page.text('#dash-percent'),
        note: page.text('#dash-today-note'),
        action: page.text('#dash-action').trim()
      };
    },

    dashRecent: function () {
      return page.$$('#dash-recent .dayrow').map(function (row) {
        return {
          date: row.getAttribute('data-date'),
          label: row.querySelector('.dayrow__date').textContent,
          percent: row.querySelector('.dayrow__pct').textContent,
          tallies: Array.prototype.slice.call(row.querySelectorAll('.tally'))
            .map(function (t) { return t.textContent; })
        };
      });
    },

    submit: function () { page.submitForm('#student-form'); },

    addStudent: function (student) {
      page.$('#fab-add').click();
      page.fillForm(student);
      page.submit();
    },

    /* ------------------------------------------------------- attendance */

    attRows: function () { return page.$$('#a-list .att'); },

    attNames: function () {
      return page.attRows().map(function (row) {
        return row.querySelector('.att__name').textContent;
      });
    },

    attRow: function (name) {
      var match = page.attRows().filter(function (row) {
        return row.querySelector('.att__name').textContent === name;
      });
      return match[0] || null;
    },

    mark: function (name, status) {
      var row = page.attRow(name);
      if (!row) throw new Error('no attendance row for "' + name + '"');
      row.querySelector('.seg__btn--' + status).click();
    },

    markOf: function (name) {
      var row = page.attRow(name);
      if (!row) return null;
      var on = row.querySelector('.seg__btn.is-on');
      return on ? on.getAttribute('data-status') : '';
    },

    attCounts: function () {
      return {
        present: Number(page.text('#a-n-present')),
        absent: Number(page.text('#a-n-absent')),
        leave: Number(page.text('#a-n-leave')),
        pending: Number(page.text('#a-n-pending'))
      };
    },

    saveAttendance: function () { page.$('#a-save').click(); },

    /* ---------------------------------------------------------- records */

    recRows: function () { return page.$$('#r-list .rec'); },

    recNames: function () {
      return page.recRows().map(function (row) {
        return row.querySelector('.rec__name').textContent;
      });
    },

    recStatuses: function () {
      return page.recRows().map(function (row) {
        var pill = row.querySelector('.pill');
        return pill ? pill.textContent : '';
      });
    },

    recSummary: function () {
      return {
        school: page.text('#r-summary-school'),
        title: page.text('#r-summary-title'),
        present: Number(page.text('#r-s-present')),
        absent: Number(page.text('#r-s-absent')),
        leave: Number(page.text('#r-s-leave')),
        percent: page.text('#r-s-pct'),
        visible: page.$('#r-summary').hidden === false
      };
    },

    /* --------------------------------------------------------- settings */

    settingsError: function (id) {
      var el = page.$('#' + id);
      return !el || el.hidden ? '' : el.textContent;
    }
  };

  return page;
}

module.exports = {
  startServer: startServer,
  stopServer: stopServer,
  openApp: openApp,
  buildAccount: buildAccount,
  DEFAULT_ACCOUNT: DEFAULT_ACCOUNT,
  ACCOUNTS_KEY: ACCOUNTS_KEY,
  SESSION_KEY: SESSION_KEY
};
