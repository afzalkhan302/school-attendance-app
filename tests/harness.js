/* Shared test harness: assertions, reporting, and a localStorage stand-in for
   loading js/db.js under plain Node. No dependencies. */

'use strict';

var path = require('path');

var CRYPTO_PATH = path.resolve(__dirname, '..', 'js', 'crypto.js');
var STORAGE_PATH = path.resolve(__dirname, '..', 'js', 'storage.js');
var DB_PATH = path.resolve(__dirname, '..', 'js', 'db.js');

var passed = 0;
var failures = [];
var suite = '';

function describe(name, fn) {
  suite = name;
  console.log('\n' + name);
  if (fn) fn();
}

/**
 * Works for sync and async test bodies: a sync body finishes before this
 * returns, an async one returns a promise the caller awaits. Either way the
 * output stays in order.
 */
function it(name, fn) {
  function pass() {
    passed++;
    console.log('  ✓ ' + name);
  }
  function fail(err) {
    failures.push(suite + ' > ' + name + '\n      ' + err.message);
    console.log('  ✗ ' + name + '\n      ' + err.message);
  }

  try {
    var result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(pass, fail);
    }
    pass();
  } catch (err) {
    fail(err);
  }
  return Promise.resolve();
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'expected a truthy value');
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message ? message + ': ' : '') +
      'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function deepEqual(actual, expected, message) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((message ? message + ': ' : '') + 'expected ' + b + ', got ' + a);
}

/** Run fn with console.warn muted — for cases that warn on purpose. */
function quiet(fn) {
  var warn = console.warn;
  console.warn = function () {};
  try { return fn(); } finally { console.warn = warn; }
}

function report(label) {
  console.log('\n' + '-'.repeat(52));
  if (failures.length) {
    console.log(passed + ' passed, ' + failures.length + ' FAILED\n');
    failures.forEach(function (f) { console.log('  ✗ ' + f); });
    process.exit(1);
  }
  console.log('All ' + passed + ' ' + (label || 'tests') + ' passed.');
}

/* --------------------------------------------------------- storage stub */

/**
 * A faithful Storage stand-in. `length` and `key()` matter: storage.js
 * enumerates the store to hydrate its cache, so a stub without them would
 * silently look empty.
 */
function makeStorage(options) {
  options = options || {};
  var data = options.data || {};
  return {
    _data: data,
    get length() { return Object.keys(data).length; },
    key: function (i) {
      var names = Object.keys(data);
      return i < names.length ? names[i] : null;
    },
    getItem: function (k) {
      if (options.throwOnRead) throw new Error('blocked');
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem: function (k, v) {
      if (options.throwOnWrite) throw new Error('quota');
      data[k] = String(v);
    },
    removeItem: function (k) { delete data[k]; },
    clear: function () { Object.keys(data).forEach(function (k) { delete data[k]; }); }
  };
}

/**
 * Load a fresh copy of the app's storage layer against the given device
 * storage — this is what reopening the app looks like. sessionStorage is
 * always new, since a real one does not survive the app closing; a session
 * the user asked to remember lives in localStorage and does come back.
 */
function loadDB(storage, tempStorage) {
  globalThis.localStorage = storage;
  globalThis.sessionStorage = tempStorage || makeStorage();

  // No IndexedDB in plain Node, so storage.js takes the localStorage path and
  // stays synchronous — which is what these model tests want. The IndexedDB
  // path is covered by tests/storage.js and tests/ui-storage.js.
  delete globalThis.indexedDB;

  delete globalThis.SchoolDB;
  delete globalThis.SchoolCrypto;
  delete globalThis.SchoolStorage;
  delete require.cache[CRYPTO_PATH];
  delete require.cache[STORAGE_PATH];
  delete require.cache[DB_PATH];
  require(CRYPTO_PATH);
  require(STORAGE_PATH);
  require(DB_PATH);

  // ready() is synchronous on the localStorage backend, so the cache is
  // hydrated by the time this returns.
  var opened = false;
  globalThis.SchoolStorage.ready(function () { opened = true; });
  if (!opened) throw new Error('storage did not open synchronously under Node');

  return globalThis.SchoolDB;
}

var TEST_ACCOUNT = {
  schoolName: 'Test School',
  directorName: 'Test Director',
  username: 'test_admin',
  password: 'secret123',
  confirmPassword: 'secret123'
};

/**
 * The normal state of the app: one school registered and signed in. Students
 * and attendance are invisible without an account, so almost every test needs
 * this rather than a bare loadDB.
 */
function signedInDB(storage, account) {
  var db = loadDB(storage || makeStorage());
  var input = account || TEST_ACCOUNT;

  var registered = db.Auth.register(input);
  assert(registered.ok, 'test account registration failed: ' + JSON.stringify(registered.errors));

  var session = db.Auth.login(input.username, input.password, true);
  assert(session.ok, 'test account sign-in failed: ' + JSON.stringify(session.errors));

  return db;
}

function freshDB() {
  return signedInDB();
}

/** Storage keys for whoever is signed in — tests that corrupt data need these. */
function keysOf(db) {
  var id = db.Auth.activeAccountId();
  return {
    accountId: id,
    students: db.KEYS.studentsFor(id),
    attendance: db.KEYS.attendanceFor(id)
  };
}

function seed(Students, list) {
  return list.map(function (row) {
    var result = Students.create(row);
    assert(result.ok, 'seed failed for ' + JSON.stringify(row) +
                      ' -> ' + JSON.stringify(result.errors));
    return result.student;
  });
}

module.exports = {
  describe: describe,
  it: it,
  assert: assert,
  equal: equal,
  deepEqual: deepEqual,
  quiet: quiet,
  report: report,
  makeStorage: makeStorage,
  loadDB: loadDB,
  signedInDB: signedInDB,
  freshDB: freshDB,
  keysOf: keysOf,
  seed: seed,
  TEST_ACCOUNT: TEST_ACCOUNT
};
