/* End-to-end against real Firebase software.

   Nothing is stubbed. This drives the real js/cloud.js — the file the app
   actually uses — against the Firebase emulator: Google's own Auth and
   Firestore builds, enforcing the real firestore.rules.

   Needs the emulator running:
       npm run emulators
       npm run test:firebase

   `npm run verify:firebase` does both in one go.
*/

'use strict';

var path = require('path');
var h = require('./harness');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;

var AUTH_EMULATOR = '127.0.0.1:9099';
var FIRESTORE_HOST = '127.0.0.1';
var FIRESTORE_PORT = 8080;
var PROJECT = 'demo-school-attendance';

var CLOUD = path.resolve(__dirname, '..', 'js', 'cloud.js');

/* A username no earlier run can have taken, so a developer who leaves the
   emulator up between runs does not see spurious "already taken" failures. */
var STAMP = Date.now().toString(36);
var USERNAME = 'abc_' + STAMP;
var PASSWORD = 'secret123';
var DOMAIN = 'users.school-attendance.test';

var SCHOOL = {
  schoolName: 'ABC Public School',
  directorName: 'Mr. Imran Khan',
  username: USERNAME,
  password: PASSWORD,
  logo: ''
};

var STUDENTS = [
  { id: 's_1', name: 'Ayesha Khan', fatherName: 'Imran Khan',
    roll: '1', className: '5', section: 'A', createdAt: 1, updatedAt: 1 },
  { id: 's_2', name: 'Bilal Shah', fatherName: 'Kamran Shah',
    roll: '2', className: '5', section: 'A', createdAt: 2, updatedAt: 2 }
];

var CHAND = { id: 's_3', name: 'Chand Bibi', fatherName: 'Nasir Ali',
              roll: '3', className: '5', section: 'A', createdAt: 3, updatedAt: 3 };

var ZARA = { id: 'z_1', name: 'Zara Ali', fatherName: 'Kamal Ali',
             roll: '1', className: '1', section: 'A', createdAt: 1, updatedAt: 1 };

var ATTENDANCE = {
  's_1|2026-09-04': { studentId: 's_1', date: '2026-09-04', status: 'present',
                      className: '5', section: 'A', markedAt: 1 },
  's_2|2026-09-04': { studentId: 's_2', date: '2026-09-04', status: 'absent',
                      className: '5', section: 'A', markedAt: 2 }
};

/**
 * One device: a fresh js/cloud.js and a fresh Firebase app, sharing nothing
 * with the last one.
 *
 * The SDK comes from the `firebase` package rather than the browser bundle in
 * js/vendor/. It is the same release (12.18.0) and the same compat API that
 * cloud.js calls; the vendored file is an IIFE that expects a real browser and
 * cannot be linked under Node's module loader. What is under test here is
 * cloud.js against real Auth and real Firestore.
 *
 * Devices run one at a time. The compat SDK holds one signed-in user per app,
 * so "another phone" is a torn-down app plus a fresh cloud.js holding no local
 * state — which is exactly what a phone that has never seen this school is.
 */
function makeDevice() {
  delete require.cache[CLOUD];

  var firebase = require('firebase/compat/app');
  require('firebase/compat/auth');
  require('firebase/compat/firestore');

  var fakeWindow = {
    firebase: firebase,
    navigator: { onLine: true },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    SchoolCloudConfig: {
      enabled: true,
      apiKey: 'emulator-key',
      authDomain: PROJECT + '.firebaseapp.com',
      projectId: PROJECT,
      usernameDomain: DOMAIN
    }
  };

  var previousWindow = global.window;
  var previousDocument = global.document;
  global.window = fakeWindow;
  global.document = {
    createElement: function () { return {}; },
    head: { appendChild: function () {} }
  };

  require(CLOUD);
  var cloud = fakeWindow.SchoolCloud;

  global.window = previousWindow;
  global.document = previousDocument;

  return {
    cloud: cloud,
    firebase: firebase,

    /** Point this device at the emulator instead of the internet. */
    connect: function () {
      if (!firebase.apps.length) firebase.initializeApp(fakeWindow.SchoolCloudConfig);
      firebase.auth().useEmulator('http://' + AUTH_EMULATOR, { disableWarnings: true });
      firebase.firestore().settings({
        host: FIRESTORE_HOST + ':' + FIRESTORE_PORT,
        ssl: false
      });
      return firebase.app();
    },

    /** Tear the device down completely — the next one starts from nothing. */
    close: function () {
      return firebase.auth().signOut()
        .catch(function () { /* already out */ })
        .then(function () {
          return Promise.all(firebase.apps.map(function (app) { return app.delete(); }));
        })
        .catch(function () { /* already gone */ });
    }
  };
}

function promised(fn) {
  return new Promise(function (resolve) { fn(resolve); });
}

/* The rules engine phrases a refusal several ways depending on the operation
   — "PERMISSION_DENIED", "false for 'list' @ L38", "No matching allow
   statements". The error CODE is the reliable signal; the message patterns are
   a backstop. Getting this wrong in the lenient direction would be the worst
   outcome: a test reporting isolation holds when it does not, so anything not
   recognised as a refusal is re-thrown rather than counted as one. */
function isDenied(err) {
  if (!err) return false;
  if (err.code === 'permission-denied' || err.code === 'unauthenticated') return true;
  return /permission|insufficient|unauthenticated|PERMISSION_DENIED|No matching allow statements|false for '/i
    .test(err.message || '');
}

/** Run something that must be refused, and say whether it was. */
async function wasRefused(run) {
  try {
    await run();
  } catch (err) {
    if (isDenied(err)) return true;
    throw err;          // a real failure, not a refusal
  }
  return false;
}

async function main() {
  var uid1, otherUid;

  /* ==================================================================== */
  describe('device 1: creating the account against real Firebase Auth');

  var phone = makeDevice();
  phone.connect();

  await it('registers, and gets a real uid back', async function () {
    var result = await promised(function (done) { phone.cloud.register(SCHOOL, done); });
    assert(result.ok, 'register failed: ' + result.error);
    assert(result.uid, 'a uid came back');
    uid1 = result.uid;
  });

  await it('really wrote the school document to Firestore', async function () {
    var data = await phone.cloud.pull();
    assert(data.profile, 'the school document exists');
    equal(data.profile.schoolName, 'ABC Public School');
    equal(data.profile.username, USERNAME);
  });

  await it('pushes students and attendance to the server', async function () {
    var err = await promised(function (done) {
      phone.cloud.push({ students: STUDENTS, attendance: ATTENDANCE }, done);
    });
    equal(err, null, 'push reported: ' + (err && err.message));
  });

  await it('reads them back off the server', async function () {
    var data = await phone.cloud.pull();
    deepEqual(data.students.map(function (s) { return s.name; }).sort(),
      ['Ayesha Khan', 'Bilal Shah']);
    equal(Object.keys(data.attendance).length, 2);
    equal(data.attendance['s_1|2026-09-04'].status, 'present');
    equal(data.students.filter(function (s) { return s.id === 's_1'; })[0].fatherName,
      'Imran Khan', 'father names survive the round trip');
  });

  await phone.close();

  /* ==================================================================== */
  describe('device 2: a phone that has never seen this school');

  phone = makeDevice();
  phone.connect();

  var pulled;

  await it('signs in with nothing but the username and password', async function () {
    var result = await promised(function (done) {
      phone.cloud.login(USERNAME, PASSWORD, done);
    });
    assert(result.ok, 'login failed: ' + result.error);
    equal(result.uid, uid1, 'the same account');
    pulled = result.data;
  });

  await it('the whole register comes down with the sign-in', async function () {
    deepEqual(pulled.students.map(function (s) { return s.name; }).sort(),
      ['Ayesha Khan', 'Bilal Shah']);
    equal(pulled.profile.schoolName, 'ABC Public School');
    equal(pulled.profile.directorName, 'Mr. Imran Khan');
  });

  await it('so does the attendance', async function () {
    equal(Object.keys(pulled.attendance).length, 2);
    equal(pulled.attendance['s_1|2026-09-04'].status, 'present');
    equal(pulled.attendance['s_2|2026-09-04'].status, 'absent');
  });

  await it('adds a student here and pushes it', async function () {
    phone.cloud.markSynced({ students: STUDENTS, attendance: ATTENDANCE });
    var err = await promised(function (done) {
      phone.cloud.push({ students: STUDENTS.concat([CHAND]), attendance: ATTENDANCE }, done);
    });
    equal(err, null, 'push reported: ' + (err && err.message));
  });

  await it('deletes one of the originals and pushes that too', async function () {
    var err = await promised(function (done) {
      phone.cloud.push({ students: [STUDENTS[0], CHAND], attendance: ATTENDANCE }, done);
    });
    equal(err, null, 'push reported: ' + (err && err.message));
  });

  await phone.close();

  /* ==================================================================== */
  describe('back on the first phone');

  phone = makeDevice();
  phone.connect();

  await it('signs in again and finds the other phone changes', async function () {
    var result = await promised(function (done) {
      phone.cloud.login(USERNAME, PASSWORD, done);
    });
    assert(result.ok, 'login failed: ' + result.error);

    deepEqual(result.data.students.map(function (s) { return s.name; }).sort(),
      ['Ayesha Khan', 'Chand Bibi'],
      'the addition arrived and the deletion took effect');
  });

  await phone.close();

  /* ==================================================================== */
  describe('real Auth refuses what it should');

  await it('rejects the wrong password', async function () {
    phone = makeDevice();
    phone.connect();
    var result = await promised(function (done) {
      phone.cloud.login(USERNAME, 'not-the-password', done);
    });
    equal(result.ok, false);
    assert(/Wrong username or password/.test(result.error), result.error);
    await phone.close();
  });

  await it('rejects an account that does not exist', async function () {
    phone = makeDevice();
    phone.connect();
    var result = await promised(function (done) {
      phone.cloud.login('nobody_' + STAMP, PASSWORD, done);
    });
    equal(result.ok, false);
    assert(/Wrong username or password/.test(result.error), result.error);
    await phone.close();
  });

  await it('rejects a username that is already taken', async function () {
    phone = makeDevice();
    phone.connect();
    var result = await promised(function (done) {
      phone.cloud.register({
        schoolName: 'Another School', directorName: 'Someone',
        username: USERNAME, password: 'different1', logo: ''
      }, done);
    });
    equal(result.ok, false);
    assert(/already taken/i.test(result.error), result.error);
    await phone.close();
  });

  /* ==================================================================== */
  describe('a second school, against the real rules');

  await it('creates its own separate account and data', async function () {
    phone = makeDevice();
    phone.connect();

    var result = await promised(function (done) {
      phone.cloud.register({
        schoolName: 'XYZ Model School', directorName: 'Mrs. Sara Ahmed',
        username: 'xyz_' + STAMP, password: 'other456', logo: ''
      }, done);
    });
    assert(result.ok, 'second school register failed: ' + result.error);
    otherUid = result.uid;
    assert(otherUid !== uid1, 'a different uid from the first school');

    var err = await promised(function (done) {
      phone.cloud.push({ students: [ZARA], attendance: {} }, done);
    });
    equal(err, null, 'push reported: ' + (err && err.message));
  });

  await it('sees only its own student', async function () {
    var data = await phone.cloud.pull();
    deepEqual(data.students.map(function (s) { return s.name; }), ['Zara Ali']);
    equal(data.profile.schoolName, 'XYZ Model School');
  });

  await it('is refused when it reaches for the first school, on the wire', async function () {
    /* Not through cloud.js — straight at Firestore, which is the request an
       attacker would actually send. The rules engine is all that stands here. */
    var denied = await wasRefused(function () {
      return phone.firebase.firestore().collection('schools/' + uid1 + '/students').get();
    });
    equal(denied, true, 'the real rules engine refused the read');
  });

  await it('is refused writing into the first school too', async function () {
    var denied = await wasRefused(function () {
      return phone.firebase.firestore()
        .doc('schools/' + uid1 + '/students/injected').set({ name: 'Injected' });
    });
    equal(denied, true, 'the real rules engine refused the write');
  });

  await phone.close();

  /* ==================================================================== */
  describe('and the first school is unharmed by all of that');

  await it('still holds exactly what it should', async function () {
    phone = makeDevice();
    phone.connect();

    var result = await promised(function (done) {
      phone.cloud.login(USERNAME, PASSWORD, done);
    });
    assert(result.ok, 'login failed: ' + result.error);

    var names = result.data.students.map(function (s) { return s.name; }).sort();
    deepEqual(names, ['Ayesha Khan', 'Chand Bibi'], 'nothing injected, nothing lost');
    equal(names.indexOf('Zara Ali'), -1, 'and nothing from the other school');
  });

  await it('signing out really ends the session', async function () {
    await promised(function (done) { phone.cloud.logout(done); });

    var denied = await wasRefused(function () {
      return phone.firebase.firestore().doc('schools/' + uid1).get();
    });
    equal(denied, true, 'a signed-out device is refused by the rules');
  });

  await phone.close();

  /* ==================================================================== */
  describe('offline, using real Firestore network control');

  phone = makeDevice();
  phone.connect();

  var settled = null;

  await it('signs in first, while there is still a connection', async function () {
    var result = await promised(function (done) {
      phone.cloud.login(USERNAME, PASSWORD, done);
    });
    assert(result.ok, 'login failed: ' + result.error);
    phone.cloud.markSynced({
      students: result.data.students, attendance: result.data.attendance
    });
  });

  await it('goes offline and accepts a change without confirming it', async function () {
    await phone.firebase.firestore().disableNetwork();

    /* Firestore resolves a write promise on SERVER acknowledgement, so offline
       this callback stays pending. That is the behaviour the app depends on:
       cloud.js never reports a cloud save it has not had confirmed, while the
       local store has already kept the data regardless. */
    phone.cloud.push({
      students: [STUDENTS[0], CHAND, ZARA], attendance: ATTENDANCE
    }, function (err) { settled = { err: err }; });

    await new Promise(function (resolve) { setTimeout(resolve, 600); });
    equal(settled, null, 'the push has not claimed success while offline');
  });

  await it('flushes the queued write when the connection comes back', async function () {
    await phone.firebase.firestore().enableNetwork();

    for (var i = 0; i < 100 && settled === null; i++) {
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }

    assert(settled, 'the queued write settled after reconnecting');
    equal(settled.err, null, 'and it succeeded: ' + (settled.err && settled.err.message));
  });

  await it('and the work done offline really is on the server', async function () {
    var data = await phone.cloud.pull();
    deepEqual(data.students.map(function (s) { return s.name; }).sort(),
      ['Ayesha Khan', 'Chand Bibi', 'Zara Ali'],
      'the row added while offline arrived');
  });

  await phone.close();

  h.report('live Firebase tests (real SDK, real Auth, real Firestore, real rules)');
}

main().catch(function (err) {
  console.error('\n' + (err && err.stack ? err.stack : err));
  console.error('\nIs the emulator running?   npm run emulators\n');
  process.exit(1);
});
