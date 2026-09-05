/* Unit tests for the daily and monthly Excel (CSV) sheets: `npm run test:export`. */

'use strict';

var path = require('path');
var h = require('./harness');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;
var makeStorage = h.makeStorage, signedInDB = h.signedInDB, seed = h.seed;

require(path.resolve(__dirname, '..', 'js', 'export.js'));
var Export = globalThis.SchoolExport;

var STUDENTS = [
  { name: 'Ahmed Noor', fatherName: 'Imran Noor', roll: '1', className: '5', section: 'A' },
  { name: 'Bilal Shah', fatherName: 'Kamran Shah', roll: '2', className: '5', section: 'A' },
  { name: 'Hina Malik', roll: '3', className: '5', section: 'A' },          // no father name
  { name: 'Zara Ali', fatherName: 'Tariq Ali', roll: '1', className: '6', section: 'B' }
];

var DAY1 = '2026-09-04';
var DAY2 = '2026-09-07';

/** A school with two recorded days across two classes. */
function school() {
  var db = signedInDB(makeStorage());
  var rows = seed(db.Students, STUDENTS);

  var day1 = {};
  day1[rows[0].id] = 'present';
  day1[rows[1].id] = 'absent';
  day1[rows[2].id] = 'leave';
  assert(db.Attendance.saveSession(DAY1, '5', 'A', day1).ok);

  var day2 = {};
  day2[rows[0].id] = 'present';
  day2[rows[1].id] = 'present';
  day2[rows[2].id] = 'present';
  assert(db.Attendance.saveSession(DAY2, '5', 'A', day2).ok);

  var other = {};
  other[rows[3].id] = 'absent';
  assert(db.Attendance.saveSession(DAY1, '6', 'B', other).ok);

  return { db: db, rows: rows };
}

/** Split a built sheet into lines, dropping the byte-order mark. */
function lines(built) {
  return built.content.replace(/^﻿/, '').replace(/\r\n$/, '').split('\r\n');
}

function findRow(built, startsWith) {
  return lines(built).filter(function (line) { return line.indexOf(startsWith) === 0; })[0] || '';
}

/* ================================ escaping ================================ */

describe('CSV cell escaping', function () {
  it('leaves plain values alone', function () {
    equal(Export.cell('Ahmed Noor'), 'Ahmed Noor');
    equal(Export.cell(12), '12');
    equal(Export.cell(''), '');
    equal(Export.cell(null), '');
    equal(Export.cell(undefined), '');
  });

  it('quotes values containing a comma, quote or newline', function () {
    equal(Export.cell('Khan, Ahmed'), '"Khan, Ahmed"');
    equal(Export.cell('He said "hi"'), '"He said ""hi"""');
    equal(Export.cell('two\nlines'), '"two\nlines"');
  });

  it('defuses values a spreadsheet would read as a formula', function () {
    equal(Export.cell('=1+1'), "'=1+1");
    equal(Export.cell('+A1'), "'+A1");
    equal(Export.cell('-cmd'), "'-cmd");
    equal(Export.cell('@SUM'), "'@SUM");
  });

  it('builds a row from several cells', function () {
    equal(Export.row(['a', 'b,c', 1]), 'a,"b,c",1');
  });

  it('makes a safe file name from a school name', function () {
    equal(Export.fileSafe('ABC Public School'), 'ABC-Public-School');
    equal(Export.fileSafe('A/B:C*D?'), 'ABCD');
    equal(Export.fileSafe(''), 'school');
  });
});

/* ============================== daily sheet =============================== */

describe('daily sheet', function () {
  it('names the school and the day at the top', function () {
    var s = school();
    var built = Export.daily({ db: s.db, date: DAY1 });
    var text = built.content;

    assert(text.indexOf('Test School') !== -1, 'school name');
    assert(text.indexOf('Test Director') !== -1, 'director');
    assert(text.indexOf('Daily Attendance') !== -1, 'report title');
    assert(text.indexOf('Fri, 4 Sep 2026') !== -1, 'the date in words');
  });

  it('starts with a byte-order mark so Excel reads it as UTF-8', function () {
    var s = school();
    equal(Export.daily({ db: s.db, date: DAY1 }).content.charCodeAt(0), 0xfeff);
  });

  it('uses CRLF line endings', function () {
    var s = school();
    var text = Export.daily({ db: s.db, date: DAY1 }).content;
    assert(text.indexOf('\r\n') !== -1, 'should contain CRLF');
    equal(/[^\r]\n/.test(text), false, 'no bare newlines');
  });

  it('has a Father Name column', function () {
    var s = school();
    var header = findRow(Export.daily({ db: s.db, date: DAY1 }), '#,Roll No');
    equal(header, '#,Roll No,Student Name,Father Name,Class,Section,Status');
  });

  it('writes one row per student with their father name', function () {
    var s = school();
    var built = Export.daily({ db: s.db, date: DAY1, filters: { className: '5' } });

    equal(built.rowCount, 3);
    equal(findRow(built, '1,1,'), '1,1,Ahmed Noor,Imran Noor,5,A,Present');
    equal(findRow(built, '2,2,'), '2,2,Bilal Shah,Kamran Shah,5,A,Absent');
  });

  it('leaves the father name blank when there is none', function () {
    var s = school();
    var built = Export.daily({ db: s.db, date: DAY1, filters: { className: '5' } });
    equal(findRow(built, '3,3,'), '3,3,Hina Malik,,5,A,Leave');
  });

  it('ends with the day’s tally', function () {
    var s = school();
    var built = Export.daily({ db: s.db, date: DAY1, filters: { className: '5' } });

    equal(findRow(built, 'Total students'), 'Total students,3');
    equal(findRow(built, 'Present'), 'Present,1');
    equal(findRow(built, 'Absent'), 'Absent,1');
    equal(findRow(built, 'Leave'), 'Leave,1');
    equal(findRow(built, 'Attendance %'), 'Attendance %,33%');
  });

  it('honours the class and section filters', function () {
    var s = school();
    equal(Export.daily({ db: s.db, date: DAY1, filters: { className: '6' } }).rowCount, 1);
    equal(Export.daily({ db: s.db, date: DAY1, filters: { section: 'B' } }).rowCount, 1);
    equal(Export.daily({ db: s.db, date: DAY1 }).rowCount, 4, 'no filter means every class');
  });

  it('records the filter in the heading', function () {
    var s = school();
    var scoped = Export.daily({ db: s.db, date: DAY1, filters: { className: '5', section: 'A' } });
    assert(scoped.content.indexOf('Class 5 · Section A') !== -1, 'scope line');

    var all = Export.daily({ db: s.db, date: DAY1 });
    assert(all.content.indexOf('All classes') !== -1);
  });

  it('reports nothing to export for an empty day', function () {
    var s = school();
    var built = Export.daily({ db: s.db, date: '2026-01-01' });
    equal(built.rowCount, 0);
    equal(findRow(built, 'Total students'), 'Total students,0');
  });

  it('names the file after the school and the date', function () {
    var s = school();
    equal(Export.daily({ db: s.db, date: DAY1 }).filename,
      'Test-School-attendance-2026-09-04.csv');
  });

  it('keeps non-ASCII names intact', function () {
    var db = signedInDB(makeStorage());
    var rows = seed(db.Students, [
      { name: 'عائشہ خان', fatherName: 'عمران خان', roll: '1', className: '5', section: 'A' }
    ]);
    var marks = {};
    marks[rows[0].id] = 'present';
    db.Attendance.saveSession(DAY1, '5', 'A', marks);

    var built = Export.daily({ db: db, date: DAY1 });
    assert(built.content.indexOf('عائشہ خان') !== -1, 'student name survives');
    assert(built.content.indexOf('عمران خان') !== -1, 'father name survives');
  });

  it('quotes a name containing a comma', function () {
    var db = signedInDB(makeStorage());
    var rows = seed(db.Students, [
      { name: 'Khan, Ahmed', fatherName: 'Noor, Imran', roll: '1', className: '5', section: 'A' }
    ]);
    var marks = {};
    marks[rows[0].id] = 'present';
    db.Attendance.saveSession(DAY1, '5', 'A', marks);

    assert(findRow(Export.daily({ db: db, date: DAY1 }), '1,1,')
      .indexOf('"Khan, Ahmed","Noor, Imran"') !== -1);
  });
});

/* ============================= monthly sheet ============================== */

describe('monthly sheet', function () {
  it('names the school and the month', function () {
    var s = school();
    var text = Export.monthly({ db: s.db, month: '2026-09' }).content;
    assert(text.indexOf('Test School') !== -1);
    assert(text.indexOf('Monthly Attendance') !== -1);
    assert(text.indexOf('September 2026') !== -1);
  });

  it('has a column per recorded day, plus totals', function () {
    var s = school();
    var header = findRow(Export.monthly({ db: s.db, month: '2026-09', filters: { className: '5' } }),
      '#,Roll No');
    equal(header, '#,Roll No,Student Name,Father Name,Class,Section,4,7,Present,Absent,Leave,Days,Attendance %');
  });

  it('marks each day with P, A or L', function () {
    var s = school();
    var built = Export.monthly({ db: s.db, month: '2026-09', filters: { className: '5' } });

    equal(findRow(built, '1,1,'), '1,1,Ahmed Noor,Imran Noor,5,A,P,P,2,0,0,2,100%');
    equal(findRow(built, '2,2,'), '2,2,Bilal Shah,Kamran Shah,5,A,A,P,1,1,0,2,50%');
    equal(findRow(built, '3,3,'), '3,3,Hina Malik,,5,A,L,P,1,0,1,2,50%');
  });

  it('leaves a day blank when the student has no record for it', function () {
    var s = school();
    // Zara is only recorded on day 1, so her day-7 column must be empty.
    var built = Export.monthly({ db: s.db, month: '2026-09' });
    var row = findRow(built, '4,1,Zara Ali');
    assert(/,A,,/.test(row), 'expected an empty second day column: ' + row);
  });

  it('counts only the month asked for', function () {
    var s = school();
    var built = Export.monthly({ db: s.db, month: '2026-10' });
    equal(built.rowCount, 0);
    equal(findRow(built, 'Days recorded'), 'Days recorded,0');
  });

  it('ends with a key explaining the codes', function () {
    var s = school();
    var text = Export.monthly({ db: s.db, month: '2026-09' }).content;
    assert(text.indexOf('P = Present') !== -1);
    assert(text.indexOf('blank = not recorded') !== -1);
  });

  it('honours the class filter', function () {
    var s = school();
    equal(Export.monthly({ db: s.db, month: '2026-09', filters: { className: '6' } }).rowCount, 1);
    equal(Export.monthly({ db: s.db, month: '2026-09', filters: { className: '5' } }).rowCount, 3);
  });

  it('names the file after the school and the month', function () {
    var s = school();
    equal(Export.monthly({ db: s.db, month: '2026-09' }).filename,
      'Test-School-attendance-2026-09.csv');
  });
});

/* ============================== isolation ================================= */

describe('exports respect the signed-in school', function () {
  it('exports nothing once signed out', function () {
    var s = school();
    s.db.Auth.logout();

    equal(Export.daily({ db: s.db, date: DAY1, account: null }).rowCount, 0);
    equal(Export.monthly({ db: s.db, month: '2026-09', account: null }).rowCount, 0);
  });
});

h.report('export tests');
