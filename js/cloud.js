/* ==========================================================================
   cloud.js — optional Firebase backing, so one account works on any device.

   The local store stays exactly what it was: the source of every read, and
   the reason the app still works with no signal. Firestore is a REPLICA of it.

     sign in   ->  Firebase Auth says who you are
                   pull the school down, write it into the local store
                   the rest of the app carries on reading locally, unchanged

     changes   ->  written locally first (as always), then mirrored up
     remote    ->  a snapshot listener writes incoming changes into the local
                   store and tells the screens to re-render

   Nothing here runs until js/firebase-config.js has been filled in. Left
   alone, isConfigured() is false, the Firebase bundles are never fetched, and
   the app behaves precisely as it did before this file existed.
   ========================================================================== */

(function (window, document) {
  'use strict';

  var SDK = [
    'js/vendor/firebase-app-compat.js',
    'js/vendor/firebase-auth-compat.js',
    'js/vendor/firebase-firestore-compat.js'
  ];

  var SCHOOLS = 'schools';
  var STUDENTS = 'students';
  var ATTENDANCE = 'attendance';

  var config = window.SchoolCloudConfig || {};

  var app = null;
  var auth = null;
  var store = null;
  var uid = '';
  var unsubscribe = [];
  var lastPushed = null;      // what Firestore was last told, for diffing
  var state = 'off';          // off | loading | ready | signed-in | error
  var lastError = null;

  function isConfigured() {
    return !!(config && config.enabled && config.apiKey && config.projectId);
  }

  function status() {
    return {
      configured: isConfigured(),
      state: state,
      uid: uid,
      online: typeof window.navigator === 'undefined' ? true : window.navigator.onLine !== false,
      error: lastError ? (lastError.message || String(lastError)) : null
    };
  }

  /**
   * Firebase Auth identifies accounts by email; the app asks for a username.
   * Mapping one to the other keeps usernames globally unique for free, because
   * Firebase already refuses a duplicate address. Nothing is ever delivered to
   * this domain — it only has to be valid and identical on every device.
   */
  function emailFor(username) {
    var domain = config.usernameDomain || 'users.school-attendance.app';
    return String(username || '').trim().toLowerCase() + '@' + domain;
  }

  /* --------------------------------------------------------------- loading */

  var loading = null;

  function loadScript(src, done) {
    var script = document.createElement('script');
    script.src = src;
    script.async = false;           // these three must run in order
    script.onload = function () { done(null); };
    script.onerror = function () { done(new Error('Could not load ' + src)); };
    document.head.appendChild(script);
  }

  /** Fetch the SDK, start the app, and open Firestore. Calls back (error). */
  function load(done) {
    if (!isConfigured()) { done(new Error('Cloud accounts are not configured.')); return; }
    if (state === 'ready' || state === 'signed-in') { done(null); return; }

    if (loading) { loading.push(done); return; }
    loading = [done];
    state = 'loading';

    function settle(err) {
      var waiters = loading || [];
      loading = null;
      if (err) { state = 'error'; lastError = err; }
      waiters.forEach(function (waiter) { waiter(err || null); });
    }

    var index = 0;
    (function next(err) {
      if (err) { settle(err); return; }
      // Already present (a second call, or a test double): go straight to it.
      if (window.firebase && window.firebase.auth && window.firebase.firestore) {
        start(settle);
        return;
      }
      if (index < SDK.length) { loadScript(SDK[index++], next); return; }
      start(settle);
    }(null));
  }

  function start(settle) {
    var firebase = window.firebase;
    if (!firebase || !firebase.initializeApp) {
      settle(new Error('The Firebase SDK did not load.'));
      return;
    }

    try {
      app = firebase.apps && firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp({
            apiKey: config.apiKey,
            authDomain: config.authDomain,
            projectId: config.projectId,
            storageBucket: config.storageBucket,
            messagingSenderId: config.messagingSenderId,
            appId: config.appId
          });

      auth = firebase.auth();
      store = firebase.firestore();
    } catch (err) {
      settle(err);
      return;
    }

    /* Firestore's own cache. It is what lets a signed-in teacher keep working
       through a dead connection; writes queue and go up when the signal comes
       back. It fails when two tabs are open, which is not a reason to refuse
       to start — the local store is still there either way. */
    var persistence = store.enablePersistence
      ? store.enablePersistence({ synchronizeTabs: true })
      : null;

    if (persistence && persistence.catch) {
      persistence.catch(function () { /* multi-tab or unsupported; carry on */ });
    }

    state = 'ready';
    settle(null);
  }

  /* ------------------------------------------------------------------ auth */

  function friendly(err) {
    var code = err && err.code ? String(err.code) : '';
    if (/user-not-found|wrong-password|invalid-credential|invalid-login/.test(code)) {
      return 'Wrong username or password.';
    }
    if (/email-already-in-use/.test(code)) return 'That username is already taken.';
    if (/weak-password/.test(code)) return 'Choose a longer password.';
    if (/network-request-failed/.test(code)) {
      return 'No connection. Connect to the internet to use this account on a new device.';
    }
    if (/too-many-requests/.test(code)) return 'Too many attempts. Wait a minute and try again.';
    return (err && err.message) || 'The cloud account could not be reached.';
  }

  /** Create the cloud account and its school document. */
  function register(profile, done) {
    load(function (err) {
      if (err) { done({ ok: false, error: friendly(err) }); return; }

      auth.createUserWithEmailAndPassword(emailFor(profile.username), profile.password)
        .then(function (credential) {
          uid = credential.user.uid;
          state = 'signed-in';
          return schoolDoc().set({
            schoolName: profile.schoolName,
            directorName: profile.directorName,
            username: profile.username,
            logo: profile.logo || '',
            createdAt: Date.now(),
            updatedAt: Date.now()
          });
        })
        .then(function () { done({ ok: true, uid: uid }); })
        .catch(function (error) { done({ ok: false, error: friendly(error), code: error.code }); });
    });
  }

  /** Sign in and hand back everything this school has stored. */
  function login(username, password, done) {
    load(function (err) {
      if (err) { done({ ok: false, error: friendly(err) }); return; }

      auth.signInWithEmailAndPassword(emailFor(username), password)
        .then(function (credential) {
          uid = credential.user.uid;
          state = 'signed-in';
          return pull();
        })
        .then(function (data) { done({ ok: true, uid: uid, data: data }); })
        .catch(function (error) { done({ ok: false, error: friendly(error), code: error.code }); });
    });
  }

  function logout(done) {
    stopWatching();
    uid = '';
    lastPushed = null;
    if (!auth) { state = isConfigured() ? 'ready' : 'off'; if (done) done(); return; }

    auth.signOut()
      .catch(function () { /* signing out locally matters more */ })
      .then(function () {
        state = 'ready';
        if (done) done();
      });
  }

  /* ------------------------------------------------------------- documents */

  function schoolDoc() { return store.collection(SCHOOLS).doc(uid); }
  function studentsCol() { return schoolDoc().collection(STUDENTS); }
  function attendanceCol() { return schoolDoc().collection(ATTENDANCE); }

  /** Read the whole school. Returns a promise for { profile, students, attendance }. */
  function pull() {
    return Promise.all([
      schoolDoc().get(),
      studentsCol().get(),
      attendanceCol().get()
    ]).then(function (results) {
      var profile = results[0].exists ? results[0].data() : null;

      var students = [];
      results[1].forEach(function (doc) {
        var row = doc.data();
        row.id = doc.id;
        students.push(row);
      });

      var attendance = {};
      results[2].forEach(function (doc) { attendance[doc.id] = doc.data(); });

      return { profile: profile, students: students, attendance: attendance };
    });
  }

  /* ---------------------------------------------------------------- push */

  function indexById(rows) {
    var map = {};
    (rows || []).forEach(function (row) { map[row.id] = row; });
    return map;
  }

  function sameRow(a, b) {
    return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  }

  /**
   * Mirror the local school upward, writing only what actually differs from
   * the last push. Firestore batches cap at 500 operations, so this chunks.
   */
  function push(snapshot, done) {
    if (state !== 'signed-in' || !store) { if (done) done(null); return; }

    var previous = lastPushed || { students: [], attendance: {} };
    var writes = [];

    var before = indexById(previous.students);
    var after = indexById(snapshot.students);

    Object.keys(after).forEach(function (id) {
      if (!sameRow(before[id], after[id])) {
        writes.push({ ref: studentsCol().doc(id), data: stripId(after[id]) });
      }
    });
    Object.keys(before).forEach(function (id) {
      if (!after[id]) writes.push({ ref: studentsCol().doc(id), remove: true });
    });

    Object.keys(snapshot.attendance).forEach(function (key) {
      if (!sameRow(previous.attendance[key], snapshot.attendance[key])) {
        writes.push({ ref: attendanceCol().doc(docId(key)), data: snapshot.attendance[key] });
      }
    });
    Object.keys(previous.attendance).forEach(function (key) {
      if (!snapshot.attendance[key]) {
        writes.push({ ref: attendanceCol().doc(docId(key)), remove: true });
      }
    });

    if (!writes.length) { if (done) done(null); return; }

    commitBatches(writes, function (err) {
      if (!err) lastPushed = clone(snapshot);
      else lastError = err;
      if (done) done(err || null);
    });
  }

  function commitBatches(writes, done) {
    var LIMIT = 450;   // Firestore allows 500; leave headroom
    var chunks = [];
    for (var i = 0; i < writes.length; i += LIMIT) chunks.push(writes.slice(i, i + LIMIT));

    var index = 0;
    (function next(err) {
      if (err || index >= chunks.length) { done(err || null); return; }

      var batch = store.batch();
      chunks[index++].forEach(function (write) {
        if (write.remove) batch.delete(write.ref);
        else batch.set(write.ref, write.data);
      });

      batch.commit().then(function () { next(null); }, next);
    }(null));
  }

  /** Push the school's own details (name, director, logo). */
  function pushProfile(profile, done) {
    if (state !== 'signed-in' || !store) { if (done) done(null); return; }

    schoolDoc().set({
      schoolName: profile.schoolName,
      directorName: profile.directorName,
      username: profile.username,
      logo: profile.logo || '',
      updatedAt: Date.now()
    }, { merge: true })
      .then(function () { if (done) done(null); },
            function (err) { lastError = err; if (done) done(err); });
  }

  /* An attendance key is "<studentId>|<date>". Firestore document ids may not
     contain "/", but "|" is fine, so the key is used as-is. */
  function docId(key) { return String(key); }

  function stripId(row) {
    var copy = {};
    for (var field in row) {
      if (Object.prototype.hasOwnProperty.call(row, field) && field !== 'id') {
        copy[field] = row[field];
      }
    }
    return copy;
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  /* ------------------------------------------------------------- watching */

  /**
   * Listen for changes made on another device. `onChange` is handed the same
   * shape `pull()` returns, and is expected to write it into the local store.
   */
  function watch(onChange) {
    if (state !== 'signed-in' || !store) return;
    stopWatching();

    function relay() {
      pull().then(function (data) { onChange(data); }, function (err) { lastError = err; });
    }

    /* Snapshots fire for this device's own writes too. That is harmless — the
       data is identical to what is already stored — but it does mean the local
       write must land first, which it always does. */
    unsubscribe.push(studentsCol().onSnapshot(relay, function (err) { lastError = err; }));
    unsubscribe.push(attendanceCol().onSnapshot(relay, function (err) { lastError = err; }));
  }

  function stopWatching() {
    unsubscribe.forEach(function (stop) {
      try { stop(); } catch (err) { /* already gone */ }
    });
    unsubscribe = [];
  }

  /** Record what the cloud already holds, so the first push does not resend it. */
  function markSynced(snapshot) { lastPushed = clone(snapshot); }

  /**
   * The last state this device and the cloud were known to agree on.
   *
   * It is the common ancestor for merging: a row missing from an incoming
   * snapshot was DELETED elsewhere if it is in here, and is simply NOT YET
   * UPLOADED if it is not. Without that distinction a pull cannot tell the two
   * apart, and would delete work this device has not managed to push.
   */
  function lastSynced() {
    return lastPushed ? clone(lastPushed) : { students: [], attendance: {} };
  }

  window.SchoolCloud = {
    isConfigured: isConfigured,
    status: status,
    load: load,
    register: register,
    login: login,
    logout: logout,
    pull: function () { return pull(); },
    push: push,
    pushProfile: pushProfile,
    watch: watch,
    stopWatching: stopWatching,
    markSynced: markSynced,
    lastSynced: lastSynced,
    emailFor: emailFor,

    /* test hook — lets a suite install a fake Firebase and reset between runs */
    _install: function (fake) {
      app = fake.app || null;
      auth = fake.auth || null;
      store = fake.store || null;
      uid = fake.uid || '';
      state = fake.state || 'ready';
      lastPushed = null;
      lastError = null;
      unsubscribe = [];
    },
    _config: function (next) { config = next || {}; }
  };

}(window, document));
