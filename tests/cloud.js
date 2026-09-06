/* Cloud accounts: one username and password, any number of devices.

   Two jsdom pages pointed at one fake Firebase backend, each with its own
   IndexedDB, are two phones. That is the only way to test the actual feature
   — that a school signs in somewhere new and finds its register waiting.
   `npm run test:cloud` */

'use strict';

var h = require('./harness');
var { startServer, stopServer, openApp } = require('./helpers');
var { createBackend } = require('./fake-firebase');
var fakeIndexedDB = require('fake-indexeddb');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;

var DOMAIN = 'users.test';

/** Point a freshly opened page at a fake Firebase and switch cloud mode on. */
function connect(page, backend) {
  page.window.firebase = backend.firebase;
  page.window.SchoolCloud._config({
    enabled: true,
    apiKey: 'test-key',
    projectId: 'test-project',
    usernameDomain: DOMAIN
  });
}

/** A device: its own storage, its own page, sharing one cloud. */
async function device(backend, seed) {
  var page = await openApp(Object.assign({ account: null }, seed || {}));
  connect(page, backend);
  return page;
}

var SCHOOL = {
  schoolName: 'ABC Public School',
  directorName: 'Mr. Imran Khan',
  username: 'abc_admin',
  password: 'secret123'
};

/* ==================================== run ================================== */

async function main() {
  await startServer();

  /* ==================================================================== */
  describe('creating an account puts it in the cloud');

  var cloud = createBackend();
  var phone1 = await device(cloud);
  var uid;

  await it('registers with Firebase, not just on the device', async function () {
    phone1.doRegister(SCHOOL);
    await phone1.waitFor(phone1.appVisible, 'the app to open');

    deepEqual(cloud.users(), ['abc_admin@' + DOMAIN], 'the username became an address');
    uid = cloud.uidFor('abc_admin@' + DOMAIN);
    assert(uid, 'a uid was issued');
  });

  await it('writes the school profile under its own uid', async function () {
    var school = cloud.read('schools/' + uid);
    assert(school, 'the school document exists');
    equal(school.schoolName, 'ABC Public School');
    equal(school.directorName, 'Mr. Imran Khan');
    equal(school.username, 'abc_admin');
  });

  await it('remembers the cloud id on the local account', async function () {
    equal(phone1.window.SchoolDB.Auth.current().cloudUid, uid);
  });

  await it('signs in on the device as well, so the app works offline', async function () {
    equal(phone1.signedIn(), true);
    equal(phone1.schoolName(), 'ABC Public School');
  });

  /* ==================================================================== */
  describe('work done on the first phone reaches the cloud');

  await it('pushes students', async function () {
    phone1.goTo('students');
    phone1.addStudent({ name: 'Ayesha Khan', fatherName: 'Imran Khan', roll: '1', className: '5', section: 'A' });
    await phone1.tick();
    phone1.addStudent({ name: 'Bilal Shah', fatherName: 'Kamran Shah', roll: '2', className: '5', section: 'A' });
    await phone1.tick();

    phone1.window.CloudSync._flushPush();
    await phone1.waitFor(function () {
      return cloud.childrenOf(uid, 'students').length === 2;
    }, 'the students to reach the cloud');
  });

  await it('pushes attendance', async function () {
    phone1.goTo('attendance');
    phone1.pick('#a-class', '5');
    phone1.pick('#a-section', 'A');
    phone1.pick('#a-date', '2026-09-04');
    phone1.mark('Ayesha Khan', 'present');
    phone1.mark('Bilal Shah', 'absent');
    phone1.saveAttendance();
    await phone1.tick();

    phone1.window.CloudSync._flushPush();
    await phone1.waitFor(function () {
      return cloud.childrenOf(uid, 'attendance').length === 2;
    }, 'the attendance to reach the cloud');
  });

  await it('files everything under this school, nowhere else', async function () {
    var stray = Object.keys(cloud.docs()).filter(function (path) {
      return path.indexOf('schools/' + uid) !== 0;
    });
    deepEqual(stray, [], 'nothing was written outside this school');
  });

  /* ==================================================================== */
  describe('signing in on a second phone');

  var phone2;

  await it('accepts the same username and password', async function () {
    phone2 = await device(cloud);
    equal(phone2.authVisible(), true, 'a brand new device asks for an account');
    equal(phone2.dbStudents().length, 0, 'and starts with nothing');

    phone2.doLogin('abc_admin', 'secret123', true);
    await phone2.waitFor(phone2.appVisible, 'the second phone to sign in');
  });

  await it('shows the same school', async function () {
    equal(phone2.schoolName(), 'ABC Public School');
    equal(phone2.window.SchoolDB.Auth.current().cloudUid, uid, 'the same cloud account');
  });

  await it('has pulled the students down, father names and all', async function () {
    phone2.goTo('students');
    deepEqual(phone2.names(), ['Ayesha Khan', 'Bilal Shah']);
    equal(phone2.fatherOf('Ayesha Khan'), 'S/D of Imran Khan');
    equal(phone2.fatherOf('Bilal Shah'), 'S/D of Kamran Shah');
  });

  await it('has pulled the attendance down too', async function () {
    equal(phone2.dbAttendanceCount(), 2);
    phone2.goTo('attendance');
    phone2.pick('#a-class', '5');
    phone2.pick('#a-section', 'A');
    phone2.pick('#a-date', '2026-09-04');
    equal(phone2.markOf('Ayesha Khan'), 'present');
    equal(phone2.markOf('Bilal Shah'), 'absent');
  });

  await it('the dashboard counts what came down', async function () {
    phone2.goTo('dashboard');
    equal(phone2.dash().total, 2);
    equal(phone2.dash().school, 'ABC Public School');
  });

  /* ==================================================================== */
  describe('changes made on the second phone come back to the first');

  await it('a student added there appears here', async function () {
    phone2.goTo('students');
    phone2.addStudent({ name: 'Chand Bibi', fatherName: 'Nasir Ali', roll: '3', className: '5', section: 'A' });
    await phone2.tick();
    phone2.window.CloudSync._flushPush();

    await phone2.waitFor(function () {
      return cloud.childrenOf(uid, 'students').length === 3;
    }, 'the new student to go up');

    await phone1.waitFor(function () {
      return phone1.dbStudents().length === 3;
    }, 'the first phone to catch up');

    phone1.goTo('students');
    deepEqual(phone1.names(), ['Ayesha Khan', 'Bilal Shah', 'Chand Bibi']);
  });

  await it('and a deletion travels too', async function () {
    var card = phone2.cards().filter(function (c) {
      return c.querySelector('.card__name').textContent === 'Bilal Shah';
    })[0];
    card.querySelector('.iconbtn--danger').click();
    phone2.confirmYes();
    await phone2.tick();
    phone2.window.CloudSync._flushPush();

    await phone1.waitFor(function () {
      return phone1.dbStudents().length === 2;
    }, 'the deletion to reach the first phone');

    assert(phone1.dbStudents().indexOf('Bilal Shah') === -1, 'gone from the first phone');
  });

  phone2.close();

  /* ==================================================================== */
  describe('a different school sees none of it');

  await it('keeps two accounts completely apart', async function () {
    var other = await device(cloud);
    other.doRegister({
      schoolName: 'XYZ Model School',
      directorName: 'Mrs. Sara Ahmed',
      username: 'xyz_admin',
      password: 'other456'
    });
    await other.waitFor(other.appVisible, 'the second school to be created');

    var otherUid = cloud.uidFor('xyz_admin@' + DOMAIN);
    assert(otherUid && otherUid !== uid, 'a separate cloud account');

    other.goTo('students');
    deepEqual(other.names(), [], 'no students from the other school');
    equal(other.dbAttendanceCount(), 0, 'and no attendance either');
    equal(other.schoolName(), 'XYZ Model School');

    other.addStudent({ name: 'Zara Ali', fatherName: 'Kamal Ali', roll: '1', className: '1', section: 'A' });
    await other.tick();
    other.window.CloudSync._flushPush();
    await other.waitFor(function () {
      return cloud.childrenOf(otherUid, 'students').length === 1;
    }, 'the other school to save');

    deepEqual(cloud.childrenOf(uid, 'students').length, 2, 'the first school is untouched');
    other.close();
  });

  await it('refuses a username that is already taken', async function () {
    var clash = await device(cloud);
    clash.doRegister({
      schoolName: 'Another School',
      directorName: 'Someone Else',
      username: 'abc_admin',
      password: 'nope1234'
    });
    await clash.tick();
    await clash.tick();

    equal(clash.appVisible(), false, 'not let in');
    assert(/already taken|already/i.test(clash.text('#auth-view')), 'says the username is taken');
    clash.close();
  });

  /* ==================================================================== */
  describe('the wrong password');

  await it('is refused, and does not sign anyone in', async function () {
    var wrong = await device(cloud);
    wrong.doLogin('abc_admin', 'not-the-password', true);
    await wrong.tick();
    await wrong.tick();

    equal(wrong.appVisible(), false, 'still on the sign-in screen');
    equal(wrong.signedIn(), false);
    wrong.close();
  });

  phone1.close();

  /* ==================================================================== */
  describe('with no connection');

  await it('still signs in on a device that has synced before', async function () {
    var backend = createBackend();
    var deviceDB = new fakeIndexedDB.IDBFactory();

    var first = await openApp({ account: null, indexedDB: deviceDB });
    connect(first, backend);
    first.doRegister(SCHOOL);
    await first.waitFor(first.appVisible, 'setup');
    first.goTo('students');
    first.addStudent({ name: 'Offline Student', fatherName: 'Offline Father', roll: '1', className: '5', section: 'A' });
    await first.tick();
    first.doLogout();
    await first.tick();
    first.close();

    // Same device, but now the phone has no signal at all.
    var again = await openApp({ account: null, indexedDB: deviceDB });
    connect(again, backend);
    Object.defineProperty(again.window.navigator, 'onLine', { value: false, configurable: true });

    again.doLogin('abc_admin', 'secret123', true);
    await again.waitFor(again.appVisible, 'the offline sign-in');

    equal(again.signedIn(), true, 'signed in from the local copy');
    again.goTo('students');
    deepEqual(again.names(), ['Offline Student'], 'and the register is still there');
    again.close();
  });

  await it('refuses to create a NEW account with no connection', async function () {
    var backend = createBackend();
    var offline = await device(backend);
    Object.defineProperty(offline.window.navigator, 'onLine', { value: false, configurable: true });

    offline.doRegister({
      schoolName: 'No Signal School', directorName: 'Nobody',
      username: 'nosignal', password: 'secret123'
    });
    await offline.tick();

    equal(offline.appVisible(), false, 'no account was created');
    deepEqual(backend.users(), [], 'and nothing reached the cloud');
    assert(/internet connection/i.test(offline.toastText()),
      'explains why: ' + offline.toastText());
    offline.close();
  });

  /* ==================================================================== */
  describe('cloud switched off');

  await it('behaves exactly as the offline-only app did', async function () {
    var plain = await openApp({ account: null });   // no connect() — cloud stays off

    /* Said explicitly rather than relying on js/firebase-config.js being
       blank: once the app is connected to a real project that file ships
       enabled:true, and this test is about the local-only path, not about
       whatever the current deployment happens to be. */
    plain.window.SchoolCloud._config({ enabled: false });

    equal(plain.window.CloudSync.enabled(), false);
    equal(plain.window.SchoolCloud.isConfigured(), false);

    plain.doRegister(SCHOOL);
    await plain.waitFor(plain.appVisible, 'local-only setup');

    equal(plain.signedIn(), true);
    equal(plain.window.SchoolDB.Auth.current().cloudUid, '', 'no cloud id');

    plain.goTo('students');
    plain.addStudent({ name: 'Local Only', fatherName: 'Local Father', roll: '1', className: '5', section: 'A' });
    await plain.tick();
    deepEqual(plain.names(), ['Local Only']);
    plain.close();
  });

  /* -------------------------------------------------------------- report */
  stopServer();
  h.report('cloud account tests');
}

main().catch(function (err) {
  console.error(err);
  stopServer();
  process.exit(1);
});
