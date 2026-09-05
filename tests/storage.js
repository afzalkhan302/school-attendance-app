/* Tests for the IndexedDB storage layer: durability across restarts,
   migration from the old localStorage build, and safe write handling.
   `npm run test:storage`

   Uses fake-indexeddb (a devDependency) so the real IndexedDB code path in
   js/storage.js runs — Node has no IndexedDB of its own. */

'use strict';

var path = require('path');
var h = require('./harness');
var fakeIndexedDB = require('fake-indexeddb');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;
var makeStorage = h.makeStorage;

var CRYPTO_PATH = path.resolve(__dirname, '..', 'js', 'crypto.js');
var STORAGE_PATH = path.resolve(__dirname, '..', 'js', 'storage.js');
var DB_PATH = path.resolve(__dirname, '..', 'js', 'db.js');

var IDBDatabaseProto = fakeIndexedDB.IDBDatabase.prototype;
var realTransaction = IDBDatabaseProto.transaction;
var failWrites = false;

/* One switch that makes every write transaction fail, the way a full disk or
   a revoked quota would. Reads keep working, as they do in reality. */
IDBDatabaseProto.transaction = function (names, mode) {
  if (failWrites && mode === 'readwrite') {
    var err = new Error('QuotaExceededError');
    err.name = 'QuotaExceededError';
    throw err;
  }
  return realTransaction.apply(this, arguments);
};

var SCHOOL_A = {
  schoolName: 'ABC Public School', directorName: 'Mr. Imran Khan',
  username: 'abc_admin', password: 'secret123', confirmPassword: 'secret123'
};

var SCHOOL_B = {
  schoolName: 'Green Valley Academy', directorName: 'Mrs. Sara Ahmed',
  username: 'green_admin', password: 'valley456', confirmPassword: 'valley456'
};

/** A device: its own IndexedDB, localStorage and sessionStorage. */
function device(options) {
  options = options || {};
  return {
    idb: new fakeIndexedDB.IDBFactory(),
    local: makeStorage({ data: options.localData || {} }),
    session: makeStorage()
  };
}

/** Launch the app on a device. Call again on the same device to reopen it. */
function launch(dev, freshSession) {
  globalThis.indexedDB = dev.idb;
  globalThis.localStorage = dev.local;
  globalThis.sessionStorage = freshSession === false ? dev.session : (dev.session = makeStorage());

  if (globalThis.SchoolStorage) globalThis.SchoolStorage._reset();
  delete globalThis.SchoolDB;
  delete globalThis.SchoolCrypto;
  delete globalThis.SchoolStorage;
  delete require.cache[CRYPTO_PATH];
  delete require.cache[STORAGE_PATH];
  delete require.cache[DB_PATH];
  require(CRYPTO_PATH);
  require(STORAGE_PATH);
  require(DB_PATH);

  return new Promise(function (resolve) {
    globalThis.SchoolDB.ready(function (status) {
      resolve({ db: globalThis.SchoolDB, status: status });
    });
  });
}

/** Wait for the pending writes; resolves with the error, or null. */
function flush(db) {
  return new Promise(function (resolve) { db.flush(function (err) { resolve(err || null); }); });
}

async function signIn(db, school) {
  var registered = db.Auth.register(school);
  assert(registered.ok, JSON.stringify(registered.errors));
  assert(!(await flush(db)), 'registration should persist');

  var session = db.Auth.login(school.username, school.password, true);
  assert(session.ok, JSON.stringify(session.errors));
  assert(!(await flush(db)), 'sign-in should persist');
  return session.account;
}

async function addStudent(db, student) {
  var result = db.Students.create(student);
  assert(result.ok, JSON.stringify(result.errors));
  assert(!(await flush(db)), 'student should persist');
  return result.student;
}

/* ================================== run =================================== */

async function main() {

  /* ==================================================================== */
  describe('storage backend');

  var dev = device();
  var app = await launch(dev);

  await it('uses IndexedDB when it is available', async function () {
    equal(app.status.backend, 'indexeddb');
    equal(app.db.backend(), 'indexeddb');
    equal(app.db.isPersistent(), true);
  });

  await it('falls back to localStorage when IndexedDB is missing', async function () {
    var noIdb = { idb: undefined, local: makeStorage(), session: makeStorage() };
    var fallback = await launch(noIdb);
    equal(fallback.status.backend, 'localstorage');
    equal(fallback.db.isPersistent(), true);
  });

  await it('falls back to memory when nothing is available', async function () {
    var blocked = {
      idb: undefined,
      local: makeStorage({ throwOnWrite: true }),
      session: makeStorage()
    };
    var fallback = await launch(blocked);
    equal(fallback.status.backend, 'memory');
    equal(fallback.db.isPersistent(), false, 'and it says so');
  });

  /* ==================================================================== */
  describe('students and attendance survive a restart');

  var school = device();
  var s1 = await launch(school);
  var accountA = await signIn(s1.db, SCHOOL_A);

  await it('stores students in IndexedDB, not localStorage', async function () {
    await addStudent(s1.db, {
      name: 'Ahmed Noor', fatherName: 'Imran Noor', roll: '1', className: '5', section: 'A'
    });

    equal(s1.db.backend(), 'indexeddb');
    equal(Object.keys(school.local._data).length, 0,
      'nothing was written to localStorage');
    equal(s1.db.Students.all().length, 1);
  });

  await it('finds the student again after the app is closed and reopened', async function () {
    var reopened = await launch(school);
    equal(reopened.status.backend, 'indexeddb');
    var students = reopened.db.Students.all();
    equal(students.length, 1);
    equal(students[0].name, 'Ahmed Noor');
    equal(students[0].fatherName, 'Imran Noor', 'father name survives');
  });

  await it('keeps the session across a restart', async function () {
    var reopened = await launch(school);
    equal(reopened.db.Auth.isSignedIn(), true);
    equal(reopened.db.Auth.current().schoolName, 'ABC Public School');
  });

  await it('keeps attendance across a restart', async function () {
    var live = await launch(school);
    var student = live.db.Students.all()[0];

    var marks = {};
    marks[student.id] = 'present';
    assert(live.db.Attendance.saveSession('2026-09-04', '5', 'A', marks).ok);
    assert(!(await flush(live.db)), 'attendance should persist');

    var reopened = await launch(school);
    equal(reopened.db.Attendance.count(), 1);
    equal(reopened.db.Attendance.sessionMarks('2026-09-04', '5', 'A')[student.id], 'present');
  });

  await it('keeps an edit across a restart', async function () {
    var live = await launch(school);
    var student = live.db.Students.all()[0];

    assert(live.db.Students.update(student.id, {
      name: 'Ahmed A. Noor', fatherName: 'Imran A. Noor',
      roll: '7', className: '6', section: 'B'
    }).ok);
    assert(!(await flush(live.db)));

    var reopened = await launch(school);
    var stored = reopened.db.Students.byId(student.id);
    equal(stored.name, 'Ahmed A. Noor');
    equal(stored.fatherName, 'Imran A. Noor');
    equal(stored.roll, '7');
    equal(reopened.db.Students.all().length, 1, 'no duplicate row');
  });

  await it('keeps a school-settings change across a restart', async function () {
    var live = await launch(school);
    assert(live.db.Auth.updateProfile({
      schoolName: 'ABC Model School', directorName: 'Mr. Imran A. Khan'
    }).ok);
    assert(!(await flush(live.db)));

    var reopened = await launch(school);
    equal(reopened.db.Auth.current().schoolName, 'ABC Model School');
    equal(reopened.db.Auth.current().directorName, 'Mr. Imran A. Khan');
  });

  await it('keeps a deletion across a restart', async function () {
    var live = await launch(school);
    var student = live.db.Students.all()[0];
    equal(live.db.Students.remove(student.id), true);
    assert(!(await flush(live.db)));

    var reopened = await launch(school);
    deepEqual(reopened.db.Students.all(), [], 'the student is gone for good');
    equal(reopened.db.Attendance.count(), 0, 'and so is their attendance');
  });

  /* ==================================================================== */
  describe('two schools stay isolated in IndexedDB');

  await it('keeps each school to its own rows across restarts', async function () {
    var shared = device();
    var first = await launch(shared);

    var a = await signIn(first.db, SCHOOL_A);
    await addStudent(first.db, { name: 'A Student', fatherName: 'A Father', roll: '1', className: '5', section: 'A' });
    first.db.Auth.logout();
    await flush(first.db);

    var b = await signIn(first.db, SCHOOL_B);
    await addStudent(first.db, { name: 'B Student', fatherName: 'B Father', roll: '1', className: '5', section: 'A' });
    assert(a.id !== b.id);

    deepEqual(first.db.Students.all().map(function (s) { return s.name; }), ['B Student']);

    var reopened = await launch(shared);
    equal(reopened.db.Auth.current().username, SCHOOL_B.username, 'still signed in as B');
    deepEqual(reopened.db.Students.all().map(function (s) { return s.name; }), ['B Student']);

    reopened.db.Auth.logout();
    await flush(reopened.db);
    assert(reopened.db.Auth.login(SCHOOL_A.username, SCHOOL_A.password, true).ok);
    await flush(reopened.db);
    deepEqual(reopened.db.Students.all().map(function (s) { return s.name; }), ['A Student']);
    equal(reopened.db.Students.all()[0].fatherName, 'A Father');
  });

  /* ==================================================================== */
  describe('migration from the old localStorage build');

  function legacyData() {
    return {
      'sa.accounts.v1': JSON.stringify([{
        id: 'acc_legacy', schoolName: 'Old School', directorName: 'Old Director',
        username: 'old_admin',
        salt: 'ffeeddccbbaa99887766554433221100',
        iterations: 20000,
        // hash of 'secret123' with that salt, generated below at load time
        passwordHash: '',
        logo: '', createdAt: 1, updatedAt: 1
      }]),
      'sa.session.v1': JSON.stringify({ accountId: 'acc_legacy', remember: true, at: 1 }),
      'sa.acc_legacy.students.v1': JSON.stringify([
        { id: 's_old1', name: 'Legacy Student', fatherName: 'Legacy Father',
          roll: '1', className: '5', section: 'A', createdAt: 1, updatedAt: 1 }
      ]),
      'sa.acc_legacy.attendance.v1': JSON.stringify({
        's_old1|2026-09-04': {
          studentId: 's_old1', date: '2026-09-04', status: 'present',
          className: '5', section: 'A', markedAt: 1
        }
      })
    };
  }

  /* The legacy account needs a real hash so sign-in can be verified. */
  require(CRYPTO_PATH);
  var legacyHash = globalThis.SchoolCrypto.hashPassword(
    'secret123', 'ffeeddccbbaa99887766554433221100',
    globalThis.SchoolCrypto.DEFAULT_ITERATIONS);

  function legacyDevice() {
    var data = legacyData();
    var accounts = JSON.parse(data['sa.accounts.v1']);
    accounts[0].passwordHash = legacyHash;
    data['sa.accounts.v1'] = JSON.stringify(accounts);
    return device({ localData: data });
  }

  await it('copies old localStorage data into IndexedDB on first launch', async function () {
    var old = legacyDevice();
    var upgraded = await launch(old);

    equal(upgraded.status.backend, 'indexeddb');
    equal(upgraded.status.migration.ran, true);
    equal(upgraded.status.migration.verified, true, upgraded.status.migration.note);
    equal(upgraded.status.migration.copied, 4, 'four keys carried over');
  });

  await it('brings the accounts, students, father names and attendance', async function () {
    var old = legacyDevice();
    var upgraded = await launch(old);

    equal(upgraded.db.Auth.isSignedIn(), true, 'the old session still works');
    equal(upgraded.db.Auth.current().schoolName, 'Old School');
    equal(upgraded.db.Auth.current().directorName, 'Old Director', 'settings carried over');

    var students = upgraded.db.Students.all();
    equal(students.length, 1);
    equal(students[0].name, 'Legacy Student');
    equal(students[0].fatherName, 'Legacy Father', 'father name carried over');

    equal(upgraded.db.Attendance.count(), 1);
    equal(upgraded.db.Attendance.records({})[0].status, 'present');
  });

  await it('does not delete the old localStorage data', async function () {
    var old = legacyDevice();
    await launch(old);

    assert(old.local._data['sa.accounts.v1'], 'accounts kept');
    assert(old.local._data['sa.acc_legacy.students.v1'], 'students kept');
    assert(old.local._data['sa.acc_legacy.attendance.v1'], 'attendance kept');
  });

  await it('only migrates once', async function () {
    var old = legacyDevice();
    await launch(old);
    var second = await launch(old);

    equal(second.status.migration.ran, false);
    equal(second.status.migration.note, 'already migrated');
    equal(second.db.Students.all().length, 1, 'and nothing was duplicated');
  });

  await it('lets migrated data be edited afterwards', async function () {
    var old = legacyDevice();
    var upgraded = await launch(old);
    var student = upgraded.db.Students.all()[0];

    assert(upgraded.db.Students.update(student.id, {
      name: 'Legacy Student', fatherName: 'Updated Father',
      roll: '1', className: '5', section: 'A'
    }).ok);
    assert(!(await flush(upgraded.db)));

    var reopened = await launch(old);
    equal(reopened.db.Students.byId('s_old1').fatherName, 'Updated Father');
  });

  await it('does not overwrite rows IndexedDB already holds', async function () {
    var old = legacyDevice();
    var upgraded = await launch(old);
    await addStudent(upgraded.db, {
      name: 'New Student', fatherName: 'New Father', roll: '2', className: '5', section: 'A'
    });

    // The legacy keys are still in localStorage; reopening must not undo this.
    var reopened = await launch(old);
    deepEqual(reopened.db.Students.all().map(function (s) { return s.name; }),
      ['Legacy Student', 'New Student']);
  });

  await it('reports nothing to migrate on a clean device', async function () {
    var clean = await launch(device());
    equal(clean.status.migration.ran, false);
    equal(clean.status.migration.note, 'nothing to migrate');
  });

  /* ==================================================================== */
  describe('a failing write is reported, never silently swallowed');

  var failDevice = device();
  var fa = await launch(failDevice);
  await signIn(fa.db, SCHOOL_A);
  await addStudent(fa.db, {
    name: 'Existing Student', fatherName: 'Existing Father',
    roll: '1', className: '5', section: 'A'
  });

  var marksBefore = {};
  marksBefore[fa.db.Students.all()[0].id] = 'present';
  fa.db.Attendance.saveSession('2026-09-04', '5', 'A', marksBefore);
  await flush(fa.db);

  await it('flush reports the error instead of success', async function () {
    failWrites = true;
    var result = fa.db.Students.create({
      name: 'Doomed Student', fatherName: 'Doomed Father',
      roll: '9', className: '9', section: 'Z'
    });
    equal(result.ok, true, 'the model accepted it');

    var err = await flush(fa.db);
    assert(err, 'but flush must report the write failure');
    assert(/Quota|failed|abort/i.test(err.name + ' ' + err.message), err.name + ': ' + err.message);
  });

  await it('does NOT make the app look logged out', async function () {
    equal(fa.db.Auth.isSignedIn(), true, 'still signed in');
    assert(fa.db.Auth.current(), 'the account is still readable');
    equal(fa.db.Auth.current().schoolName, 'ABC Public School');
  });

  await it('does NOT replace valid data with an empty view', async function () {
    var students = fa.db.Students.all();
    equal(students.length, 1, 'the existing student is still there');
    equal(students[0].name, 'Existing Student');
    equal(students[0].fatherName, 'Existing Father');
    equal(fa.db.Attendance.count(), 1, 'and the existing attendance');
  });

  await it('rolls the failed change back so memory matches the disk', async function () {
    equal(fa.db.Students.all().filter(function (s) {
      return s.name === 'Doomed Student';
    }).length, 0, 'the row that could not be saved is not pretended to exist');
  });

  await it('leaves the saved data intact on disk', async function () {
    failWrites = false;
    var reopened = await launch(failDevice);
    equal(reopened.db.Auth.isSignedIn(), true);
    var students = reopened.db.Students.all();
    equal(students.length, 1);
    equal(students[0].name, 'Existing Student');
    equal(students[0].fatherName, 'Existing Father');
    equal(reopened.db.Attendance.count(), 1);
  });

  await it('works again once storage recovers', async function () {
    var live = await launch(failDevice);
    await addStudent(live.db, {
      name: 'Later Student', fatherName: 'Later Father', roll: '2', className: '5', section: 'A'
    });
    var reopened = await launch(failDevice);
    equal(reopened.db.Students.all().length, 2);
  });

  await it('reports a failed attendance save too', async function () {
    var live = await launch(failDevice);
    var roster = live.db.Students.roster('5', 'A');
    failWrites = true;

    var marks = {};
    roster.forEach(function (s) { marks[s.id] = 'absent'; });
    assert(live.db.Attendance.saveSession('2026-10-01', '5', 'A', marks).ok);

    assert(await flush(live.db), 'the failure must be reported');
    failWrites = false;

    var reopened = await launch(failDevice);
    equal(reopened.db.Attendance.records({ date: '2026-10-01' }).length, 0,
      'nothing was recorded for that day');
    equal(reopened.db.Attendance.count(), 1, 'and the earlier day is untouched');
  });

  await it('reports a failed settings change too', async function () {
    var live = await launch(failDevice);
    failWrites = true;
    assert(live.db.Auth.updateProfile({
      schoolName: 'Renamed School', directorName: 'Someone Else'
    }).ok);
    assert(await flush(live.db), 'the failure must be reported');
    failWrites = false;

    var reopened = await launch(failDevice);
    equal(reopened.db.Auth.current().schoolName, 'ABC Public School', 'the old name stands');
  });

  /* ==================================================================== */
  describe('the memoryOnly read-swap bug is gone');

  await it('a failed localStorage write no longer hides saved data', async function () {
    // The exact scenario that used to blank the app: localStorage backend,
    // data already saved, then a write starts failing.
    var storage = makeStorage();
    var dev2 = { idb: undefined, local: storage, session: makeStorage() };
    var live = await launch(dev2);

    await signIn(live.db, SCHOOL_A);
    await addStudent(live.db, {
      name: 'Existing Student', fatherName: 'Existing Father',
      roll: '1', className: '5', section: 'A'
    });

    equal(live.db.Auth.isSignedIn(), true);
    equal(live.db.Students.all().length, 1);

    // From here every write throws.
    storage.setItem = function () { throw new Error('QuotaExceededError'); };

    var result = live.db.Students.create({
      name: 'Doomed', fatherName: 'Doomed Father', roll: '2', className: '5', section: 'A'
    });
    equal(result.ok, true);
    assert(await flush(live.db), 'the failure is reported');

    equal(live.db.Auth.isSignedIn(), true, 'STILL SIGNED IN (was false before the fix)');
    equal(live.db.Students.all().length, 1, 'STILL SEES ITS DATA (was 0 before the fix)');
    equal(live.db.Students.all()[0].name, 'Existing Student');
  });

  /* -------------------------------------------------------------- report */
  IDBDatabaseProto.transaction = realTransaction;
  h.report('storage tests');
}

main().catch(function (err) {
  IDBDatabaseProto.transaction = realTransaction;
  console.error(err);
  process.exit(1);
});
