/* Unit tests for the storage + student model layer (js/db.js).
   Runs on plain Node with a localStorage stand-in: `npm test`. */

'use strict';

var h = require('./harness');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;
var makeStorage = h.makeStorage, loadDB = h.loadDB, freshDB = h.freshDB;
var signedInDB = h.signedInDB, keysOf = h.keysOf;
var seed = h.seed, quiet = h.quiet;

/* ================================== tests ================================= */

describe('storage layer', function () {
  it('reports localStorage as available', function () {
    equal(freshDB().isPersistent(), true);
  });

  it('falls back to memory when localStorage is blocked', function () {
    var db = signedInDB(makeStorage({ throwOnWrite: true }));
    equal(db.isPersistent(), false, 'should report non-persistent');
    var result = db.Students.create({ name: 'Sara', roll: '1', className: '1', section: 'A' });
    assert(result.ok, 'create should still succeed in memory mode');
    equal(db.Students.all().length, 1, 'row readable from memory fallback');
  });

  it('survives a corrupted students entry instead of throwing', function () {
    quiet(function () {
      var storage = makeStorage();
      var db = signedInDB(storage);
      storage._data[keysOf(db).students] = '{not json';

      db = loadDB(storage); // reopen with the damaged row in place
      deepEqual(db.Students.all(), [], 'should read as empty');
      assert(db.Students.create({ name: 'Zia', roll: '1', className: '1', section: 'A' }).ok);
      equal(db.Students.all().length, 1);
    });
  });

  it('ignores malformed rows inside the array', function () {
    var storage = makeStorage();
    var db = signedInDB(storage);
    storage._data[keysOf(db).students] = JSON.stringify([
      null, 42, { name: 'no id' },
      { id: 'x', name: 'Ali', roll: '3', className: '2', section: 'B' }
    ]);

    db = loadDB(storage);
    equal(db.Students.all().length, 1);
    equal(db.Students.all()[0].name, 'Ali');
  });

  it('shows nothing at all while signed out', function () {
    var storage = makeStorage();
    var db = signedInDB(storage);
    seed(db.Students, [{ name: 'Ali Raza', roll: '1', className: '5', section: 'A' }]);
    equal(db.Students.all().length, 1);

    db.Auth.logout();
    deepEqual(db.Students.all(), [], 'signed out means no rows');
    equal(db.Students.create({ name: 'Nobody', roll: '9', className: '9', section: 'Z' }).ok, true,
      'the model still validates');
    deepEqual(db.Students.all(), [], 'but nothing is stored without an account');
  });
});

describe('validation', function () {
  it('requires every field', function () {
    var db = freshDB();
    var check = db.Students.validate({ name: '', roll: '', className: '', section: '' });
    equal(check.valid, false);
    assert(check.errors.name, 'name error expected');
    assert(check.errors.roll, 'roll error expected');
    assert(check.errors.className, 'class error expected');
    assert(check.errors.section, 'section error expected');
  });

  it('rejects whitespace-only input', function () {
    var db = freshDB();
    var result = db.Students.create({ name: '   ', roll: '  ', className: ' ', section: ' ' });
    equal(result.ok, false);
    equal(db.Students.all().length, 0, 'nothing should be stored');
  });

  it('rejects a one-character name', function () {
    var db = freshDB();
    var check = db.Students.validate({ name: 'A', roll: '1', className: '1', section: 'A' });
    equal(check.valid, false);
    assert(/at least 2/.test(check.errors.name));
  });

  it('accepts a valid student', function () {
    var db = freshDB();
    var check = db.Students.validate({ name: 'Ayesha Khan', roll: '12', className: '5', section: 'a' });
    equal(check.valid, true);
    deepEqual(check.errors, {});
    equal(check.values.section, 'A', 'section normalised to uppercase');
  });
});

describe('father name', function () {
  it('is stored and read back', function () {
    var db = freshDB();
    var student = db.Students.create({
      name: 'Ayesha Khan', fatherName: 'Imran Khan',
      roll: '12', className: '5', section: 'A'
    }).student;
    equal(student.fatherName, 'Imran Khan');
    equal(db.Students.byId(student.id).fatherName, 'Imran Khan');
  });

  it('is optional', function () {
    var db = freshDB();
    var result = db.Students.create({ name: 'Ali Raza', roll: '1', className: '5', section: 'A' });
    assert(result.ok, JSON.stringify(result.errors));
    equal(result.student.fatherName, '', 'absent becomes an empty string, not undefined');
  });

  it('collapses whitespace like the student name', function () {
    var db = freshDB();
    var student = db.Students.create({
      name: 'Ali Raza', fatherName: '  Imran   Khan ',
      roll: '1', className: '5', section: 'A'
    }).student;
    equal(student.fatherName, 'Imran Khan');
  });

  it('rejects a single stray character', function () {
    var db = freshDB();
    var check = db.Students.validate({
      name: 'Ali Raza', fatherName: 'X', roll: '1', className: '5', section: 'A'
    });
    equal(check.valid, false);
    assert(/at least 2/.test(check.errors.fatherName), check.errors.fatherName);
  });

  it('survives an edit that does not touch it', function () {
    var db = freshDB();
    var student = db.Students.create({
      name: 'Ali Raza', fatherName: 'Imran Khan',
      roll: '1', className: '5', section: 'A'
    }).student;

    var result = db.Students.update(student.id, {
      name: 'Ali Raza Khan', fatherName: 'Imran Khan',
      roll: '2', className: '6', section: 'B'
    });
    assert(result.ok, JSON.stringify(result.errors));
    equal(db.Students.byId(student.id).fatherName, 'Imran Khan');
  });

  it('can be changed and cleared', function () {
    var db = freshDB();
    var student = db.Students.create({
      name: 'Ali Raza', fatherName: 'Imran Khan',
      roll: '1', className: '5', section: 'A'
    }).student;

    db.Students.update(student.id, {
      name: 'Ali Raza', fatherName: 'Imran A. Khan',
      roll: '1', className: '5', section: 'A'
    });
    equal(db.Students.byId(student.id).fatherName, 'Imran A. Khan');

    db.Students.update(student.id, {
      name: 'Ali Raza', fatherName: '', roll: '1', className: '5', section: 'A'
    });
    equal(db.Students.byId(student.id).fatherName, '');
  });

  it('survives closing and reopening the app', function () {
    var storage = makeStorage();
    var db = signedInDB(storage);
    seed(db.Students, [
      { name: 'Ayesha Khan', fatherName: 'Imran Khan', roll: '1', className: '5', section: 'A' }
    ]);

    var reopened = loadDB(storage);
    equal(reopened.Students.all()[0].fatherName, 'Imran Khan');
  });

  it('defaults to empty for students saved before the field existed', function () {
    var storage = makeStorage();
    var db = signedInDB(storage);
    storage._data[keysOf(db).students] = JSON.stringify([
      { id: 's_old', name: 'Old Student', roll: '1', className: '5', section: 'A',
        createdAt: 1, updatedAt: 1 }
    ]);

    var reopened = loadDB(storage);
    var student = reopened.Students.all()[0];
    equal(student.fatherName, '', 'no undefined leaks out');
    assert(reopened.Students.update(student.id, {
      name: 'Old Student', fatherName: 'New Father', roll: '1', className: '5', section: 'A'
    }).ok, 'and it can be filled in later');
    equal(reopened.Students.byId('s_old').fatherName, 'New Father');
  });

  it('is searchable', function () {
    var db = freshDB();
    seed(db.Students, [
      { name: 'Ali Raza', fatherName: 'Imran Khan', roll: '1', className: '5', section: 'A' },
      { name: 'Hina Malik', fatherName: 'Tariq Malik', roll: '2', className: '5', section: 'A' }
    ]);
    var rows = db.Students.all();
    equal(db.Students.search(rows, 'imran').length, 1);
    equal(db.Students.search(rows, 'IMRAN').length, 1, 'case-insensitive');
    equal(db.Students.search(rows, 'malik').length, 1, 'matches both name and father name');
  });
});

describe('normalisation', function () {
  it('collapses whitespace and uppercases the section', function () {
    var db = freshDB();
    var student = db.Students.create({
      name: '  Ayesha   Khan ', roll: ' 12 ', className: ' 5 ', section: ' b '
    }).student;
    equal(student.name, 'Ayesha Khan');
    equal(student.roll, '12');
    equal(student.className, '5');
    equal(student.section, 'B');
  });

  it('treats differently-cased sections as one group', function () {
    var db = freshDB();
    seed(db.Students, [{ name: 'One Student', roll: '1', className: '5', section: 'a' }]);
    var second = db.Students.create({ name: 'Two Student', roll: '1', className: '5', section: 'A' });
    equal(second.ok, false, 'same roll in the same section must be rejected');
  });
});

describe('duplicate roll numbers', function () {
  it('blocks a duplicate roll inside the same class and section', function () {
    var db = freshDB();
    seed(db.Students, [{ name: 'Ali Raza', roll: '7', className: '5', section: 'A' }]);
    var dupe = db.Students.create({ name: 'Bilal Ahmed', roll: '7', className: '5', section: 'A' });
    equal(dupe.ok, false);
    assert(/already used/.test(dupe.errors.roll), 'roll error should explain the clash');
    equal(db.Students.all().length, 1);
  });

  it('allows the same roll in a different section', function () {
    var db = freshDB();
    seed(db.Students, [{ name: 'Ali Raza', roll: '7', className: '5', section: 'A' }]);
    assert(db.Students.create({ name: 'Bilal Ahmed', roll: '7', className: '5', section: 'B' }).ok);
    equal(db.Students.all().length, 2);
  });

  it('allows the same roll in a different class', function () {
    var db = freshDB();
    seed(db.Students, [{ name: 'Ali Raza', roll: '7', className: '5', section: 'A' }]);
    assert(db.Students.create({ name: 'Hina Malik', roll: '7', className: '6', section: 'A' }).ok);
    equal(db.Students.all().length, 2);
  });
});

describe('edit', function () {
  it('updates the stored values', function () {
    var db = freshDB();
    var student = seed(db.Students, [{ name: 'Ali Raza', roll: '7', className: '5', section: 'A' }])[0];
    var result = db.Students.update(student.id, { name: 'Ali R Raza', roll: '9', className: '6', section: 'c' });
    assert(result.ok, JSON.stringify(result.errors));

    var stored = db.Students.byId(student.id);
    equal(stored.name, 'Ali R Raza');
    equal(stored.roll, '9');
    equal(stored.className, '6');
    equal(stored.section, 'C');
    equal(db.Students.all().length, 1, 'edit must not create a second row');
  });

  it('lets a student keep its own roll number', function () {
    var db = freshDB();
    var student = seed(db.Students, [{ name: 'Ali Raza', roll: '7', className: '5', section: 'A' }])[0];
    var result = db.Students.update(student.id, { name: 'Ali Raza Khan', roll: '7', className: '5', section: 'A' });
    assert(result.ok, 'a student should not clash with itself');
  });

  it('rejects an edit that collides with another student', function () {
    var db = freshDB();
    var rows = seed(db.Students, [
      { name: 'Ali Raza', roll: '7', className: '5', section: 'A' },
      { name: 'Bilal Ahmed', roll: '8', className: '5', section: 'A' }
    ]);
    var target = rows[1].id;
    var result = db.Students.update(target, { name: 'Bilal Ahmed', roll: '7', className: '5', section: 'A' });
    equal(result.ok, false);
    equal(db.Students.byId(target).roll, '8', 'the original value must survive a failed edit');
  });

  it('reports a missing student', function () {
    var db = freshDB();
    var result = db.Students.update('does-not-exist', { name: 'X Y', roll: '1', className: '1', section: 'A' });
    equal(result.ok, false);
    assert(result.errors.form);
  });
});

describe('delete', function () {
  it('removes only the requested student', function () {
    var db = freshDB();
    var rows = seed(db.Students, [
      { name: 'Ali Raza', roll: '1', className: '5', section: 'A' },
      { name: 'Bilal Ahmed', roll: '2', className: '5', section: 'A' }
    ]);
    equal(db.Students.remove(rows[0].id), true);
    equal(db.Students.all().length, 1);
    equal(db.Students.all()[0].name, 'Bilal Ahmed');
    equal(db.Students.byId(rows[0].id), null);
  });

  it('returns false for an unknown id', function () {
    var db = freshDB();
    equal(db.Students.remove('nope'), false);
  });

  it('frees the roll number for reuse', function () {
    var db = freshDB();
    var student = seed(db.Students, [{ name: 'Ali Raza', roll: '7', className: '5', section: 'A' }])[0];
    db.Students.remove(student.id);
    assert(db.Students.create({ name: 'New Student', roll: '7', className: '5', section: 'A' }).ok);
  });
});

describe('persistence across restarts', function () {
  it('reads the same students back after a reload', function () {
    var storage = makeStorage();
    var db = signedInDB(storage);
    seed(db.Students, [
      { name: 'Ali Raza', roll: '1', className: '5', section: 'A' },
      { name: 'Hina Malik', roll: '2', className: '5', section: 'A' }
    ]);

    var reopened = loadDB(storage); // fresh module, same device storage
    equal(reopened.Students.all().length, 2);
    equal(reopened.Students.all()[0].name, 'Ali Raza');
  });

  it('keeps an edit and a delete after a reload', function () {
    var storage = makeStorage();
    var db = signedInDB(storage);
    var rows = seed(db.Students, [
      { name: 'Ali Raza', roll: '1', className: '5', section: 'A' },
      { name: 'Hina Malik', roll: '2', className: '5', section: 'A' }
    ]);
    db.Students.update(rows[0].id, { name: 'Ali Raza Khan', roll: '1', className: '5', section: 'A' });
    db.Students.remove(rows[1].id);

    var reopened = loadDB(storage);
    equal(reopened.Students.all().length, 1);
    equal(reopened.Students.all()[0].name, 'Ali Raza Khan');
  });

  it('writes under the signed-in school’s own key', function () {
    var storage = makeStorage();
    var db = signedInDB(storage);
    seed(db.Students, [{ name: 'Ali Raza', roll: '1', className: '5', section: 'A' }]);

    var key = keysOf(db).students;
    equal(key, 'sa.' + db.Auth.activeAccountId() + '.students.v1');
    assert(storage._data[key], key + ' should hold the register');
    equal(JSON.parse(storage._data[key]).length, 1);
    equal(storage._data['sa.students.v1'], undefined, 'nothing is written to the unscoped key');
  });
});

describe('sorting, search and grouping', function () {
  function populated() {
    var db = freshDB();
    seed(db.Students, [
      { name: 'Zara Ali', roll: '10', className: '10', section: 'B' },
      { name: 'Ahmed Khan', roll: '2', className: '2', section: 'A' },
      { name: 'Bilal Shah', roll: '10', className: '2', section: 'A' },
      { name: 'Sana Tariq', roll: '1', className: '2', section: 'B' }
    ]);
    return db;
  }

  it('sorts class 2 before class 10 and roll 2 before roll 10', function () {
    var rows = populated().Students.all();
    deepEqual(rows.map(function (r) { return r.className + '-' + r.section + '-' + r.roll; }),
      ['2-A-2', '2-A-10', '2-B-1', '10-B-10']);
  });

  it('finds students by name, roll, class and section', function () {
    var db = populated();
    var rows = db.Students.all();
    equal(db.Students.search(rows, 'bilal').length, 1);
    equal(db.Students.search(rows, 'BILAL').length, 1, 'search is case-insensitive');
    // Zara is roll 10 *and* class 10; Bilal is roll 10 — two distinct students.
    equal(db.Students.search(rows, '10').length, 2, 'matches on roll and on class');
    equal(db.Students.search(rows, '2-A').length, 2, 'class-section shorthand');
    equal(db.Students.search(rows, '   ').length, 4, 'blank search returns everything');
    equal(db.Students.search(rows, 'nobody').length, 0);
  });

  it('buckets students into class + section groups', function () {
    var db = populated();
    var groups = db.Students.group(db.Students.all());
    equal(groups.length, 3);
    equal(groups[0].label, 'Class 2 · Section A');
    equal(groups[0].students.length, 2);
    equal(groups[2].label, 'Class 10 · Section B');
  });

  it('lists distinct classes and sections for the input suggestions', function () {
    var db = populated();
    deepEqual(db.Students.classes(), ['2', '10']);
    deepEqual(db.Students.sections(), ['A', 'B']);
  });
});

/* ================================= report ================================= */

h.report('student model tests');
