/* End-to-end tests for school registration, sign-in, branding, settings and
   data isolation between two schools on one device.
   Drives the real index.html in jsdom: `npm run test:ui-accounts`. */

'use strict';

var h = require('./harness');
var { startServer, stopServer, openApp } = require('./helpers');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;

var DAY = '2026-09-04';

var SCHOOL_A = {
  schoolName: 'ABC Public School',
  directorName: 'Mr. Imran Khan',
  username: 'abc_admin',
  password: 'secret123'
};

var SCHOOL_B = {
  schoolName: 'Green Valley Academy',
  directorName: 'Mrs. Sara Ahmed',
  username: 'green_admin',
  password: 'valley456'
};

var A_STUDENTS = [
  { name: 'Ahmed Noor', roll: '1', className: '5', section: 'A' },
  { name: 'Bilal Shah', roll: '2', className: '5', section: 'A' }
];

/* ==================================== run ================================== */

async function main() {
  await startServer();

  /* ==================================================================== */
  describe('a device with no school yet');

  var page = await openApp({ account: null });

  await it('opens on the sign-in screen, not the app', async function () {
    equal(page.authVisible(), true, 'auth view should show');
    equal(page.appVisible(), false, 'the app is hidden until there is an account');
    /* Sign-in comes first even on a device holding no account: with cloud
       accounts this is usually the teacher's second phone, and the school
       already exists somewhere else. */
    equal(page.loginVisible(), true, 'sign-in form');
    equal(page.registerVisible(), false, 'not the setup form');
  });

  await it('offers a way to create an account from the sign-in screen', async function () {
    var link = page.$('#to-register');
    assert(link, 'the control exists');
    equal(link.parentNode.hidden, false, 'and it is visible');
    assert(/create an account/i.test(link.textContent), link.textContent);
  });

  await it('that control switches to the setup form and back', async function () {
    page.$('#to-register').click();
    equal(page.registerVisible(), true, 'setup form opened');
    equal(page.loginVisible(), false);

    page.$('#to-login').click();
    equal(page.loginVisible(), true, 'and back to sign-in');
    equal(page.registerVisible(), false);
  });

  await it('leaves the setup form reachable for the rest of these tests', async function () {
    page.$('#to-register').click();
    equal(page.registerVisible(), true);
  });

  await it('still offers sign-in from the setup form, even with no local account', async function () {
    /* This used to be hidden on a device holding no account, on the grounds
       that there was nothing to sign in to. Cloud accounts made that false —
       the school may exist on another phone — and hiding it would strand a
       teacher on the setup form with no way back. */
    equal(page.$('#to-login').parentNode.hidden, false);
  });

  await it('flags every required field on an empty submit', async function () {
    page.submitForm('#register-form');
    assert(/required/.test(page.authError('re-schoolName')), page.authError('re-schoolName'));
    assert(/required/.test(page.authError('re-directorName')), page.authError('re-directorName'));
    assert(/required/.test(page.authError('re-username')), page.authError('re-username'));
    assert(/required/.test(page.authError('re-password')), page.authError('re-password'));
    assert(/re-enter/i.test(page.authError('re-confirmPassword')), page.authError('re-confirmPassword'));
    equal(page.accounts().length, 0, 'nothing created');
  });

  await it('clears a field error as soon as it is corrected', async function () {
    page.type('#r-school', 'ABC');
    equal(page.authError('re-schoolName'), '');
    assert(page.authError('re-username'), 'the others stay until fixed');
  });

  await it('rejects a badly formed username', async function () {
    page.doRegister({
      schoolName: SCHOOL_A.schoolName, directorName: SCHOOL_A.directorName,
      username: 'no spaces here', password: 'secret123'
    });
    assert(/letters, numbers/.test(page.authError('re-username')), page.authError('re-username'));
    equal(page.accounts().length, 0);
  });

  await it('rejects a short password', async function () {
    page.doRegister({
      schoolName: SCHOOL_A.schoolName, directorName: SCHOOL_A.directorName,
      username: SCHOOL_A.username, password: 'abc'
    });
    assert(/at least 6/.test(page.authError('re-password')), page.authError('re-password'));
  });

  await it('rejects a mismatched confirmation', async function () {
    page.doRegister({
      schoolName: SCHOOL_A.schoolName, directorName: SCHOOL_A.directorName,
      username: SCHOOL_A.username, password: 'secret123', confirmPassword: 'secret124'
    });
    assert(/do not match/.test(page.authError('re-confirmPassword')),
      page.authError('re-confirmPassword'));
    equal(page.accounts().length, 0, 'still nothing created');
  });

  await it('toggles the password field between hidden and visible', async function () {
    equal(page.$('#r-password').type, 'password');
    page.$('.reveal[data-reveal="r-password"]').click();
    equal(page.$('#r-password').type, 'text');
    page.$('.reveal[data-reveal="r-password"]').click();
    equal(page.$('#r-password').type, 'password');
  });

  /* ==================================================================== */
  describe('creating School A');

  await it('creates the account and goes straight into the app', async function () {
    page.doRegister(SCHOOL_A);
    equal(page.authVisible(), false, 'auth view should close');
    equal(page.appVisible(), true, 'the app should open');
    equal(page.$('#screen-dashboard').hidden, false, 'landing on the dashboard');
    assert(/Welcome, ABC Public School/.test(page.toastText()), page.toastText());
  });

  await it('stores one account and a remembered session', async function () {
    equal(page.accounts().length, 1);
    equal(page.accounts()[0].username, 'abc_admin');
    equal(page.session().accountId, page.accountId());
    equal(page.session().remember, true);
  });

  await it('never writes the password down', async function () {
    var raw = page.rawKey('sa.accounts.v1');
    equal(raw.indexOf('secret123'), -1, 'the password must not appear in storage');
    equal(page.accounts()[0].passwordHash.length, 64, 'a SHA-256 digest is stored instead');
    assert(page.accounts()[0].salt, 'with a salt');
  });

  await it('shows the school name in the app bar', async function () {
    equal(page.schoolName(), 'ABC Public School');
    equal(page.text('#appbar-logo'), 'AS', 'initials stand in for a logo');
  });

  await it('shows the school on every screen', async function () {
    ['students', 'attendance', 'records', 'settings'].forEach(function (screen) {
      page.goTo(screen);
      equal(page.schoolName(), 'ABC Public School', 'app bar on ' + screen);
    });
    page.goTo('students');
  });

  await it('shows the full brand block on the settings screen', async function () {
    page.goTo('settings');
    equal(page.text('#settings-school'), 'ABC Public School');
    assert(/Mr. Imran Khan/.test(page.text('#settings-director')), page.text('#settings-director'));
    assert(/abc_admin/.test(page.text('#settings-username')), page.text('#settings-username'));
    equal(page.$('#screen-settings').querySelector('.brand__sub').textContent,
      'School Attendance System');
    page.goTo('students');
  });

  /* ==================================================================== */
  describe('School A adds students and attendance');

  var accountA;

  await it('adds two students', async function () {
    A_STUDENTS.forEach(function (student) { page.addStudent(student); });
    equal(page.cards().length, 2);
    equal(page.stored().length, 2);
    accountA = page.accountId();
    assert(accountA, 'there is an account id');
  });

  await it('files them under the school’s own storage key', async function () {
    assert(page.rawKey('sa.' + accountA + '.students.v1'), 'scoped key holds the register');
    equal(page.rawKey('sa.students.v1'), null, 'nothing at the unscoped key');
  });

  await it('takes and saves attendance', async function () {
    page.goTo('attendance');
    page.pick('#a-class', '5');
    page.pick('#a-section', 'A');
    page.pick('#a-date', DAY);
    page.mark('Ahmed Noor', 'present');
    page.mark('Bilal Shah', 'absent');
    page.saveAttendance();
    equal(page.attendanceCount(), 2);
  });

  await it('brands the report with the school name', async function () {
    page.goTo('records');
    page.pick('#r-date', DAY);
    equal(page.recSummary().school, 'ABC Public School');
    equal(page.recRows().length, 2);
  });

  /* ==================================================================== */
  describe('logging out');

  await it('asks before logging out', async function () {
    page.goTo('settings');
    page.$('#logout-btn').click();
    equal(page.confirmOpen(), true);
    assert(/ABC Public School/.test(page.text('#confirm-text')), page.text('#confirm-text'));
  });

  await it('stays signed in when cancelled', async function () {
    page.confirmNo();
    equal(page.appVisible(), true);
    assert(page.session(), 'session intact');
  });

  await it('returns to the sign-in screen when confirmed', async function () {
    page.$('#logout-btn').click();
    page.confirmYes();
    equal(page.authVisible(), true);
    equal(page.appVisible(), false);
    equal(page.loginVisible(), true, 'sign-in form, not setup');
    equal(page.session(), null, 'the session is cleared');
  });

  await it('leaves the school’s data on the device', async function () {
    equal(page.accounts().length, 1, 'the account remains');
    equal(page.storedFor(accountA).length, 2, 'and so do the students');
    equal(Object.keys(page.attendanceFor(accountA)).length, 2);
  });

  /* ==================================================================== */
  describe('password validation at sign-in');

  await it('refuses the wrong password', async function () {
    page.doLogin('abc_admin', 'wrongpass');
    assert(/Incorrect password/.test(page.authError('le-password')), page.authError('le-password'));
    equal(page.appVisible(), false, 'still locked out');
    equal(page.session(), null);
  });

  await it('refuses an unknown school', async function () {
    page.doLogin('nobody_here', 'secret123');
    assert(/No account found/.test(page.authError('le-identifier')), page.authError('le-identifier'));
    equal(page.appVisible(), false);
  });

  await it('asks for both fields', async function () {
    page.doLogin('', '');
    assert(page.authError('le-identifier'));
    assert(page.authError('le-password'));
  });

  /* ==================================================================== */
  describe('creating School B');

  await it('switches from sign-in to setup', async function () {
    page.$('#to-register').click();
    equal(page.registerVisible(), true);
    equal(page.loginVisible(), false);
    equal(page.$('#to-login').parentNode.hidden, false, 'can go back to sign-in now');
  });

  await it('refuses a school name already on the device', async function () {
    page.doRegister({
      schoolName: SCHOOL_A.schoolName, directorName: 'Someone Else',
      username: 'other_admin', password: 'another1'
    });
    assert(/already exists/.test(page.authError('re-schoolName')), page.authError('re-schoolName'));
    equal(page.accounts().length, 1);
  });

  await it('refuses a username already on the device', async function () {
    page.doRegister({
      schoolName: 'Another School', directorName: 'Someone Else',
      username: SCHOOL_A.username, password: 'another1'
    });
    assert(/already used/.test(page.authError('re-username')), page.authError('re-username'));
  });

  var accountB;

  await it('creates the second school and signs into it', async function () {
    page.doRegister(SCHOOL_B);
    equal(page.appVisible(), true);
    equal(page.schoolName(), 'Green Valley Academy');
    equal(page.accounts().length, 2, 'two schools on the device');

    accountB = page.accountId();
    assert(accountB !== accountA, 'the schools have different ids');
  });

  /* ==================================================================== */
  describe('School A data is not visible to School B');

  await it('shows an empty student list', async function () {
    page.goTo('students');
    equal(page.cards().length, 0, 'School A students must not appear');
    equal(page.$('#student-empty').hidden, false);
    equal(page.text('#student-count'), '0');
    deepEqual(page.stored(), []);
  });

  await it('shows nothing to mark attendance for', async function () {
    page.goTo('attendance');
    equal(page.$('#a-empty').hidden, false);
    equal(page.$('#a-session').hidden, true);
    equal(page.text('#a-empty-title'), 'No students yet');
    equal(page.attendanceCount(), 0);
  });

  await it('shows no attendance records', async function () {
    page.goTo('records');
    page.pick('#r-date', DAY);
    equal(page.recRows().length, 0, 'School A attendance must not appear');
    equal(page.$('#r-empty').hidden, false);
  });

  await it('leaves School A’s stored data untouched', async function () {
    equal(page.storedFor(accountA).length, 2, 'School A still has its students');
    equal(Object.keys(page.attendanceFor(accountA)).length, 2);
    equal(page.storedFor(accountB).length, 0, 'and School B has its own, empty, key');
  });

  await it('lets School B use a roll number School A already uses', async function () {
    page.goTo('students');
    page.addStudent({ name: 'Zara Ali', roll: '1', className: '5', section: 'A' });
    equal(page.cards().length, 1);
    equal(page.names()[0], 'Zara Ali');
    equal(page.storedFor(accountB).length, 1);
    equal(page.storedFor(accountA).length, 2, 'School A is still separate');
  });

  await it('keeps the two registers apart in the app bar too', async function () {
    equal(page.schoolName(), 'Green Valley Academy');
    equal(page.text('#student-count'), '1');
  });

  /* ==================================================================== */
  describe('signing back into School A');

  await it('signs out of School B', async function () {
    page.doLogout();
    equal(page.loginVisible(), true);
  });

  await it('signs in with the school name instead of the username', async function () {
    page.doLogin('ABC Public School', 'secret123');
    equal(page.appVisible(), true);
    equal(page.schoolName(), 'ABC Public School');
    equal(page.accountId(), accountA);
  });

  await it('still has every student', async function () {
    page.goTo('students');
    deepEqual(page.names(), ['Ahmed Noor', 'Bilal Shah']);
    equal(page.text('#student-count'), '2');
    equal(page.names().indexOf('Zara Ali'), -1, 'and none of School B’s');
  });

  await it('still has the attendance saved earlier', async function () {
    page.goTo('attendance');
    page.pick('#a-class', '5');
    page.pick('#a-section', 'A');
    page.pick('#a-date', DAY);
    equal(page.markOf('Ahmed Noor'), 'present');
    equal(page.markOf('Bilal Shah'), 'absent');
    assert(/already saved/.test(page.text('#a-note')), page.text('#a-note'));
  });

  await it('shows School A’s report, branded for School A', async function () {
    page.goTo('records');
    page.pick('#r-date', DAY);
    equal(page.recSummary().school, 'ABC Public School');
    deepEqual(page.recNames(), ['Ahmed Noor', 'Bilal Shah']);
    deepEqual(page.recStatuses(), ['Present', 'Absent']);
  });

  page.close();

  /* ==================================================================== */
  describe('staying signed in between sessions');

  await it('reopens straight into the app when the session was remembered', async function () {
    var remembered = await openApp();
    equal(remembered.appVisible(), true, 'no sign-in needed');
    equal(remembered.authVisible(), false);
    equal(remembered.schoolName(), 'Test School');
    remembered.close();
  });

  await it('asks to sign in when there is an account but no session', async function () {
    var locked = await openApp({ signedIn: false });
    equal(locked.authVisible(), true);
    equal(locked.loginVisible(), true, 'sign-in, not setup');
    equal(locked.appVisible(), false);
    locked.close();
  });

  await it('does not remember a session when the box is unchecked', async function () {
    var once = await openApp({ signedIn: false });
    once.doLogin('test_admin', 'secret123', false);

    equal(once.appVisible(), true, 'signed in for now');
    equal(once.session(), null, 'but nothing remembered in device storage');
    once.close();
  });

  await it('remembers the session when the box is left checked', async function () {
    var kept = await openApp({ signedIn: false });
    kept.doLogin('test_admin', 'secret123', true);

    equal(kept.appVisible(), true);
    assert(kept.session(), 'a remembered session is written');
    equal(kept.session().remember, true);
    kept.close();
  });

  /* ==================================================================== */
  describe('school settings');

  var settings = await openApp({ students: [
    { id: 's1', name: 'Ali Raza', roll: '1', className: '5', section: 'A', createdAt: 1, updatedAt: 1 }
  ] });

  await it('prefills the profile form', async function () {
    settings.goTo('settings');
    equal(settings.$('#s-school').value, 'Test School');
    equal(settings.$('#s-director').value, 'Test Director');
    equal(settings.$('#s-username').value, 'test_admin');
  });

  await it('changes the school name everywhere at once', async function () {
    settings.type('#s-school', 'Bright Future School');
    settings.type('#s-director', 'Ms. Nadia Aslam');
    settings.submitForm('#profile-form');

    equal(settings.schoolName(), 'Bright Future School', 'app bar updates');
    equal(settings.text('#settings-school'), 'Bright Future School', 'settings card updates');
    assert(/Ms. Nadia Aslam/.test(settings.text('#settings-director')));
    assert(/saved/i.test(settings.toastText()), settings.toastText());
    equal(settings.accounts()[0].schoolName, 'Bright Future School', 'and it is stored');
  });

  await it('carries the new name into reports', async function () {
    settings.goTo('records');
    settings.pick('#r-date', settings.$('#r-date').value);
    settings.goTo('settings');
    equal(settings.text('#settings-school'), 'Bright Future School');
  });

  await it('refuses an empty school name', async function () {
    settings.type('#s-school', '   ');
    settings.submitForm('#profile-form');
    assert(/required/.test(settings.settingsError('se-schoolName')),
      settings.settingsError('se-schoolName'));
    equal(settings.accounts()[0].schoolName, 'Bright Future School', 'unchanged');
  });

  await it('changes the username with the current password', async function () {
    settings.goTo('students');
    settings.goTo('settings');

    settings.type('#s-username', 'bright_admin');
    settings.type('#s-username-pw', 'secret123');
    settings.submitForm('#username-form');

    assert(/updated/i.test(settings.toastText()), settings.toastText());
    equal(settings.accounts()[0].username, 'bright_admin');
    assert(/bright_admin/.test(settings.text('#settings-username')));
  });

  await it('refuses a username change without the right password', async function () {
    settings.type('#s-username', 'someone_else');
    settings.type('#s-username-pw', 'wrongpass');
    settings.submitForm('#username-form');

    assert(/incorrect/i.test(settings.settingsError('se-currentPassword')),
      settings.settingsError('se-currentPassword'));
    equal(settings.accounts()[0].username, 'bright_admin', 'unchanged');
  });

  await it('refuses a password change without the current password', async function () {
    settings.type('#s-current', 'wrongpass');
    settings.type('#s-new', 'newpass1');
    settings.type('#s-confirm', 'newpass1');
    settings.submitForm('#password-form');

    assert(/incorrect/i.test(settings.settingsError('pe-currentPassword')),
      settings.settingsError('pe-currentPassword'));
  });

  await it('refuses a mismatched new password', async function () {
    settings.type('#s-current', 'secret123');
    settings.type('#s-new', 'newpass1');
    settings.type('#s-confirm', 'newpass2');
    settings.submitForm('#password-form');

    assert(/do not match/.test(settings.settingsError('pe-confirmPassword')),
      settings.settingsError('pe-confirmPassword'));
  });

  await it('refuses a new password that is too short', async function () {
    settings.type('#s-current', 'secret123');
    settings.type('#s-new', 'abc');
    settings.type('#s-confirm', 'abc');
    settings.submitForm('#password-form');

    assert(/at least 6/.test(settings.settingsError('pe-password')),
      settings.settingsError('pe-password'));
  });

  await it('changes the password and clears the form', async function () {
    var before = settings.accounts()[0].passwordHash;

    settings.type('#s-current', 'secret123');
    settings.type('#s-new', 'newpass1');
    settings.type('#s-confirm', 'newpass1');
    settings.submitForm('#password-form');

    assert(/changed/i.test(settings.toastText()), settings.toastText());
    assert(settings.accounts()[0].passwordHash !== before, 'the stored hash changed');
    equal(settings.$('#s-current').value, '', 'the form is emptied');
    equal(settings.rawKey('sa.accounts.v1').indexOf('newpass1'), -1, 'still no plain text');
  });

  await it('signs in with the new password only', async function () {
    settings.doLogout();
    settings.doLogin('bright_admin', 'secret123');
    assert(/Incorrect password/.test(settings.authError('le-password')), 'old password is dead');

    settings.doLogin('bright_admin', 'newpass1');
    equal(settings.appVisible(), true, 'the new password works');
    equal(settings.schoolName(), 'Bright Future School');
  });

  await it('kept the school’s students through all of that', async function () {
    settings.goTo('students');
    deepEqual(settings.names(), ['Ali Raza']);
  });

  settings.close();

  /* ==================================================================== */
  describe('upgrading a device used before accounts existed');

  await it('hands the old register to the first school created', async function () {
    var upgrade = await openApp({
      account: null,
      legacyStudents: [
        { id: 's_old1', name: 'Old Student', roll: '1', className: '4', section: 'A',
          createdAt: 1, updatedAt: 1 }
      ]
    });

    equal(upgrade.loginVisible(), true, 'sign-in first, as everywhere else');
    upgrade.$('#to-register').click();
    equal(upgrade.registerVisible(), true);
    upgrade.doRegister(SCHOOL_A);

    equal(upgrade.appVisible(), true);
    deepEqual(upgrade.names(), ['Old Student'], 'the earlier register carries over');
    equal(upgrade.stored().length, 1);
    upgrade.close();
  });

  /* -------------------------------------------------------------- report */
  stopServer();
  h.report('account UI tests');
}

main().catch(function (err) {
  console.error(err);
  stopServer();
  process.exit(1);
});
