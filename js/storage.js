/* ==========================================================================
   storage.js — durable key/value storage for the whole app.

   IndexedDB is the store; localStorage is the fallback; memory is the last
   resort. A hand-written wrapper rather than a library: the app needs one
   object store of string values, which is a fraction of what idb-keyval or
   Dexie carry, and the app otherwise ships no runtime dependencies.

   Two rules make this safe, and both exist because of bugs found in the
   previous localStorage-only layer:

   1. READS ALWAYS COME FROM THE CACHE, which is hydrated once at startup from
      whichever backend opened. Nothing can later swap the read source for an
      empty map, so a failing write can never make saved data look missing.

   2. A FAILED WRITE ROLLS THE CACHE BACK and reports the error, so memory
      never claims to hold more than the disk does, and the caller can refuse
      to tell the user their work was saved.
   ========================================================================== */

(function (global) {
  'use strict';

  var DB_NAME = 'school-attendance';
  var DB_VERSION = 1;
  var STORE = 'kv';

  var MIGRATION_KEY = 'sa.migration.localstorage.v1';
  var APP_PREFIX = 'sa.';

  /* Every step of the boot read is bounded. Nothing on this path may hang:
     the first paint waits for it. */
  var OPEN_TIMEOUT_MS = 5000;
  var HYDRATE_TIMEOUT_MS = 8000;

  /* Single source of truth for every read. */
  var cache = {};

  var backend = 'memory';       // 'indexeddb' | 'localstorage' | 'memory'
  var db = null;
  var opened = false;
  var migration = { ran: false, copied: 0, verified: false, note: 'not needed' };

  /* Pending-write bookkeeping, so callers can wait for durability. */
  var inFlight = 0;
  var flushError = null;
  var flushWaiters = [];

  function has(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  /**
   * Synchronous backends call back immediately so the app (and its tests)
   * behave the same way they did before; IndexedDB is genuinely async and
   * defers. Callers must therefore treat the callback as "maybe later".
   */
  function defer(fn) {
    if (backend === 'indexeddb') {
      if (global.Promise) { global.Promise.resolve().then(fn); return; }
      global.setTimeout(fn, 0);
      return;
    }
    fn();
  }

  /* ------------------------------------------------------------ IndexedDB */

  function indexedDBFactory() {
    try {
      return global.indexedDB || global.mozIndexedDB || global.webkitIndexedDB || null;
    } catch (err) {
      return null;
    }
  }

  function openIDB(done) {
    var factory = indexedDBFactory();
    if (!factory) { done(new Error('IndexedDB unavailable')); return; }

    var request;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch (err) {
      done(err);
      return;
    }

    var settled = false;
    function finish(err, value) {
      if (settled) return;
      settled = true;
      done(err, value);
    }

    request.onupgradeneeded = function (event) {
      var database = event.target.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE);
      }
    };

    request.onsuccess = function () { finish(null, request.result); };
    request.onerror = function () { finish(request.error || new Error('IndexedDB open failed')); };
    request.onblocked = function () { finish(new Error('IndexedDB blocked')); };

    // A WebView that never answers must not hang the splash forever.
    global.setTimeout(function () { finish(new Error('IndexedDB open timed out')); }, OPEN_TIMEOUT_MS);
  }

  /** Pull every row into the cache. */
  function hydrateFromIDB(done) {
    var settled = false;
    function finish(err, value) {
      if (settled) return;
      settled = true;
      done(err, value);
    }

    var transaction, store, request;
    try {
      transaction = db.transaction(STORE, 'readonly');
      store = transaction.objectStore(STORE);
      request = store.openCursor();
    } catch (err) {
      finish(err);
      return;
    }

    var loaded = {};

    request.onsuccess = function (event) {
      var cursor = event.target.result;
      if (cursor) {
        loaded[cursor.key] = cursor.value;
        cursor.continue();
        return;
      }
      finish(null, loaded);
    };

    request.onerror = function () { finish(request.error || new Error('IndexedDB read failed')); };

    /* A cursor that is killed mid-walk reports on the transaction, not on the
       request, and an Android WebView that drops the connection may report
       nothing at all. Boot waits on this callback before anything is painted,
       so it has to arrive one way or another — otherwise the app sits on a
       blank screen with no sign-in form. */
    transaction.onabort = function () { finish(transaction.error || new Error('IndexedDB read aborted')); };
    transaction.onerror = function () { finish(transaction.error || new Error('IndexedDB read failed')); };

    global.setTimeout(function () { finish(new Error('IndexedDB read timed out')); }, HYDRATE_TIMEOUT_MS);
  }

  function idbWrite(key, value, remove, done) {
    var transaction;
    try {
      transaction = db.transaction(STORE, 'readwrite');
    } catch (err) {
      done(err);
      return;
    }

    var settled = false;
    function finish(err) {
      if (settled) return;
      settled = true;
      done(err || null);
    }

    // Durability is at transaction commit, not at request success.
    transaction.oncomplete = function () { finish(null); };
    transaction.onerror = function () { finish(transaction.error || new Error('write failed')); };
    transaction.onabort = function () { finish(transaction.error || new Error('write aborted')); };

    try {
      var store = transaction.objectStore(STORE);
      if (remove) store.delete(key);
      else store.put(value, key);
    } catch (err) {
      finish(err);
    }
  }

  /* ---------------------------------------------------------- localStorage */

  function localStorageWorks() {
    try {
      var probe = '__sa_probe__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  }

  function readLocalStorage() {
    var loaded = {};
    try {
      for (var i = 0; i < global.localStorage.length; i++) {
        var key = global.localStorage.key(i);
        if (key && key.indexOf(APP_PREFIX) === 0) {
          loaded[key] = global.localStorage.getItem(key);
        }
      }
    } catch (err) {
      return {};
    }
    return loaded;
  }

  /* ------------------------------------------------------------ migration */

  /**
   * Copy anything the old localStorage-only build left behind into IndexedDB,
   * then read it back and compare before recording that it happened. The
   * localStorage copy is deliberately left in place: it costs little and is
   * the only safety net if IndexedDB is later cleared independently.
   */
  function migrate(done) {
    if (has(cache, MIGRATION_KEY)) {
      migration = { ran: false, copied: 0, verified: true, note: 'already migrated' };
      done();
      return;
    }

    var legacy = readLocalStorage();
    var keys = Object.keys(legacy).filter(function (key) {
      return key !== MIGRATION_KEY && !has(cache, key);
    });

    if (!keys.length) {
      migration = { ran: false, copied: 0, verified: true, note: 'nothing to migrate' };
      markMigrated(done);
      return;
    }

    var remaining = keys.length;
    var failed = null;

    keys.forEach(function (key) {
      idbWrite(key, legacy[key], false, function (err) {
        if (err) failed = err;
        if (--remaining > 0) return;

        if (failed) {
          // Leave the flag unset so the next launch tries again, and keep
          // serving the legacy values from the cache meanwhile.
          keys.forEach(function (k) { cache[k] = legacy[k]; });
          migration = {
            ran: true, copied: 0, verified: false,
            note: 'migration failed: ' + (failed.message || failed)
          };
          done();
          return;
        }

        verifyMigration(keys, legacy, done);
      });
    });
  }

  function verifyMigration(keys, legacy, done) {
    hydrateFromIDB(function (err, loaded) {
      if (err) {
        migration = { ran: true, copied: 0, verified: false, note: 'verification read failed' };
        done();
        return;
      }

      var mismatched = keys.filter(function (key) { return loaded[key] !== legacy[key]; });

      if (mismatched.length) {
        migration = {
          ran: true, copied: 0, verified: false,
          note: 'verification mismatch on ' + mismatched.length + ' key(s)'
        };
        keys.forEach(function (key) { cache[key] = legacy[key]; });
        done();
        return;
      }

      // Verified byte-for-byte. Old localStorage rows are NOT deleted.
      cache = loaded;
      migration = {
        ran: true, copied: keys.length, verified: true,
        note: 'migrated ' + keys.length + ' key(s) from localStorage; originals kept'
      };
      markMigrated(done);
    });
  }

  function markMigrated(done) {
    var stamp = JSON.stringify({ at: Date.now(), version: 1 });
    idbWrite(MIGRATION_KEY, stamp, false, function () {
      cache[MIGRATION_KEY] = stamp;
      done();
    });
  }

  /* ---------------------------------------------------------------- ready */

  /** Open the best available store and hydrate the cache. Call once at boot. */
  function ready(callback) {
    if (opened) { defer(function () { callback(status()); }); return; }

    openIDB(function (err, database) {
      if (err || !database) { useLocalStorage(callback); return; }

      db = database;
      backend = 'indexeddb';

      hydrateFromIDB(function (readErr, loaded) {
        if (readErr) { db = null; useLocalStorage(callback); return; }

        cache = loaded;
        migrate(function () {
          opened = true;
          callback(status());
        });
      });
    });
  }

  function useLocalStorage(callback) {
    if (localStorageWorks()) {
      backend = 'localstorage';
      cache = readLocalStorage();
      migration = { ran: false, copied: 0, verified: false, note: 'IndexedDB unavailable' };
    } else {
      backend = 'memory';
      cache = {};
      migration = { ran: false, copied: 0, verified: false, note: 'no durable storage' };
    }
    opened = true;
    defer(function () { callback(status()); });
  }

  /* -------------------------------------------------------- read / write */

  function get(key) {
    return has(cache, key) ? cache[key] : null;
  }

  function keys() {
    return Object.keys(cache).filter(function (key) { return key !== MIGRATION_KEY; });
  }

  function persist(key, value, remove, done) {
    if (backend === 'indexeddb') { idbWrite(key, value, remove, done); return; }

    if (backend === 'localstorage') {
      var err = null;
      try {
        if (remove) global.localStorage.removeItem(key);
        else global.localStorage.setItem(key, value);
      } catch (writeError) {
        err = writeError;
      }
      defer(function () { done(err); });
      return;
    }

    // Memory backend: the app already warned that nothing is being saved.
    defer(function () { done(null); });
  }

  function write(key, value, remove, callback) {
    var had = has(cache, key);
    var previous = had ? cache[key] : null;

    if (remove) delete cache[key];
    else cache[key] = String(value);

    inFlight++;

    persist(key, value, remove, function (err) {
      if (err) {
        // Put the cache back so it never claims more than the disk holds.
        if (had) cache[key] = previous;
        else delete cache[key];
        flushError = err;
      }

      inFlight--;
      if (callback) callback(err || null);

      /* Only clear the error once it has actually been handed to someone.
         A backend that fails synchronously settles before flush() is even
         called, and clearing here unconditionally would lose the report. */
      if (inFlight === 0 && flushWaiters.length) {
        var settledError = flushError;
        flushError = null;
        var waiters = flushWaiters;
        flushWaiters = [];
        waiters.forEach(function (waiter) { waiter(settledError); });
      }
    });
  }

  function set(key, value, callback) { write(key, value, false, callback); }
  function remove(key, callback) { write(key, null, true, callback); }

  /** Call back once every pending write has settled, with the first error. */
  function flush(callback) {
    if (inFlight === 0) {
      var settledError = flushError;
      flushError = null;
      defer(function () { callback(settledError || null); });
      return;
    }
    flushWaiters.push(callback);
  }

  function status() {
    return {
      backend: backend,
      persistent: backend !== 'memory',
      migration: migration,
      keys: keys().length
    };
  }

  global.SchoolStorage = {
    ready: ready,
    get: get,
    set: set,
    remove: remove,
    keys: keys,
    flush: flush,
    status: status,
    backend: function () { return backend; },
    isPersistent: function () { return backend !== 'memory'; },
    migration: function () { return migration; },

    /* test hook — closes the handle and forgets the cache, so a suite can
       model the app being launched again */
    _reset: function () {
      if (db) { try { db.close(); } catch (err) { /* ignore */ } }
      db = null;
      cache = {};
      backend = 'memory';
      opened = false;
      inFlight = 0;
      flushError = null;
      flushWaiters = [];
      migration = { ran: false, copied: 0, verified: false, note: 'not needed' };
    }
  };

}(typeof window !== 'undefined' ? window : globalThis));
