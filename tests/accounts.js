/* Unit tests for school accounts, sign-in, and data isolation between
   schools sharing one device: `npm run test:accounts`. */

'use strict';

var h = require('./harness');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;
var makeStorage = h.makeStorage, loadDB = h.loadDB, seed = h.seed, quiet = h.quiet;

var SCHOOL_A = {
  schoolName: 'ABC Public School',
  directorName: 'Mr. Imran Khan',
  username: 'abc_admin',
  password: 'secret123',
  confirmPassword: 'secret123'
};

var SCHOOL_B = {
  schoolName: 'Green Valley Academy',
  directorName: 'Mrs. Sara Ahmed',
  username: 'green_admin',
  password: 'valley456',
  confirmPassword: 'valley456'
};

var PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function blank() {
  return loadDB(makeStorage());
}

function signIn(db, school) {
  var registered = db.Auth.register(school);
  assert(registered.ok, JSON.stringify(registered.errors));
  var session = db.Auth.login(school.username, school.password, true);
  assert(session.ok, JSON.stringify(session.errors));
  return session.account;
}

/* ============================== registration ============================== */

describe('registration', function () {
  it('starts with no accounts and nobody signed in', function () {
    var db = blank();
    equal(db.Auth.hasAccounts(), false);
    equal(db.Auth.isSignedIn(), false);
    equal(db.Auth.current(), null);
    deepEqual(db.Auth.accounts(), []);
  });

  it('requires every field', function () {
    var db = blank();
    var result = db.Auth.register({});
    equal(result.ok, false);
    assert(result.errors.schoolName, 'school name');
    assert(result.errors.directorName, 'director name');
    assert(result.errors.username, 'username');
    assert(result.errors.password, 'password');
    assert(result.errors.confirmPassword, 'confirm');
    equal(db.Auth.hasAccounts(), false, 'nothing stored');
  });

  it('rejects a short school or director name', function () {
    var db = blank();
    var result = db.Auth.register({
      schoolName: 'A', directorName: 'B',
      username: 'someone', password: 'secret123', confirmPassword: 'secret123'
    });
    equal(result.ok, false);
    assert(/at least 2/.test(result.errors.schoolName));
    assert(/at least 2/.test(result.errors.directorName));
  });

  it('rejects a badly formed username', function () {
    var db = blank();
    ['ab', 'has space', 'way_too_long_username_here_x', 'bad!chars'].forEach(function (username) {
      var result = db.Auth.register({
        schoolName: 'Some School', directorName: 'Some Director',
        username: username, password: 'secret123', confirmPassword: 'secret123'
      });
      equal(result.ok, false, 'should reject "' + username + '"');
      assert(result.errors.username, 'username error for "' + username + '"');
    });
  });

  it('accepts letters, digits, dot, dash and underscore', function () {
    var db = blank();
    var result = db.Auth.register({
      schoolName: 'Some School', directorName: 'Some Director',
      username: 'a.b-c_1', password: 'secret123', confirmPassword: 'secret123'
    });
    assert(result.ok, JSON.stringify(result.errors));
  });

  it('rejects a short password', function () {
    var db = blank();
    var result = db.Auth.register({
      schoolName: 'Some School', directorName: 'Some Director',
      username: 'someone', password: 'abc', confirmPassword: 'abc'
    });
    equal(result.ok, false);
    assert(/at least 6/.test(result.errors.password), result.errors.password);
  });

  it('rejects a mismatched confirmation', function () {
    var db = blank();
    var result = db.Auth.register({
      schoolName: 'Some School', directorName: 'Some Director',
      username: 'someone', password: 'secret123', confirmPassword: 'secret124'
    });
    equal(result.ok, false);
    assert(/do not match/.test(result.errors.confirmPassword), result.errors.confirmPassword);
  });

  it('creates the account and normalises the text', function () {
    var db = blank();
    var result = db.Auth.register({
      schoolName: '  ABC   Public School ', directorName: ' Mr.  Imran Khan ',
      username: 'abc_admin', password: 'secret123', confirmPassword: 'secret123'
    });
    assert(result.ok, JSON.stringify(result.errors));
    equal(result.account.schoolName, 'ABC Public School');
    equal(result.account.directorName, 'Mr. Imran Khan');
    equal(db.Auth.hasAccounts(), true);
  });

  it('does not sign the new school in by itself', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    equal(db.Auth.isSignedIn(), false, 'registering is not signing in');
  });

  it('never exposes the password, hash or salt', function () {
    var db = blank();
    var account = db.Auth.register(SCHOOL_A).account;
    equal(account.password, undefined);
    equal(account.passwordHash, undefined);
    equal(account.salt, undefined);
    deepEqual(Object.keys(db.Auth.accounts()[0]).sort(),
      ['createdAt', 'directorName', 'id', 'logo', 'schoolName', 'updatedAt', 'username']);
  });

  it('does not store the password as plain text', function () {
    var storage = makeStorage();
    var db = loadDB(storage);
    db.Auth.register(SCHOOL_A);

    var raw = storage._data['sa.accounts.v1'];
    assert(raw, 'accounts should be stored');
    equal(raw.indexOf('secret123'), -1, 'the password must not appear anywhere');

    var stored = JSON.parse(raw)[0];
    equal(stored.passwordHash.length, 64, 'a SHA-256 hex digest');
    assert(stored.salt, 'a salt is stored alongside');
    assert(stored.iterations > 1000, 'the hash is stretched');
  });

  it('gives two schools different salts and hashes for the same password', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    db.Auth.register({
      schoolName: 'Second School', directorName: 'Someone Else',
      username: 'second_admin', password: SCHOOL_A.password, confirmPassword: SCHOOL_A.password
    });

    var rows = JSON.parse(globalThis.localStorage.getItem('sa.accounts.v1'));
    assert(rows[0].salt !== rows[1].salt, 'salts differ');
    assert(rows[0].passwordHash !== rows[1].passwordHash, 'so the hashes differ too');
  });
});

describe('duplicate accounts', function () {
  it('refuses a username already on the device', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    var again = db.Auth.register({
      schoolName: 'Another School', directorName: 'Another Director',
      username: 'ABC_ADMIN', password: 'secret123', confirmPassword: 'secret123'
    });
    equal(again.ok, false);
    assert(/already used/.test(again.errors.username), again.errors.username);
    equal(db.Auth.accounts().length, 1);
  });

  it('refuses a school name already on the device', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    var again = db.Auth.register({
      schoolName: 'abc public school', directorName: 'Another Director',
      username: 'other_admin', password: 'secret123', confirmPassword: 'secret123'
    });
    equal(again.ok, false);
    assert(/already exists/.test(again.errors.schoolName), again.errors.schoolName);
  });

  it('allows a second, distinct school', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    assert(db.Auth.register(SCHOOL_B).ok);
    equal(db.Auth.accounts().length, 2);
  });
});

/* ================================== login ================================= */

describe('login', function () {
  it('signs in with the username', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    var result = db.Auth.login('abc_admin', 'secret123', true);
    assert(result.ok, JSON.stringify(result.errors));
    equal(db.Auth.isSignedIn(), true);
    equal(db.Auth.current().schoolName, 'ABC Public School');
  });

  it('signs in with the school name', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    assert(db.Auth.login('ABC Public School', 'secret123', true).ok);
  });

  it('ignores case and surrounding spaces in the identifier', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    assert(db.Auth.login('  ABC_ADMIN  ', 'secret123', true).ok);
    assert(db.Auth.login('abc public school', 'secret123', true).ok);
  });

  it('rejects the wrong password', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    var result = db.Auth.login('abc_admin', 'Secret123', true);
    equal(result.ok, false);
    assert(/Incorrect password/.test(result.errors.password));
    equal(db.Auth.isSignedIn(), false, 'a failed attempt creates no session');
  });

  it('rejects an unknown school', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    var result = db.Auth.login('nobody', 'secret123', true);
    equal(result.ok, false);
    assert(/No account found/.test(result.errors.identifier));
  });

  it('asks for both fields', function () {
    var db = blank();
    db.Auth.register(SCHOOL_A);
    var result = db.Auth.login('', '', true);
    equal(result.ok, false);
    assert(result.errors.identifier);
    assert(result.errors.password);
  });

  it('signs out on request', function () {
    var db = blank();
    signIn(db, SCHOOL_A);
    equal(db.Auth.isSignedIn(), true);
    db.Auth.logout();
    equal(db.Auth.isSignedIn(), false);
    equal(db.Auth.current(), null);
  });
});

describe('staying signed in', function () {
  it('remembers the session across a restart when asked', function () {
    var storage = makeStorage();
    var db = loadDB(storage);
    db.Auth.register(SCHOOL_A);
    db.Auth.login('abc_admin', 'secret123', true);

    var reopened = loadDB(storage); // new sessionStorage, as when the app closes
    equal(reopened.Auth.isSignedIn(), true, 'a remembered session survives');
    equal(reopened.Auth.current().username, 'abc_admin');
  });

  it('forgets the session across a restart when not asked', function () {
    var storage = makeStorage();
    var db = loadDB(storage);
    db.Auth.register(SCHOOL_A);
    db.Auth.login('abc_admin', 'secret123', false);
    equal(db.Auth.isSignedIn(), true, 'signed in for this run');

    var reopened = loadDB(storage);
    equal(reopened.Auth.isSignedIn(), false, 'but not after the app closes');
    equal(reopened.Auth.hasAccounts(), true, 'the account itself is still there');
  });

  it('stays signed out after an explicit logout', function () {
    var storage = makeStorage();
    var db = loadDB(storage);
    signIn(db, SCHOOL_A);
    db.Auth.logout();

    equal(loadDB(storage).Auth.isSignedIn(), false);
  });

  it('ignores a session pointing at an account that is gone', function () {
    var storage = makeStorage();
    var db = loadDB(storage);
    signIn(db, SCHOOL_A);

    storage._data['sa.accounts.v1'] = JSON.stringify([]);
    var reopened = loadDB(storage);
    equal(reopened.Auth.isSignedIn(), false);
    equal(reopened.Auth.current(), null);
  });

  it('ignores a damaged session entry', function () {
    var storage = makeStorage();
    var db = loadDB(storage);
    signIn(db, SCHOOL_A);
    storage._data['sa.session.v1'] = 'not json';

    equal(loadDB(storage).Auth.isSignedIn(), false);
  });
});

/* ============================= data isolation ============================= */

describe('data isolation between schools', function () {
  /* Build one device holding two schools, each with its own students and
     attendance, and return the ids needed to check them apart. */
  function device() {
    var storage = makeStorage();
    var db = loadDB(storage);

    var a = signIn(db, SCHOOL_A);
    var aStudents = seed(db.Students, [
      { name: 'Ahmed Noor', roll: '1', className: '5', section: 'A' },
      { name: 'Bilal Shah', roll: '2', className: '5', section: 'A' }
    ]);
    var aMarks = {};
    aMarks[aStudents[0].id] = 'present';
    aMarks[aStudents[1].id] = 'absent';
    assert(db.Attendance.saveSession('2026-09-04', '5', 'A', aMarks).ok);
    db.Auth.logout();

    var b = signIn(db, SCHOOL_B);
    var bStudents = seed(db.Students, [
      { name: 'Zara Ali', roll: '1', className: '5', section: 'A' }
    ]);
    var bMarks = {};
    bMarks[bStudents[0].id] = 'leave';
    assert(db.Attendance.saveSession('2026-09-04', '5', 'A', bMarks).ok);

    return { storage: storage, db: db, a: a, b: b, aStudents: aStudents, bStudents: bStudents };
  }

  it('shows School B only its own students', function () {
    var d = device();
    deepEqual(d.db.Students.all().map(function (s) { return s.name; }), ['Zara Ali']);
  });

  it('shows School B only its own attendance', function () {
    var d = device();
    equal(d.db.Attendance.count(), 1);
    deepEqual(d.db.Attendance.records({}).map(function (r) { return r.name + ':' + r.status; }),
      ['Zara Ali:leave']);
  });

  it('gives School A back its own data on sign-in', function () {
    var d = device();
    d.db.Auth.logout();
    assert(d.db.Auth.login(SCHOOL_A.username, SCHOOL_A.password, true).ok);

    deepEqual(d.db.Students.all().map(function (s) { return s.name; }),
      ['Ahmed Noor', 'Bilal Shah']);
    equal(d.db.Attendance.count(), 2);
    deepEqual(d.db.Attendance.records({ date: '2026-09-04' }).map(function (r) { return r.name; }),
      ['Ahmed Noor', 'Bilal Shah']);
  });

  it('files each school under its own storage keys', function () {
    var d = device();
    var keys = Object.keys(d.storage._data).sort();

    assert(keys.indexOf('sa.' + d.a.id + '.students.v1') !== -1, 'School A students key');
    assert(keys.indexOf('sa.' + d.b.id + '.students.v1') !== -1, 'School B students key');
    assert(keys.indexOf('sa.' + d.a.id + '.attendance.v1') !== -1, 'School A attendance key');
    assert(keys.indexOf('sa.' + d.b.id + '.attendance.v1') !== -1, 'School B attendance key');
    assert(d.a.id !== d.b.id, 'the two schools have different ids');
  });

  it('keeps a roll number free in the other school', function () {
    var d = device();
    // Roll 1 in 5-A exists in School A; School B must not be blocked by it.
    var result = d.db.Students.create({ name: 'New Pupil', roll: '2', className: '5', section: 'A' });
    assert(result.ok, JSON.stringify(result.errors));
    equal(d.db.Students.all().length, 2);
  });

  it('survives a restart with both schools intact', function () {
    var d = device();
    var reopened = loadDB(d.storage);

    equal(reopened.Auth.current().username, SCHOOL_B.username, 'still School B');
    equal(reopened.Students.all().length, 1);

    reopened.Auth.logout();
    assert(reopened.Auth.login(SCHOOL_A.username, SCHOOL_A.password, true).ok);
    equal(reopened.Students.all().length, 2, 'School A is untouched');
    equal(reopened.Attendance.count(), 2);
  });

  it('does not leak one school’s students into the other’s roster', function () {
    var d = device();
    deepEqual(d.db.Students.roster('5', 'A').map(function (s) { return s.name; }), ['Zara Ali']);
    deepEqual(d.db.Attendance.sessionMarks('2026-09-04', '5', 'A'),
      (function () { var m = {}; m[d.bStudents[0].id] = 'leave'; return m; }()));
  });
});

/* ============================== school profile ============================ */

describe('editing the school profile', function () {
  function signedIn() {
    var db = blank();
    signIn(db, SCHOOL_A);
    return db;
  }

  it('changes the school and director name', function () {
    var db = signedIn();
    var result = db.Auth.updateProfile({
      schoolName: 'ABC Model School', directorName: 'Mr. Imran A. Khan'
    });
    assert(result.ok, JSON.stringify(result.errors));
    equal(db.Auth.current().schoolName, 'ABC Model School');
    equal(db.Auth.current().directorName, 'Mr. Imran A. Khan');
    equal(db.Auth.current().username, 'abc_admin', 'the username is untouched');
  });

  it('lets a school keep its own name', function () {
    var db = signedIn();
    assert(db.Auth.updateProfile({
      schoolName: SCHOOL_A.schoolName, directorName: SCHOOL_A.directorName
    }).ok, 'a school should not clash with itself');
  });

  it('refuses a name another school already uses', function () {
    var db = blank();
    signIn(db, SCHOOL_A);
    db.Auth.logout();
    signIn(db, SCHOOL_B);

    var result = db.Auth.updateProfile({
      schoolName: SCHOOL_A.schoolName, directorName: SCHOOL_B.directorName
    });
    equal(result.ok, false);
    assert(/already exists/.test(result.errors.schoolName));
  });

  it('refuses empty names', function () {
    var db = signedIn();
    var result = db.Auth.updateProfile({ schoolName: '  ', directorName: '' });
    equal(result.ok, false);
    assert(result.errors.schoolName);
    assert(result.errors.directorName);
    equal(db.Auth.current().schoolName, 'ABC Public School', 'nothing changed');
  });

  it('changes the username with the correct password', function () {
    var db = signedIn();
    var result = db.Auth.changeUsername({ username: 'abc_office', currentPassword: 'secret123' });
    assert(result.ok, JSON.stringify(result.errors));
    equal(db.Auth.current().username, 'abc_office');

    db.Auth.logout();
    assert(db.Auth.login('abc_office', 'secret123', true).ok, 'the new username works');
    equal(db.Auth.login('abc_admin', 'secret123', true).ok, false, 'the old one does not');
  });

  it('refuses a username change without the password', function () {
    var db = signedIn();
    var result = db.Auth.changeUsername({ username: 'abc_office', currentPassword: 'wrong' });
    equal(result.ok, false);
    assert(/incorrect/i.test(result.errors.currentPassword));
    equal(db.Auth.current().username, 'abc_admin');
  });

  it('refuses a username another school holds', function () {
    var db = blank();
    signIn(db, SCHOOL_A);
    db.Auth.logout();
    signIn(db, SCHOOL_B);

    var result = db.Auth.changeUsername({
      username: SCHOOL_A.username, currentPassword: SCHOOL_B.password
    });
    equal(result.ok, false);
    assert(/already used/.test(result.errors.username));
  });

  it('stores and clears a logo', function () {
    var db = signedIn();
    assert(db.Auth.setLogo(PIXEL).ok);
    equal(db.Auth.current().logo, PIXEL);

    assert(db.Auth.setLogo('').ok);
    equal(db.Auth.current().logo, '');
  });

  it('refuses something that is not an image data URL', function () {
    var db = signedIn();
    var result = db.Auth.setLogo('javascript:alert(1)');
    equal(result.ok, false);
    assert(result.errors.logo);
    equal(db.Auth.current().logo, '');
  });

  it('refuses an oversized logo', function () {
    var db = signedIn();
    var huge = 'data:image/png;base64,' + new Array(400002).join('A');
    equal(db.Auth.setLogo(huge).ok, false);
  });

  it('refuses profile edits while signed out', function () {
    var db = signedIn();
    db.Auth.logout();
    equal(db.Auth.updateProfile({ schoolName: 'X School', directorName: 'Y' }).ok, false);
    equal(db.Auth.changeUsername({ username: 'zzz', currentPassword: 'secret123' }).ok, false);
    equal(db.Auth.setLogo(PIXEL).ok, false);
  });
});

describe('changing the password', function () {
  function signedIn() {
    var db = blank();
    signIn(db, SCHOOL_A);
    return db;
  }

  it('needs the current password', function () {
    var db = signedIn();
    var result = db.Auth.changePassword({
      currentPassword: 'wrong', password: 'newpass1', confirmPassword: 'newpass1'
    });
    equal(result.ok, false);
    assert(/incorrect/i.test(result.errors.currentPassword));
  });

  it('needs the confirmation to match', function () {
    var db = signedIn();
    var result = db.Auth.changePassword({
      currentPassword: 'secret123', password: 'newpass1', confirmPassword: 'newpass2'
    });
    equal(result.ok, false);
    assert(/do not match/.test(result.errors.confirmPassword));
  });

  it('enforces the minimum length', function () {
    var db = signedIn();
    var result = db.Auth.changePassword({
      currentPassword: 'secret123', password: 'abc', confirmPassword: 'abc'
    });
    equal(result.ok, false);
    assert(/at least 6/.test(result.errors.password));
  });

  it('refuses reusing the current password', function () {
    var db = signedIn();
    var result = db.Auth.changePassword({
      currentPassword: 'secret123', password: 'secret123', confirmPassword: 'secret123'
    });
    equal(result.ok, false);
    assert(/different/.test(result.errors.password), result.errors.password);
  });

  it('changes the password and re-salts the hash', function () {
    var storage = makeStorage();
    var db = loadDB(storage);
    signIn(db, SCHOOL_A);

    var before = JSON.parse(storage._data['sa.accounts.v1'])[0];
    assert(db.Auth.changePassword({
      currentPassword: 'secret123', password: 'newpass1', confirmPassword: 'newpass1'
    }).ok);
    var after = JSON.parse(storage._data['sa.accounts.v1'])[0];

    assert(before.salt !== after.salt, 'a new salt is generated');
    assert(before.passwordHash !== after.passwordHash);
    equal(storage._data['sa.accounts.v1'].indexOf('newpass1'), -1, 'still no plain text');
  });

  it('signs in with the new password only', function () {
    var db = signedIn();
    db.Auth.changePassword({
      currentPassword: 'secret123', password: 'newpass1', confirmPassword: 'newpass1'
    });
    db.Auth.logout();

    equal(db.Auth.login('abc_admin', 'secret123', true).ok, false, 'the old password is dead');
    assert(db.Auth.login('abc_admin', 'newpass1', true).ok, 'the new one works');
  });

  it('keeps the school’s data through a password change', function () {
    var db = signedIn();
    seed(db.Students, [{ name: 'Ali Raza', roll: '1', className: '5', section: 'A' }]);

    db.Auth.changePassword({
      currentPassword: 'secret123', password: 'newpass1', confirmPassword: 'newpass1'
    });
    db.Auth.logout();
    db.Auth.login('abc_admin', 'newpass1', true);

    equal(db.Students.all().length, 1);
  });

  it('checks a password without signing anyone in', function () {
    var db = signedIn();
    equal(db.Auth.checkPassword('secret123'), true);
    equal(db.Auth.checkPassword('nope'), false);
  });
});

/* ========================= upgrading an older device ====================== */

describe('data written before school accounts existed', function () {
  function legacyStorage() {
    return makeStorage({
      data: {
        'sa.students.v1': JSON.stringify([
          { id: 's_old1', name: 'Ali Raza', roll: '1', className: '5', section: 'A',
            createdAt: 1, updatedAt: 1 }
        ]),
        'sa.attendance.v1': JSON.stringify({
          's_old1|2026-09-04': {
            studentId: 's_old1', date: '2026-09-04', status: 'present',
            className: '5', section: 'A', markedAt: 1
          }
        })
      }
    });
  }

  it('is adopted by the first school registered', function () {
    var storage = legacyStorage();
    var db = loadDB(storage);
    signIn(db, SCHOOL_A);

    equal(db.Students.all().length, 1, 'the old register carries over');
    equal(db.Students.all()[0].name, 'Ali Raza');
    equal(db.Attendance.count(), 1, 'and the old attendance with it');
  });

  it('leaves the original entries in place rather than destroying them', function () {
    var storage = legacyStorage();
    var db = loadDB(storage);
    signIn(db, SCHOOL_A);
    assert(storage._data['sa.students.v1'], 'the old key is copied, not moved');
  });

  it('is not handed to a second school', function () {
    var storage = legacyStorage();
    var db = loadDB(storage);
    signIn(db, SCHOOL_A);
    db.Auth.logout();
    signIn(db, SCHOOL_B);

    deepEqual(db.Students.all(), [], 'School B starts empty');
    equal(db.Attendance.count(), 0);
  });

  it('does not overwrite a school that already has data', function () {
    var storage = makeStorage();
    var db = loadDB(storage);
    signIn(db, SCHOOL_A);
    seed(db.Students, [{ name: 'Own Student', roll: '9', className: '9', section: 'Z' }]);

    // Legacy keys appear afterwards; the school's own data must win.
    storage._data['sa.students.v1'] = JSON.stringify([
      { id: 's_old1', name: 'Ali Raza', roll: '1', className: '5', section: 'A' }
    ]);
    db.Auth.logout();
    db.Auth.login(SCHOOL_A.username, SCHOOL_A.password, true);

    deepEqual(db.Students.all().map(function (s) { return s.name; }), ['Own Student']);
  });

  it('ignores unusable legacy entries', function () {
    quiet(function () {
      var storage = makeStorage({ data: { 'sa.students.v1': '{broken', 'sa.attendance.v1': '[]' } });
      var db = loadDB(storage);
      signIn(db, SCHOOL_A);
      deepEqual(db.Students.all(), []);
      equal(db.Attendance.count(), 0);
    });
  });
});

/* ================================ hashing ================================= */

describe('password hashing', function () {
  var Crypto = globalThis.SchoolCrypto;

  it('matches the SHA-256 test vectors', function () {
    equal(Crypto.sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    equal(Crypto.sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    equal(Crypto.sha256Hex('The quick brown fox jumps over the lazy dog'),
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  });

  it('handles non-ASCII passwords', function () {
    var digest = Crypto.sha256Hex('پاسورڈ 密码 🏫');
    equal(digest.length, 64);
    equal(digest, Crypto.sha256Hex('پاسورڈ 密码 🏫'), 'and is stable');
  });

  it('is deterministic for a salt and password, and differs by salt', function () {
    equal(Crypto.hashPassword('secret123', 'aaaa', 200),
          Crypto.hashPassword('secret123', 'aaaa', 200));
    assert(Crypto.hashPassword('secret123', 'aaaa', 200) !==
           Crypto.hashPassword('secret123', 'bbbb', 200), 'the salt changes the result');
    assert(Crypto.hashPassword('secret123', 'aaaa', 200) !==
           Crypto.hashPassword('secret124', 'aaaa', 200), 'so does the password');
  });

  it('produces a different digest for a different iteration count', function () {
    assert(Crypto.hashPassword('secret123', 'aaaa', 100) !==
           Crypto.hashPassword('secret123', 'aaaa', 200));
  });

  it('compares digests without leaking length differences', function () {
    equal(Crypto.safeEqual('abc', 'abc'), true);
    equal(Crypto.safeEqual('abc', 'abd'), false);
    equal(Crypto.safeEqual('abc', 'abcd'), false);
  });

  it('generates a distinct salt each time', function () {
    var seen = {};
    for (var i = 0; i < 50; i++) {
      var salt = Crypto.randomSalt();
      equal(salt.length, 32, 'sixteen bytes as hex');
      equal(seen[salt], undefined, 'salts should not repeat');
      seen[salt] = true;
    }
  });
});

h.report('account tests');
