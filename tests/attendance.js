/* Unit tests for the attendance model and date helpers in js/db.js.
   Plain Node, no browser: `npm run test:attendance`. */

'use strict';

var h = require('./harness');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;
var makeStorage = h.makeStorage, loadDB = h.loadDB, freshDB = h.freshDB;
var signedInDB = h.signedInDB, keysOf = h.keysOf;
var seed = h.seed, quiet = h.quiet;

var CLASS_5A = [
  { name: 'Ahmed Noor', roll: '1', className: '5', section: 'A' },
  { name: 'Bilal Shah', roll: '2', className: '5', section: 'A' },
  { name: 'Hina Malik', roll: '3', className: '5', section: 'A' }
];

var CLASS_6B = [
  { name: 'Sana Tariq', roll: '1', className: '6', section: 'B' },
  { name: 'Zara Ali', roll: '2', className: '6', section: 'B' }
];

/** A database with 5-A and 6-B populated; returns { db, a, b } id lists. */
function school(storage) {
  var db = signedInDB(storage || makeStorage());
  var a = seed(db.Students, CLASS_5A);
  var b = seed(db.Students, CLASS_6B);
  return { db: db, a: a, b: b, A: db.Attendance, S: db.Students };
}

function marksOf(students, statuses) {
  var marks = {};
  students.forEach(function (student, index) {
    if (statuses[index]) marks[student.id] = statuses[index];
  });
  return marks;
}

/* ================================== dates ================================= */

describe('date helpers', function () {
  var util = freshDB().util;

  it('formats a local date without drifting to UTC', function () {
    // 23:30 local would roll over to the next day via toISOString in most of
    // the world — the local formatter must not.
    equal(util.toISODate(new Date(2026, 0, 1, 23, 30)), '2026-01-01');
    equal(util.toISODate(new Date(2026, 8, 4, 0, 15)), '2026-09-04');
    equal(util.toISODate(new Date(2026, 11, 31)), '2026-12-31');
  });

  it('accepts only real calendar days', function () {
    equal(util.isISODate('2026-09-04'), true);
    equal(util.isISODate('2024-02-29'), true, 'leap day');
    equal(util.isISODate('2026-02-29'), false, 'not a leap year');
    equal(util.isISODate('2026-02-31'), false);
    equal(util.isISODate('2026-13-01'), false);
    equal(util.isISODate('2026-9-4'), false, 'must be zero padded');
    equal(util.isISODate(''), false);
    equal(util.isISODate(null), false);
  });

  it('validates months', function () {
    equal(util.isISOMonth('2026-09'), true);
    equal(util.isISOMonth('2026-00'), false);
    equal(util.isISOMonth('2026-13'), false);
    equal(util.isISOMonth('2026-09-04'), false);
  });

  it('formats dates and months for display', function () {
    equal(util.formatDate('2026-09-04'), 'Fri, 4 Sep 2026');
    equal(util.formatDate('2026-01-01'), 'Thu, 1 Jan 2026');
    equal(util.formatDate('bad'), '');
    equal(util.formatMonth('2026-09'), 'September 2026');
    equal(util.formatMonth('bad'), '');
  });

  it('derives the month from a date', function () {
    equal(util.monthOf('2026-09-04'), '2026-09');
  });

  it('reports today in the same shape', function () {
    equal(util.isISODate(util.today()), true);
    equal(util.isISOMonth(util.thisMonth()), true);
    equal(util.today().slice(0, 7), util.thisMonth());
  });
});

/* ================================= roster ================================= */

describe('roster', function () {
  it('returns only the students of one class and section, in roll order', function () {
    var s = school();
    var roster = s.S.roster('5', 'A');
    deepEqual(roster.map(function (r) { return r.name; }),
      ['Ahmed Noor', 'Bilal Shah', 'Hina Malik']);
  });

  it('matches case-insensitively', function () {
    var s = school();
    equal(s.S.roster('5', 'a').length, 3);
  });

  it('is empty for a group with nobody in it', function () {
    var s = school();
    deepEqual(s.S.roster('9', 'Z'), []);
  });
});

/* =============================== saving ================================== */

describe('saving a session', function () {
  it('stores a mark for each student', function () {
    var s = school();
    var result = s.A.saveSession('2026-09-04', '5', 'A',
      marksOf(s.a, ['present', 'absent', 'leave']));

    assert(result.ok, JSON.stringify(result));
    equal(result.created, 3);
    equal(result.updated, 0);
    equal(result.saved, 3);
    equal(s.A.count(), 3);
  });

  it('reads the session back as a status map', function () {
    var s = school();
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'absent', 'leave']));

    var marks = s.A.sessionMarks('2026-09-04', '5', 'A');
    equal(marks[s.a[0].id], 'present');
    equal(marks[s.a[1].id], 'absent');
    equal(marks[s.a[2].id], 'leave');
    equal(Object.keys(marks).length, 3);
  });

  it('reports whether a session has been saved', function () {
    var s = school();
    equal(s.A.isSessionSaved('2026-09-04', '5', 'A'), false);
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present']));
    equal(s.A.isSessionSaved('2026-09-04', '5', 'A'), true);
    equal(s.A.isSessionSaved('2026-09-05', '5', 'A'), false, 'another date is separate');
    equal(s.A.isSessionSaved('2026-09-04', '6', 'B'), false, 'another group is separate');
  });

  it('allows a partial session', function () {
    var s = school();
    var result = s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present']));
    assert(result.ok);
    equal(result.saved, 1);
    equal(s.A.count(), 1);
  });

  it('refuses an invalid date', function () {
    var s = school();
    var result = s.A.saveSession('2026-02-31', '5', 'A', marksOf(s.a, ['present']));
    equal(result.ok, false);
    assert(/valid date/.test(result.error), result.error);
    equal(s.A.count(), 0);
  });

  it('refuses a group with no students', function () {
    var s = school();
    var result = s.A.saveSession('2026-09-04', '9', 'Z', {});
    equal(result.ok, false);
    assert(/no students/.test(result.error), result.error);
  });

  it('refuses a session with nothing marked', function () {
    var s = school();
    var result = s.A.saveSession('2026-09-04', '5', 'A', {});
    equal(result.ok, false);
    assert(/at least one/.test(result.error), result.error);
    equal(s.A.count(), 0);
  });

  it('ignores marks for students outside the group', function () {
    var s = school();
    var marks = marksOf(s.a, ['present', 'present', 'present']);
    marks[s.b[0].id] = 'absent'; // a 6-B student
    s.A.saveSession('2026-09-04', '5', 'A', marks);

    equal(s.A.count(), 3, 'only the 5-A roster is written');
    equal(s.A.records({ date: '2026-09-04', className: '6' }).length, 0);
  });

  it('rejects a status that is not present/absent/leave', function () {
    var s = school();
    var marks = {};
    marks[s.a[0].id] = 'holiday';
    marks[s.a[1].id] = 'present';
    var result = s.A.saveSession('2026-09-04', '5', 'A', marks);
    assert(result.ok);
    equal(result.saved, 1, 'only the valid mark is stored');
    equal(s.A.count(), 1);
  });

  it('records the class the student was in on that day', function () {
    var s = school();
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present']));

    // The student later moves to 7-C; history must not be rewritten.
    s.S.update(s.a[0].id, { name: 'Ahmed Noor', roll: '1', className: '7', section: 'C' });

    var rows = s.A.records({ date: '2026-09-04' });
    equal(rows.length, 1);
    equal(rows[0].className, '5', 'the record keeps the class it was taken in');
    equal(rows[0].section, 'A');
  });
});

/* ========================== no duplicate records ========================== */

describe('one record per student per date', function () {
  it('overwrites instead of duplicating when the same session is saved again', function () {
    var s = school();
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'present', 'present']));
    equal(s.A.count(), 3);

    var again = s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'present', 'present']));
    equal(s.A.count(), 3, 'still three records');
    equal(again.created, 0);
    equal(again.unchanged, 3);
    equal(s.A.records({ date: '2026-09-04' }).length, 3);
  });

  it('updates a changed status in place', function () {
    var s = school();
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'present', 'present']));

    var result = s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['absent', 'present', 'leave']));
    equal(result.created, 0);
    equal(result.updated, 2);
    equal(result.unchanged, 1);
    equal(s.A.count(), 3, 'no new rows');

    var marks = s.A.sessionMarks('2026-09-04', '5', 'A');
    equal(marks[s.a[0].id], 'absent');
    equal(marks[s.a[2].id], 'leave');
  });

  it('clears a record when a student is left unmarked on a re-save', function () {
    var s = school();
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'present', 'present']));

    var result = s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'present']));
    equal(result.cleared, 1);
    equal(s.A.count(), 2);
    equal(s.A.sessionMarks('2026-09-04', '5', 'A')[s.a[2].id], undefined);
  });

  it('keeps separate records for separate dates', function () {
    var s = school();
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'present', 'present']));
    s.A.saveSession('2026-09-05', '5', 'A', marksOf(s.a, ['absent', 'absent', 'absent']));

    equal(s.A.count(), 6);
    equal(s.A.sessionMarks('2026-09-04', '5', 'A')[s.a[0].id], 'present');
    equal(s.A.sessionMarks('2026-09-05', '5', 'A')[s.a[0].id], 'absent');
  });

  it('keeps one row per student even after many re-saves', function () {
    var s = school();
    for (var i = 0; i < 6; i++) {
      s.A.saveSession('2026-09-04', '5', 'A',
        marksOf(s.a, [i % 2 ? 'present' : 'absent', 'leave', 'present']));
    }
    equal(s.A.count(), 3);
  });
});

/* =============================== persistence ============================== */

describe('persistence across restarts', function () {
  it('keeps attendance after the app is closed and reopened', function () {
    var storage = makeStorage();
    var s = school(storage);
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'absent', 'leave']));

    var reopened = loadDB(storage); // fresh module, same device storage
    var marks = reopened.Attendance.sessionMarks('2026-09-04', '5', 'A');
    equal(Object.keys(marks).length, 3);
    equal(marks[s.a[1].id], 'absent');
    equal(reopened.Attendance.count(), 3);
  });

  it('does not duplicate when the same date is saved after a restart', function () {
    var storage = makeStorage();
    var s = school(storage);
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'present', 'present']));

    var reopened = loadDB(storage);
    reopened.Attendance.saveSession('2026-09-04', '5', 'A',
      marksOf(s.a, ['absent', 'present', 'present']));

    equal(reopened.Attendance.count(), 3);
    equal(reopened.Attendance.sessionMarks('2026-09-04', '5', 'A')[s.a[0].id], 'absent');
  });

  it('writes under the signed-in school’s own key', function () {
    var storage = makeStorage();
    var s = school(storage);
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present']));

    var key = keysOf(s.db).attendance;
    equal(key, 'sa.' + s.db.Auth.activeAccountId() + '.attendance.v1');

    var map = JSON.parse(storage._data[key]);
    var keys = Object.keys(map);
    equal(keys.length, 1);
    equal(keys[0], s.a[0].id + '|2026-09-04', 'keyed by student and date');
    equal(map[keys[0]].status, 'present');
    equal(storage._data['sa.attendance.v1'], undefined, 'nothing at the unscoped key');
  });

  it('survives a corrupted attendance entry', function () {
    quiet(function () {
      var storage = makeStorage();
      var s = school(storage);
      storage._data[keysOf(s.db).attendance] = '{broken';

      var db = loadDB(storage);
      equal(db.Attendance.count(), 0);
      assert(db.Attendance.saveSession('2026-09-04', '5', 'A',
        marksOf(s.a, ['present'])).ok);
      equal(db.Attendance.count(), 1);
    });
  });

  it('ignores malformed rows in the attendance map', function () {
    var storage = makeStorage();
    var s = school(storage);
    storage._data[keysOf(s.db).attendance] = JSON.stringify({
      'a|b': null,
      'x|2026-09-04': { studentId: 'x', date: 'nope', status: 'present' },
      'y|2026-09-04': { studentId: 'y', date: '2026-09-04', status: 'holiday' }
    });

    var db = loadDB(storage);
    equal(db.Attendance.count(), 0, 'none of those are valid marks');
  });

  it('falls back to memory when storage is blocked', function () {
    var db = signedInDB(makeStorage({ throwOnWrite: true }));
    var students = seed(db.Students, CLASS_5A);
    equal(db.isPersistent(), false);
    assert(db.Attendance.saveSession('2026-09-04', '5', 'A',
      marksOf(students, ['present', 'absent'])).ok);
    equal(db.Attendance.count(), 2, 'readable from the memory fallback');
  });

  it('hides attendance while signed out', function () {
    var s = school();
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'absent', 'leave']));
    equal(s.A.count(), 3);

    s.db.Auth.logout();
    equal(s.A.count(), 0, 'no marks are readable without an account');
    deepEqual(s.A.records({}), []);
    deepEqual(s.A.sessionMarks('2026-09-04', '5', 'A'), {});
  });
});

/* ============================ deleting a student ========================== */

describe('deleting a student', function () {
  it('removes their attendance too', function () {
    var s = school();
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'present', 'present']));
    s.A.saveSession('2026-09-05', '5', 'A', marksOf(s.a, ['absent', 'absent', 'absent']));
    equal(s.A.count(), 6);

    equal(s.S.remove(s.a[0].id), true);
    equal(s.A.count(), 4, 'both of their records are gone');
  });

  it('leaves the other students alone', function () {
    var s = school();
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'absent', 'leave']));
    s.S.remove(s.a[0].id);

    var marks = s.A.sessionMarks('2026-09-04', '5', 'A');
    equal(marks[s.a[1].id], 'absent');
    equal(marks[s.a[2].id], 'leave');
    equal(Object.keys(marks).length, 2);
  });

  it('drops deleted students out of the records view', function () {
    var s = school();
    s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'present', 'present']));
    s.S.remove(s.a[1].id);

    var names = s.A.records({ date: '2026-09-04' }).map(function (r) { return r.name; });
    deepEqual(names, ['Ahmed Noor', 'Hina Malik']);
  });
});

/* ================================ records ================================= */

function loaded() {
  var s = school();
  s.A.saveSession('2026-09-04', '5', 'A', marksOf(s.a, ['present', 'absent', 'leave']));
  s.A.saveSession('2026-09-05', '5', 'A', marksOf(s.a, ['present', 'present', 'absent']));
  s.A.saveSession('2026-09-04', '6', 'B', marksOf(s.b, ['present', 'absent']));
  s.A.saveSession('2026-10-01', '5', 'A', marksOf(s.a, ['present', 'present', 'present']));
  return s;
}

describe('records', function () {
  it('returns every stored mark joined with its student', function () {
    var s = loaded();
    var rows = s.A.records({});
    equal(rows.length, 11);
    assert(rows[0].name, 'rows carry the student name');
    assert(rows[0].roll, 'rows carry the roll number');
  });

  it('sorts newest date first, then class, section and roll', function () {
    var s = loaded();
    var rows = s.A.records({});
    equal(rows[0].date, '2026-10-01', 'newest first');
    equal(rows[rows.length - 1].date, '2026-09-04');

    var sameDay = s.A.records({ date: '2026-09-04' });
    deepEqual(sameDay.map(function (r) { return r.className + '-' + r.section + '-' + r.roll; }),
      ['5-A-1', '5-A-2', '5-A-3', '6-B-1', '6-B-2']);
  });

  it('filters by date', function () {
    var s = loaded();
    equal(s.A.records({ date: '2026-09-05' }).length, 3);
    equal(s.A.records({ date: '2026-01-01' }).length, 0);
  });

  it('filters by month', function () {
    var s = loaded();
    equal(s.A.records({ month: '2026-09' }).length, 8);
    equal(s.A.records({ month: '2026-10' }).length, 3);
  });

  it('filters by class', function () {
    var s = loaded();
    equal(s.A.records({ className: '6' }).length, 2);
    equal(s.A.records({ className: '5' }).length, 9);
  });

  it('filters by section', function () {
    var s = loaded();
    equal(s.A.records({ section: 'B' }).length, 2);
    equal(s.A.records({ section: 'b' }).length, 2, 'section filter is case-insensitive');
  });

  it('filters by status', function () {
    var s = loaded();
    equal(s.A.records({ status: 'absent' }).length, 3);
    equal(s.A.records({ date: '2026-09-04', status: 'leave' }).length, 1);
  });

  it('combines filters', function () {
    var s = loaded();
    equal(s.A.records({ date: '2026-09-04', className: '5', section: 'A' }).length, 3);
    equal(s.A.records({ date: '2026-09-04', className: '5', section: 'B' }).length, 0);
  });

  it('searches by student name and roll', function () {
    var s = loaded();
    equal(s.A.records({ term: 'hina' }).length, 3);
    equal(s.A.records({ term: 'HINA' }).length, 3, 'case-insensitive');
    equal(s.A.records({ term: 'zara' }).length, 1);
    equal(s.A.records({ term: 'nobody' }).length, 0);
    equal(s.A.records({ term: '   ' }).length, 11, 'blank term matches everything');
  });

  it('filters by one student', function () {
    var s = loaded();
    equal(s.A.records({ studentId: s.a[0].id }).length, 3);
  });

  it('lists the dates that have records, newest first', function () {
    var s = loaded();
    deepEqual(s.A.recordedDates({}), ['2026-10-01', '2026-09-05', '2026-09-04']);
    deepEqual(s.A.recordedDates({ className: '6' }), ['2026-09-04']);
  });
});

/* =============================== summaries ================================ */

describe('daily summary', function () {
  it('tallies present, absent and leave', function () {
    var s = loaded();
    var summary = s.A.summarise(s.A.records({ date: '2026-09-04', className: '5' }));
    deepEqual(summary, { present: 1, absent: 1, leave: 1, total: 3, percent: 33 });
  });

  it('reports 100% when everyone is present', function () {
    var s = loaded();
    var summary = s.A.summarise(s.A.records({ date: '2026-10-01' }));
    equal(summary.present, 3);
    equal(summary.percent, 100);
  });

  it('handles an empty set without dividing by zero', function () {
    var s = loaded();
    deepEqual(s.A.summarise([]), { present: 0, absent: 0, leave: 0, total: 0, percent: 0 });
  });
});

describe('monthly summary', function () {
  it('rolls a month up per student', function () {
    var s = loaded();
    var rows = s.A.monthlySummary('2026-09', {});
    equal(rows.length, 5, 'three in 5-A plus two in 6-B');

    var ahmed = rows[0];
    equal(ahmed.name, 'Ahmed Noor');
    equal(ahmed.present, 2);
    equal(ahmed.absent, 0);
    equal(ahmed.leave, 0);
    equal(ahmed.total, 2);
    equal(ahmed.percent, 100);

    var hina = rows[2];
    equal(hina.name, 'Hina Malik');
    equal(hina.present, 0);
    equal(hina.absent, 1);
    equal(hina.leave, 1);
    equal(hina.percent, 0);
  });

  it('lists the days behind each student total', function () {
    var s = loaded();
    var bilal = s.A.monthlySummary('2026-09', {})[1];
    equal(bilal.name, 'Bilal Shah');
    deepEqual(bilal.days, [
      { date: '2026-09-04', status: 'absent' },
      { date: '2026-09-05', status: 'present' }
    ]);
  });

  it('sorts by class, section then roll', function () {
    var s = loaded();
    var rows = s.A.monthlySummary('2026-09', {});
    deepEqual(rows.map(function (r) { return r.className + '-' + r.section + '-' + r.roll; }),
      ['5-A-1', '5-A-2', '5-A-3', '6-B-1', '6-B-2']);
  });

  it('honours the class, section and search filters', function () {
    var s = loaded();
    equal(s.A.monthlySummary('2026-09', { className: '6' }).length, 2);
    equal(s.A.monthlySummary('2026-09', { section: 'A' }).length, 3);
    equal(s.A.monthlySummary('2026-09', { term: 'zara' }).length, 1);
  });

  it('is empty for a month with no attendance', function () {
    var s = loaded();
    deepEqual(s.A.monthlySummary('2025-01', {}), []);
  });

  it('counts only the month asked for', function () {
    var s = loaded();
    var october = s.A.monthlySummary('2026-10', {});
    equal(october.length, 3);
    equal(october[0].total, 1);
    equal(october[0].percent, 100);
  });
});

/* ========================== dashboard aggregates ========================== */

describe('daily totals', function () {
  it('tallies each recorded day, newest first', function () {
    var s = loaded();
    var days = s.A.dailyTotals();
    deepEqual(days.map(function (d) { return d.date; }),
      ['2026-10-01', '2026-09-05', '2026-09-04']);

    equal(days[2].date, '2026-09-04');
    equal(days[2].present, 2, 'one in 5-A plus one in 6-B');
    equal(days[2].absent, 2);
    equal(days[2].leave, 1);
    equal(days[2].total, 5);
    equal(days[2].percent, 40);
  });

  it('limits the list when asked', function () {
    var s = loaded();
    equal(s.A.dailyTotals(2).length, 2);
    equal(s.A.dailyTotals(2)[0].date, '2026-10-01', 'the newest days survive the cut');
  });

  it('honours filters', function () {
    var s = loaded();
    var days = s.A.dailyTotals(null, { className: '6' });
    equal(days.length, 1);
    equal(days[0].total, 2);
  });

  it('is empty when nothing is recorded', function () {
    var s = school();
    deepEqual(s.A.dailyTotals(), []);
  });

  it('agrees with the daily summary the reports show', function () {
    var s = loaded();
    var fromTotals = s.A.dailyTotals().filter(function (d) { return d.date === '2026-09-04'; })[0];
    var fromSummary = s.A.summarise(s.A.records({ date: '2026-09-04' }));

    equal(fromTotals.present, fromSummary.present);
    equal(fromTotals.absent, fromSummary.absent);
    equal(fromTotals.leave, fromSummary.leave);
    equal(fromTotals.percent, fromSummary.percent);
  });
});

describe('one student’s history', function () {
  it('tallies every day that student was recorded', function () {
    var s = loaded();
    var summary = s.A.studentSummary(s.a[0].id);
    equal(summary.total, 3);
    equal(summary.present, 3);
    equal(summary.absent, 0);
    equal(summary.percent, 100);
    deepEqual(summary.days.map(function (d) { return d.date; }),
      ['2026-10-01', '2026-09-05', '2026-09-04']);
  });

  it('counts a mixed record', function () {
    var s = loaded();
    var summary = s.A.studentSummary(s.a[2].id); // Hina
    equal(summary.present, 1);
    equal(summary.absent, 1);
    equal(summary.leave, 1);
    equal(summary.percent, 33);
  });

  it('is empty for a student with no attendance', function () {
    var s = school();
    var summary = s.A.studentSummary(s.a[0].id);
    equal(summary.total, 0);
    equal(summary.percent, 0);
    deepEqual(summary.days, []);
  });
});

describe('father name in attendance', function () {
  it('rides along with each record', function () {
    var db = signedInDB(makeStorage());
    var rows = seed(db.Students, [
      { name: 'Ayesha Khan', fatherName: 'Imran Khan', roll: '1', className: '5', section: 'A' }
    ]);
    var marks = {};
    marks[rows[0].id] = 'present';
    db.Attendance.saveSession('2026-09-04', '5', 'A', marks);

    equal(db.Attendance.records({})[0].fatherName, 'Imran Khan');
    equal(db.Attendance.monthlySummary('2026-09', {})[0].fatherName, 'Imran Khan');
  });

  it('is searchable in the records', function () {
    var db = signedInDB(makeStorage());
    var rows = seed(db.Students, [
      { name: 'Ayesha Khan', fatherName: 'Imran Khan', roll: '1', className: '5', section: 'A' },
      { name: 'Bilal Shah', fatherName: 'Kamran Shah', roll: '2', className: '5', section: 'A' }
    ]);
    var marks = {};
    marks[rows[0].id] = 'present';
    marks[rows[1].id] = 'absent';
    db.Attendance.saveSession('2026-09-04', '5', 'A', marks);

    equal(db.Attendance.records({ term: 'imran' }).length, 1);
    equal(db.Attendance.records({ term: 'kamran' })[0].name, 'Bilal Shah');
  });
});

h.report('attendance model tests');
