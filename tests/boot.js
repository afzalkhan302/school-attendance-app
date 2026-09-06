/* Boot resilience: whatever the WebView's IndexedDB does, the app must end up
   on a screen. Both views start hidden, so a boot that never finishes is a
   blank phone with no way in. Also covers the overlay scroll lock.
   `npm run test:boot` */

'use strict';

var h = require('./harness');
var { startServer, stopServer, openApp } = require('./helpers');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;

/* ---------------------------------------------------------------- doubles */

/* Hand-rolled rather than fake-indexeddb: these model a WebView that misbehaves
   in ways a correct implementation never does, which is the whole point. */

function requestSettling(settle) {
  var request = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null, error: null };
  setTimeout(function () { settle(request); }, 0);
  return request;
}

/** A database whose read transaction behaves however `onRead` says. */
function databaseThatReads(onRead) {
  return {
    objectStoreNames: { contains: function () { return true; } },
    createObjectStore: function () {},
    close: function () {},
    transaction: function () {
      var transaction = {
        error: null, oncomplete: null, onerror: null, onabort: null,
        objectStore: function () { return store; }
      };
      var store = {
        openCursor: function () {
          return requestSettling(function (request) { onRead(transaction, request); });
        },
        put: function () { return {}; },
        delete: function () { return {}; }
      };
      return transaction;
    }
  };
}

function factoryOpening(database) {
  return {
    open: function () {
      return requestSettling(function (request) {
        request.result = database;
        if (request.onsuccess) request.onsuccess();
      });
    }
  };
}

/** open() that never answers at all — the classic wedged WebView. */
var factoryThatStalls = {
  open: function () {
    return { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null, error: null };
  }
};

/* ==================================== run ================================== */

async function main() {
  await startServer();

  /* ==================================================================== */
  describe('a read transaction that aborts does not strand the app');

  await it('falls back to localStorage and restores the session', async function () {
    var page = await openApp({
      indexedDB: factoryOpening(databaseThatReads(function (transaction) {
        if (transaction.onabort) transaction.onabort();
      })),
      students: [
        { id: 's_1', name: 'Ayesha Khan', fatherName: 'Imran Khan',
          roll: '1', className: '5', section: 'A', createdAt: 1, updatedAt: 1 }
      ]
    });

    equal(page.backend(), 'localstorage', 'dropped back to the working store');
    equal(page.appVisible(), true, 'the app opened rather than hanging');
    equal(page.signedIn(), true, 'the remembered session survived');
    deepEqual(page.dbStudents(), ['Ayesha Khan'], 'and so did the register');
    page.close();
  });

  await it('shows the sign-in form on a blank device rather than nothing', async function () {
    var page = await openApp({
      account: null,
      indexedDB: factoryOpening(databaseThatReads(function (transaction) {
        if (transaction.onabort) transaction.onabort();
      }))
    });

    equal(page.authVisible(), true, 'an auth screen is on display');
    equal(page.loginVisible(), true, 'sign-in first, even with no local account');
    equal(page.appVisible(), false, 'and nobody was let in without signing in');
    page.close();
  });

  /* ==================================================================== */
  describe('a read that reports an error on the transaction');

  await it('is handled like any other read failure', async function () {
    var page = await openApp({
      indexedDB: factoryOpening(databaseThatReads(function (transaction) {
        transaction.error = new Error('read failed');
        if (transaction.onerror) transaction.onerror();
      }))
    });

    equal(page.backend(), 'localstorage');
    equal(page.appVisible(), true);
    page.close();
  });

  /* ==================================================================== */
  describe('an IndexedDB that never answers at all');

  await it('times out and still reaches a sign-in screen', async function () {
    // storage.js bounds the open at 5s, so this test genuinely waits.
    var page = await openApp({ account: null, indexedDB: factoryThatStalls });

    await page.waitFor(function () {
      return page.authVisible() || page.appVisible();
    }, 'boot to route somewhere');

    equal(page.authVisible(), true, 'the setup form is up');
    equal(page.appVisible(), false, 'authentication was not bypassed');
    page.close();
  });

  /* ==================================================================== */
  describe('overlays lock the page scroll, not the body element');

  await it('locks the root while a sheet is open and releases it after', async function () {
    var page = await openApp();
    var root = page.document.documentElement;

    equal(root.classList.contains('is-locked'), false, 'not locked at rest');

    page.goTo('students');
    page.$('#fab-add').click();
    equal(root.classList.contains('is-locked'), true, 'locked while the form is open');

    page.$('#backdrop').click();
    equal(root.classList.contains('is-locked'), false, 'released when it closes');
    page.close();
  });

  await it('releases the lock when a confirm dialog is dismissed', async function () {
    var page = await openApp({
      students: [
        { id: 's_1', name: 'Ayesha Khan', fatherName: 'Imran Khan',
          roll: '1', className: '5', section: 'A', createdAt: 1, updatedAt: 1 }
      ]
    });
    var root = page.document.documentElement;

    page.goTo('students');
    page.cards()[0].querySelector('.iconbtn--danger').click();
    equal(root.classList.contains('is-locked'), true, 'locked behind the dialog');

    page.confirmNo();
    equal(root.classList.contains('is-locked'), false, 'released on cancel');
    page.close();
  });

  await it('is not left locked after signing out', async function () {
    var page = await openApp({
      students: [
        { id: 's_1', name: 'Ayesha Khan', fatherName: 'Imran Khan',
          roll: '1', className: '5', section: 'A', createdAt: 1, updatedAt: 1 }
      ]
    });
    var root = page.document.documentElement;

    page.doLogout();
    await page.tick();

    equal(page.authVisible(), true, 'back at the sign-in form');
    equal(root.classList.contains('is-locked'), false, 'and the page can scroll');
    page.close();
  });

  /* ==================================================================== */
  describe('the page has exactly one scroll container');

  await it('does not put overflow-x on the body as well as the root', async function () {
    var page = await openApp();
    var css = page.document.querySelector('link[rel=stylesheet]');
    assert(css, 'the stylesheet is linked');

    var text = await (await fetch(css.href)).text();

    /* Two nested scrollers of the same height is what stops the finger
       reaching the page scroller in the Android WebView. */
    assert(/^html\s*\{[^}]*overflow-x:\s*hidden/m.test(text),
      'the root still refuses sideways scrolling');
    assert(!/^html,\s*body\s*\{[^}]*overflow-x:\s*hidden/m.test(text),
      'but the body is no longer a scroll container too');
    page.close();
  });

  await it('does not redefine a shared layout class further down the file', async function () {
    var page = await openApp();
    var css = page.document.querySelector('link[rel=stylesheet]');
    var text = await (await fetch(css.href)).text();

    /* A second `.toolbar { }` block later in the file silently retunes every
       toolbar already using it — which is how the attendance search bar lost
       its spacing when the students screen borrowed the name. Variants belong
       on a modifier. */
    ['.toolbar', '.searchbar', '.list', '.panel', '.counts', '.card'].forEach(function (name) {
      var blocks = text.match(new RegExp('^\\' + name + '\\s*\\{', 'gm')) || [];
      equal(blocks.length, 1, name + ' is defined exactly once, not ' + blocks.length + ' times');
    });

    page.close();
  });

  /* -------------------------------------------------------------- report */
  stopServer();
  h.report('boot and scrolling tests');
}

main().catch(function (err) {
  console.error(err);
  stopServer();
  process.exit(1);
});
