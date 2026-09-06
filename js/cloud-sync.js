/* ==========================================================================
   cloud-sync.js — joins js/cloud.js to the running app.

   Sits between the auth screens and Firebase, and keeps the local store and
   Firestore in step afterwards by listening to the same event bus the screens
   already use. No screen knows this file exists.

   The local store stays authoritative for reads, so every screen, and the
   whole offline story, is unchanged. When cloud accounts are switched off in
   js/firebase-config.js, every function here falls straight through to the
   local path that was always there.
   ========================================================================== */

(function (window) {
  'use strict';

  var DB = window.SchoolDB;
  var Auth = DB.Auth;

  /* Long enough to collect a burst — marking a whole class fires one event per
     save — short enough that another device sees it as "immediately". */
  var PUSH_DELAY = 800;

  var pushTimer = null;
  var pushing = false;
  var pushQueued = false;
  var applying = false;      // guards against a pull racing a local write
  var lastPushError = null;

  function Cloud() { return window.SchoolCloud; }
  function enabled() { return !!Cloud() && Cloud().isConfigured(); }

  function online() {
    return typeof window.navigator === 'undefined' || window.navigator.onLine !== false;
  }

  /* ------------------------------------------------------------ local side */

  /**
   * Combine what came down with what this device holds.
   *
   * A row that is in the incoming snapshot wins — someone else's edit is at
   * least as new as ours. A row that is missing from it is only a DELETION if
   * the cloud was known to have it before (it is in `base`); otherwise it is
   * simply something this device has added and not managed to push yet, and
   * overwriting it would destroy the teacher's work. That distinction is the
   * whole reason a pull is a merge rather than an assignment.
   */
  function mergeStudents(remote, local, base) {
    var uploaded = {};
    (base.students || []).forEach(function (row) { uploaded[row.id] = true; });

    var byId = {};
    (remote || []).forEach(function (row) { byId[row.id] = row; });

    (local || []).forEach(function (row) {
      if (byId[row.id]) return;        // the cloud has it; the cloud's copy wins
      if (uploaded[row.id]) return;    // the cloud had it and no longer does: deleted
      byId[row.id] = row;              // never uploaded: keep it, and push it next
    });

    return Object.keys(byId).map(function (id) { return byId[id]; });
  }

  function mergeAttendance(remote, local, base) {
    var uploaded = base.attendance || {};
    var merged = {};

    Object.keys(remote || {}).forEach(function (key) { merged[key] = remote[key]; });

    Object.keys(local || {}).forEach(function (key) {
      if (merged[key]) return;
      if (Object.prototype.hasOwnProperty.call(uploaded, key)) return;   // deleted elsewhere
      merged[key] = local[key];
    });

    return merged;
  }

  /** Write a pulled school into the local store. Requires a local session. */
  function applyPull(data, done) {
    if (!data) { if (done) done(); return; }

    applying = true;

    var here = DB.Sync.snapshot();
    var base = Cloud().lastSynced();

    DB.Sync.replace(
      mergeStudents(data.students, here.students, base),
      mergeAttendance(data.attendance, here.attendance, base)
    );

    if (data.profile) {
      // Best effort: a rejected rename must not block the data that came with it.
      try {
        Auth.updateProfile({
          schoolName: data.profile.schoolName,
          directorName: data.profile.directorName
        });
        if (data.profile.logo !== undefined) Auth.setLogo(data.profile.logo);
      } catch (err) { /* keep whatever the device already had */ }
    }

    /* What the CLOUD holds — deliberately not the merged result. Rows that
       only exist here are still unsent, and recording them as synced would
       make the next diff see no change and never upload them. */
    Cloud().markSynced({
      students: data.students || [],
      attendance: data.attendance || {}
    });

    DB.flush(function () {
      applying = false;
      if (done) done();
      // Anything the merge kept that the cloud lacks still has to go up.
      schedulePush();
    });
  }

  function announce() {
    if (!window.UI) return;
    window.UI.emit('students-changed');
    window.UI.emit('attendance-changed');
    window.UI.applyBranding();
  }

  /* ----------------------------------------------------------------- push */

  function schedulePush() {
    if (!enabled() || applying) return;
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(runPush, PUSH_DELAY);
  }

  function runPush() {
    if (!enabled() || !Auth.isSignedIn()) return;

    /* Changes made while a push is in flight must not be dropped — mark the
       school dirty and go round again when this one lands. Losing this is
       silent data divergence: the device looks right, the cloud is behind. */
    if (pushing) { pushQueued = true; return; }

    pushing = true;
    pushQueued = false;

    Cloud().push(DB.Sync.snapshot(), function (err) {
      pushing = false;
      lastPushError = err || null;
      /* A failed push is not lost work: the data is already saved on this
         device, and Firestore's own queue retries when the signal returns. */
      if (pushQueued) runPush();
    });
  }

  /* -------------------------------------------------------------- inbound */

  /**
   * A stable string for one school's contents, so "did anything actually
   * change?" can be answered without caring about key order, row order, or the
   * fields Firestore adds on the way through.
   */
  function canon(data) {
    var students = (data.students || []).map(function (row) {
      return [row.id, row.name, row.fatherName, row.roll, row.className, row.section].join('');
    }).sort().join('\n');

    var attendance = Object.keys(data.attendance || {}).sort().map(function (key) {
      var mark = data.attendance[key] || {};
      return [key, mark.status, mark.className, mark.section].join('');
    }).join('\n');

    return students + '\n\n' + attendance;
  }

  /**
   * A snapshot listener fires for this device's own writes as well as other
   * people's. Re-applying our own echo would write the data back, which emits
   * a change, which schedules a push, which fires the listener again — a loop
   * that never settles. So compare first and only act on a real difference.
   */
  function onRemote(data) {
    if (applying) return;
    if (!Auth.isSignedIn()) return;

    var here = DB.Sync.snapshot();
    if (canon(data) === canon(here)) {
      Cloud().markSynced(here);   // already in step; nothing to do
      return;
    }

    applyPull(data, announce);
  }

  function startWatching() {
    if (!enabled()) return;
    Cloud().markSynced(DB.Sync.snapshot());
    Cloud().watch(onRemote);
  }

  /* ------------------------------------------------------------- register */

  /**
   * Create an account. With cloud accounts on, the cloud copy is made first:
   * if that fails there must be no local account, or the same username would
   * later be claimed by somebody else and the two would never reconcile.
   */
  function register(payload, done) {
    if (!enabled()) { done(localRegister(payload)); return; }

    if (!online()) {
      done({ ok: false, errors: {
        form: 'Creating an account needs an internet connection. You can sign in offline once this device has been used before.'
      } });
      return;
    }

    Cloud().register(payload, function (result) {
      if (!result.ok) {
        done({ ok: false, errors: mapError(result) });
        return;
      }

      var adopted = Auth.adoptCloudAccount({
        cloudUid: result.uid,
        schoolName: payload.schoolName,
        directorName: payload.directorName,
        username: payload.username,
        logo: payload.logo || '',
        password: payload.password
      }, true);

      if (!adopted.ok) { done(adopted); return; }

      startWatching();
      done({ ok: true, account: adopted.account, cloud: true });
    });
  }

  function localRegister(payload) {
    var created = DB.Auth.register(payload);
    if (!created.ok) return created;
    var session = DB.Auth.login(payload.username, payload.password, true);
    if (!session.ok) return { ok: false, errors: session.errors };
    return { ok: true, account: created.account, cloud: false };
  }

  /* ---------------------------------------------------------------- login */

  /**
   * Sign in. Firebase is asked first when it is configured and reachable, so
   * that a password changed on another phone takes effect here — but a device
   * that has signed in before still works with no signal, and a school name
   * (which Firebase knows nothing about) still works locally.
   */
  function login(identifier, password, remember, done) {
    if (!enabled() || !online()) { done(localLogin(identifier, password, remember)); return; }

    Cloud().login(identifier, password, function (result) {
      if (result.ok) {
        var profile = result.data && result.data.profile;
        var adopted = Auth.adoptCloudAccount({
          cloudUid: result.uid,
          schoolName: profile ? profile.schoolName : '',
          directorName: profile ? profile.directorName : '',
          username: profile ? profile.username : identifier,
          logo: profile ? profile.logo : undefined,
          password: password
        }, remember);

        if (!adopted.ok) { done(adopted); return; }

        applyPull(result.data, function () {
          startWatching();
          done({ ok: true, account: Auth.current(), cloud: true });
        });
        return;
      }

      /* Firebase knows usernames, not school names, and it cannot help at all
         without a connection. Either way the device may still know this
         account from a previous sign-in. */
      var fallback = localLogin(identifier, password, remember);
      if (fallback.ok) { done(fallback); return; }

      done({ ok: false, errors: mapError(result) });
    });
  }

  function localLogin(identifier, password, remember) {
    var session = DB.Auth.login(identifier, password, remember);
    if (!session.ok) return session;
    return { ok: true, account: session.account, cloud: false };
  }

  function mapError(result) {
    var message = result.error || 'Could not reach the account service.';
    // Put it where the teacher is looking rather than only in a toast.
    if (/password/i.test(message) && !/username/i.test(message)) return { password: message };
    if (/username/i.test(message)) return { identifier: message, form: message };
    return { form: message };
  }

  /* --------------------------------------------------------------- logout */

  function logout(done) {
    window.clearTimeout(pushTimer);
    pushTimer = null;
    if (!enabled()) { if (done) done(); return; }
    Cloud().logout(done);
  }

  /* ----------------------------------------------------------------- boot */

  /**
   * Called once storage is open. A device that is already signed in locally to
   * a cloud-backed account reconnects in the background — the app is already
   * usable from the local copy, so nothing waits for this.
   */
  function boot() {
    if (!enabled()) return;
    if (!Auth.isSignedIn()) return;

    var account = Auth.current();
    if (!account || !account.cloudUid) return;   // a local-only school

    Cloud().load(function (err) {
      if (err) return;                            // stay local until next launch
      startWatching();
      schedulePush();
    });
  }

  function init() {
    if (!window.UI) return;

    window.UI.on('students-changed', schedulePush);
    window.UI.on('attendance-changed', schedulePush);
    window.UI.on('branding-changed', function (account) {
      if (!enabled() || !account) return;
      Cloud().pushProfile(account);
    });

    window.UI.on('storage-ready', boot);

    window.UI.on('account-changed', function (account) {
      if (!enabled()) return;
      if (!account) { Cloud().stopWatching(); return; }
    });
  }

  window.CloudSync = {
    init: init,
    enabled: enabled,
    register: register,
    login: login,
    logout: logout,
    status: function () {
      return {
        enabled: enabled(),
        pushing: pushing,
        pendingPush: pushTimer !== null,
        lastPushError: lastPushError ? (lastPushError.message || String(lastPushError)) : null,
        cloud: enabled() ? Cloud().status() : null
      };
    },
    _flushPush: runPush
  };

}(window));
