/* End-to-end tests for storage behaviour through the real UI: the app running
   on IndexedDB, surviving relaunches, and refusing to claim a failed save
   succeeded. `npm run test:ui-storage` */

'use strict';

var h = require('./harness');
var { startServer, stopServer, openApp } = require('./helpers');
var fakeIndexedDB = require('fake-indexeddb');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;

var IDBDatabaseProto = fakeIndexedDB.IDBDatabase.prototype;
var realTransaction = IDBDatabaseProto.transaction;
var failWrites = false;

IDBDatabaseProto.transaction = function (names, mode) {
  if (failWrites && mode === 'readwrite') {
    var err = new Error('QuotaExceededError');
    err.name = 'QuotaExceededError';
    throw err;
  }
  return realTransaction.apply(this, arguments);
};

var DAY = '2026-09-04';

/* ==================================== run ================================== */

async function main() {
  await startServer();

  /* One factory shared by every openApp below: the same device, relaunched. */
  var deviceDB = new fakeIndexedDB.IDBFactory();

  /* ==================================================================== */
  describe('the app runs on IndexedDB');

  var page = await openApp({ account: null, indexedDB: deviceDB });

  await it('opens the setup screen once IndexedDB is ready', async function () {
    equal(page.authVisible(), true);
    equal(page.registerVisible(), true);
  });

  await it('reports IndexedDB as the backend', async function () {
    equal(page.backend(), 'indexeddb');
  });

  await it('creates a school through the form', async function () {
    page.doRegister({
      schoolName: 'ABC Public School', directorName: 'Mr. Imran Khan',
      username: 'abc_admin', password: 'secret123'
    });
    // Registering writes the account, then signs in, then writes the session:
    // two IndexedDB round trips with a password hash between them.
    await page.waitFor(page.appVisible, 'the app to open after setup');

    equal(page.appVisible(), true, 'signed in after setup');
    equal(page.schoolName(), 'ABC Public School');
  });

  await it('writes nothing to localStorage', async function () {
    equal(page.rawKey('sa.accounts.v1'), null, 'accounts are not in localStorage');
    equal(page.accounts().length, 0);
  });

  await it('adds students with father names', async function () {
    page.goTo('students');
    page.addStudent({ name: 'Ahmed Noor', fatherName: 'Imran Noor', roll: '1', className: '5', section: 'A' });
    await page.tick();
    page.addStudent({ name: 'Bilal Shah', fatherName: 'Kamran Shah', roll: '2', className: '5', section: 'A' });
    await page.tick();

    deepEqual(page.dbStudents(), ['Ahmed Noor', 'Bilal Shah']);
    assert(/Bilal Shah added/.test(page.toastText()), page.toastText());
  });

  await it('saves attendance', async function () {
    page.goTo('attendance');
    page.pick('#a-class', '5');
    page.pick('#a-section', 'A');
    page.pick('#a-date', DAY);
    page.mark('Ahmed Noor', 'present');
    page.mark('Bilal Shah', 'absent');
    page.saveAttendance();
    await page.tick();

    equal(page.dbAttendanceCount(), 2);
    assert(/Attendance saved/.test(page.toastText()), page.toastText());
  });

  await it('changes a school setting', async function () {
    page.goTo('settings');
    page.type('#s-school', 'ABC Model School');
    page.type('#s-director', 'Mr. Imran A. Khan');
    page.submitForm('#profile-form');
    await page.tick();

    assert(/saved/i.test(page.toastText()), page.toastText());
    equal(page.schoolName(), 'ABC Model School');
  });

  page.close();

  /* ==================================================================== */
  describe('close the app and reopen it');

  var reopened = await openApp({ account: null, indexedDB: deviceDB });

  await it('comes back signed in, with no sign-in screen', async function () {
    equal(reopened.appVisible(), true);
    equal(reopened.authVisible(), false);
    equal(reopened.signedIn(), true);
  });

  await it('still on IndexedDB', async function () {
    equal(reopened.backend(), 'indexeddb');
  });

  await it('kept the school settings', async function () {
    equal(reopened.schoolName(), 'ABC Model School');
    reopened.goTo('settings');
    equal(reopened.text('#settings-school'), 'ABC Model School');
    assert(/Mr. Imran A. Khan/.test(reopened.text('#settings-director')));
  });

  await it('kept the students and their father names', async function () {
    reopened.goTo('students');
    deepEqual(reopened.names(), ['Ahmed Noor', 'Bilal Shah']);
    equal(reopened.fatherOf('Ahmed Noor'), 'S/D of Imran Noor');
    equal(reopened.fatherOf('Bilal Shah'), 'S/D of Kamran Shah');
  });

  await it('kept the attendance', async function () {
    reopened.goTo('attendance');
    reopened.pick('#a-class', '5');
    reopened.pick('#a-section', 'A');
    reopened.pick('#a-date', DAY);
    equal(reopened.markOf('Ahmed Noor'), 'present');
    equal(reopened.markOf('Bilal Shah'), 'absent');
  });

  await it('shows the right numbers on the dashboard', async function () {
    reopened.goTo('dashboard');
    var dash = reopened.dash();
    equal(dash.total, 2);
    equal(dash.school, 'ABC Model School');
  });

  /* ==================================================================== */
  describe('editing and deleting survive a relaunch');

  await it('edits a student', async function () {
    reopened.goTo('students');
    reopened.cards()[0].querySelector('.iconbtn:not(.iconbtn--danger)').click();
    reopened.type('#f-name', 'Ahmed A. Noor');
    reopened.type('#f-father', 'Imran A. Noor');
    reopened.submit();
    await reopened.tick();
    assert(/updated/.test(reopened.toastText()), reopened.toastText());
  });

  await it('deletes the other student', async function () {
    var card = reopened.cards().filter(function (c) {
      return c.querySelector('.card__name').textContent === 'Bilal Shah';
    })[0];
    card.querySelector('.iconbtn--danger').click();
    reopened.confirmYes();
    await reopened.tick();
    assert(/deleted/.test(reopened.toastText()), reopened.toastText());
  });

  reopened.close();

  var third = await openApp({ account: null, indexedDB: deviceDB });

  await it('the edit stuck', async function () {
    third.goTo('students');
    deepEqual(third.names(), ['Ahmed A. Noor']);
    equal(third.fatherOf('Ahmed A. Noor'), 'S/D of Imran A. Noor');
  });

  await it('the deletion stuck, and took its attendance with it', async function () {
    equal(third.dbStudents().length, 1);
    equal(third.dbAttendanceCount(), 1, 'only the remaining student is recorded');
  });

  /* ==================================================================== */
  describe('a save that fails is never reported as success');

  await it('shows an error, not a success message', async function () {
    third.goTo('students');
    var before = third.dbStudents().length;

    failWrites = true;
    third.addStudent({ name: 'Doomed Student', fatherName: 'Doomed Father', roll: '9', className: '9', section: 'Z' });
    await third.tick();

    var toast = third.toastText();
    assert(/Could not save/.test(toast), 'expected a failure message, got: ' + toast);
    assert(!/added/.test(toast), 'must NOT say the student was added');
    equal(third.dbStudents().length, before, 'and the row is not pretended to exist');
  });

  await it('does not log the user out', async function () {
    equal(third.appVisible(), true, 'still in the app');
    equal(third.authVisible(), false, 'not thrown back to sign-in');
    equal(third.signedIn(), true);
    equal(third.schoolName(), 'ABC Model School');
  });

  await it('does not blank the existing data', async function () {
    third.goTo('students');
    deepEqual(third.names(), ['Ahmed A. Noor'], 'the saved student is still listed');
    equal(third.fatherOf('Ahmed A. Noor'), 'S/D of Imran A. Noor');
    third.goTo('dashboard');
    equal(third.dash().total, 1, 'the dashboard still counts it');
  });

  await it('reports a failed attendance save the same way', async function () {
    third.goTo('attendance');
    third.pick('#a-class', '5');
    third.pick('#a-section', 'A');
    third.pick('#a-date', '2026-10-01');
    third.mark('Ahmed A. Noor', 'leave');
    third.saveAttendance();
    await third.tick();

    var toast = third.toastText();
    assert(/Could not save/.test(toast), 'expected a failure message, got: ' + toast);
    assert(!/Attendance saved|Attendance updated/.test(toast), 'must not claim it saved');
  });

  await it('leaves the save bar showing unsaved work', async function () {
    assert(/unsaved/.test(third.text('#savebar-info')), third.text('#savebar-info'));
    equal(third.$('#a-save').disabled, false, 'the teacher can retry');
  });

  await it('reports a failed settings change the same way', async function () {
    third.goTo('settings');
    third.type('#s-school', 'Renamed School');
    third.submitForm('#profile-form');
    await third.tick();

    assert(/Could not save/.test(third.toastText()), third.toastText());
    equal(third.schoolName(), 'ABC Model School', 'the app bar shows the stored name again');
    equal(third.$('#s-school').value, 'ABC Model School', 'and so does the form');
  });

  await it('works again once storage recovers', async function () {
    failWrites = false;
    third.goTo('students');
    third.addStudent({ name: 'Later Student', fatherName: 'Later Father', roll: '5', className: '5', section: 'A' });
    await third.tick();

    assert(/Later Student added/.test(third.toastText()), third.toastText());
    deepEqual(third.dbStudents(), ['Ahmed A. Noor', 'Later Student']);
  });

  third.close();

  await it('and the recovered save really is on disk', async function () {
    var fourth = await openApp({ account: null, indexedDB: deviceDB });
    fourth.goTo('students');
    deepEqual(fourth.names(), ['Ahmed A. Noor', 'Later Student']);
    equal(fourth.dbStudents().indexOf('Doomed Student'), -1, 'the failed one never landed');
    fourth.close();
  });

  /* ==================================================================== */
  describe('migrating a device from the old localStorage build');

  await it('carries everything over on first launch and keeps the original', async function () {
    var freshDevice = new fakeIndexedDB.IDBFactory();

    var upgraded = await openApp({
      indexedDB: freshDevice,
      students: [
        { id: 's_old', name: 'Legacy Student', fatherName: 'Legacy Father',
          roll: '1', className: '5', section: 'A', createdAt: 1, updatedAt: 1 }
      ],
      attendance: {
        's_old|2026-09-04': {
          studentId: 's_old', date: '2026-09-04', status: 'present',
          className: '5', section: 'A', markedAt: 1
        }
      }
    });

    equal(upgraded.backend(), 'indexeddb');
    var migration = upgraded.migration();
    equal(migration.ran, true, migration.note);
    equal(migration.verified, true, migration.note);

    equal(upgraded.signedIn(), true, 'the seeded session carried over');
    equal(upgraded.schoolName(), 'Test School');

    upgraded.goTo('students');
    deepEqual(upgraded.names(), ['Legacy Student']);
    equal(upgraded.fatherOf('Legacy Student'), 'S/D of Legacy Father');
    equal(upgraded.dbAttendanceCount(), 1);

    assert(upgraded.rawKey('sa.accounts.v1'), 'the localStorage original is kept');
    upgraded.close();
  });

  /* -------------------------------------------------------------- report */
  IDBDatabaseProto.transaction = realTransaction;
  stopServer();
  h.report('storage UI tests');
}

main().catch(function (err) {
  IDBDatabaseProto.transaction = realTransaction;
  console.error(err);
  stopServer();
  process.exit(1);
});
