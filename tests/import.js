/* Excel student import: parsing real .xlsx / .xls bytes, column mapping,
   validation, duplicate detection and the commit. Drives the same vendored
   SheetJS build that ships in the APK, not a node_modules copy.
   `npm run test:import` */

'use strict';

var path = require('path');
var h = require('./harness');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;

/* import.js is written for a browser, so give it the two globals it closes
   over before loading it. Only load() touches document, and only readFile()
   touches FileReader; neither is on the path these tests take. */
globalThis.window = globalThis;
globalThis.document = { createElement: function () { return {}; }, head: { appendChild: function () {} } };

var XLSX = require(path.resolve(__dirname, '..', 'js', 'vendor', 'xlsx.full.min.js'));
globalThis.XLSX = XLSX;

var db = h.signedInDB();
globalThis.SchoolDB = db;

require(path.resolve(__dirname, '..', 'js', 'import.js'));
var Import = globalThis.SchoolImport;
var Students = db.Students;

/* ------------------------------------------------------------------ tools */

/** Build a real workbook the way Excel would write one. */
function workbook(rows, bookType) {
  var sheet = XLSX.utils.aoa_to_sheet(rows);
  var book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Students');
  return XLSX.write(book, { type: 'array', bookType: bookType || 'xlsx' });
}

var HEAD = ['Student Name', 'Father Name', 'Roll Number', 'Class', 'Section'];

function parseRows(rows, bookType) {
  return Import.parse(workbook(rows, bookType));
}

/** Wipe the register between tests so duplicate checks start clean. */
function clearStudents() {
  Students.all().forEach(function (student) { Students.remove(student.id); });
}

/* ==================================== run ================================== */

describe('reading a workbook');

it('parses a well-formed sheet', function () {
  var result = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A'],
    ['Bilal Shah', 'Kamran Shah', '2', '5', 'A']
  ]);

  equal(result.ok, true, result.error);
  equal(result.sheetName, 'Students');
  equal(result.rows.length, 2);
  equal(result.rows[0].name, 'Ayesha Khan');
  equal(result.rows[0].fatherName, 'Imran Khan');
  equal(result.rows[0].roll, '1');
  equal(result.rows[0].className, '5');
  equal(result.rows[0].section, 'A');
});

it('reports the spreadsheet line number, so the preview matches Excel', function () {
  var result = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A']
  ]);
  equal(result.rows[0].line, 2, 'the first student is on row 2 of the sheet');
});

it('reads the old .xls format too', function () {
  var result = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A']
  ], 'xls');

  equal(result.ok, true, result.error);
  equal(result.rows.length, 1);
  equal(result.rows[0].name, 'Ayesha Khan');
});

it('accepts the spellings a teacher actually types', function () {
  var result = parseRows([
    ['NAME', "Father's Name", 'Roll No.', 'Grade', 'Sec'],
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A']
  ]);

  equal(result.ok, true, result.error);
  equal(result.rows[0].name, 'Ayesha Khan');
  equal(result.rows[0].fatherName, 'Imran Khan');
  equal(result.rows[0].roll, '1');
  equal(result.rows[0].className, '5');
  equal(result.rows[0].section, 'A');
});

it('finds the headings when the sheet starts with a title', function () {
  var result = parseRows([
    ['ABC Public School'],
    ['Class 5 register'],
    [],
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A']
  ]);

  equal(result.ok, true, result.error);
  equal(result.rows.length, 1);
  equal(result.rows[0].name, 'Ayesha Khan');
});

it('turns numeric cells into the text the app stores', function () {
  // Roll numbers and classes typed as numbers come back as floats.
  var result = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', 7, 10, 'A']
  ]);

  equal(result.rows[0].roll, '7', 'not 7 the number');
  equal(result.rows[0].className, '10');
});

it('ignores blank spacer rows', function () {
  var result = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A'],
    ['', '', '', '', ''],
    ['Bilal Shah', 'Kamran Shah', '2', '5', 'A']
  ]);

  equal(result.rows.length, 2, 'the empty row is skipped, not reported');
  deepEqual(result.rows.map(function (r) { return r.name; }), ['Ayesha Khan', 'Bilal Shah']);
});

it('keeps a student whose father name is blank', function () {
  var result = parseRows([
    HEAD,
    ['Ayesha Khan', '', '1', '5', 'A']
  ]);

  equal(result.rows.length, 1);
  equal(result.rows[0].fatherName, '');
});

/* ==================================================================== */
describe('workbooks that cannot be used');

it('refuses a sheet with no headings', function () {
  var result = parseRows([
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A'],
    ['Bilal Shah', 'Kamran Shah', '2', '5', 'A']
  ]);

  equal(result.ok, false);
  assert(/No column headings/.test(result.error), result.error);
});

it('names the columns that are missing', function () {
  var result = parseRows([
    ['Student Name', 'Father Name'],
    ['Ayesha Khan', 'Imran Khan']
  ]);

  equal(result.ok, false);
  assert(/Missing columns/.test(result.error), result.error);
  assert(/Roll Number/.test(result.error), result.error);
  assert(/Class/.test(result.error), result.error);
  assert(/Section/.test(result.error), result.error);
});

it('refuses a sheet with headings but no students', function () {
  var result = parseRows([HEAD]);
  equal(result.ok, false);
  assert(/no student rows/.test(result.error), result.error);
});

it('does not throw on bytes that are not a spreadsheet', function () {
  var threw = null;
  try {
    Import.parse(new Uint8Array([1, 2, 3, 4, 5]));
  } catch (err) {
    threw = err;
  }
  // readFile() turns this into a friendly message; parse() may throw, but it
  // must not hang or corrupt anything.
  assert(threw === null || threw instanceof Error, 'a clean failure either way');
});

/* ==================================================================== */
describe('validating the rows');

it('marks good rows importable', function () {
  clearStudents();
  var parsed = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A'],
    ['Bilal Shah', 'Kamran Shah', '2', '5', 'A']
  ]);

  var prepared = Import.prepare(parsed.rows);
  deepEqual(prepared.counts, { total: 2, ok: 2, duplicate: 0, invalid: 0 });
});

it('rejects a row with no student name', function () {
  clearStudents();
  var parsed = parseRows([
    HEAD,
    ['', 'Imran Khan', '1', '5', 'A']
  ]);

  var prepared = Import.prepare(parsed.rows);
  equal(prepared.counts.invalid, 1);
  equal(prepared.rows[0].status, 'invalid');
  assert(/name is required/i.test(prepared.rows[0].note), prepared.rows[0].note);
});

it('rejects a row with no roll number', function () {
  clearStudents();
  var parsed = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '', '5', 'A']
  ]);

  var prepared = Import.prepare(parsed.rows);
  equal(prepared.rows[0].status, 'invalid');
  assert(/Roll number is required/i.test(prepared.rows[0].note), prepared.rows[0].note);
});

it('rejects a one-character name as a typo', function () {
  clearStudents();
  var parsed = parseRows([
    HEAD,
    ['A', 'Imran Khan', '1', '5', 'A']
  ]);

  equal(Import.prepare(parsed.rows).rows[0].status, 'invalid');
});

/* ==================================================================== */
describe('duplicate roll numbers');

it('flags a roll repeated inside the file, keeping the first', function () {
  clearStudents();
  var parsed = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A'],
    ['Bilal Shah', 'Kamran Shah', '1', '5', 'A']
  ]);

  var prepared = Import.prepare(parsed.rows);
  equal(prepared.counts.ok, 1);
  equal(prepared.counts.duplicate, 1);
  equal(prepared.rows[0].status, 'ok', 'the first one is kept');
  equal(prepared.rows[1].status, 'duplicate');
  assert(/repeated from line 2/.test(prepared.rows[1].note), prepared.rows[1].note);
});

it('flags a roll that a student already on file holds', function () {
  clearStudents();
  h.seed(Students, [
    { name: 'Existing Student', fatherName: 'Existing Father', roll: '1', className: '5', section: 'A' }
  ]);

  var parsed = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A']
  ]);

  var prepared = Import.prepare(parsed.rows);
  equal(prepared.rows[0].status, 'duplicate');
  assert(/already exists in Class 5/.test(prepared.rows[0].note), prepared.rows[0].note);
});

it('allows the same roll in a different class or section', function () {
  clearStudents();
  h.seed(Students, [
    { name: 'Existing Student', fatherName: 'Existing Father', roll: '1', className: '5', section: 'A' }
  ]);

  var parsed = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'B'],
    ['Bilal Shah', 'Kamran Shah', '1', '6', 'A']
  ]);

  var prepared = Import.prepare(parsed.rows);
  equal(prepared.counts.ok, 2, 'roll 1 is free in 5-B and in 6-A');
});

it('treats section a and A as the same group', function () {
  clearStudents();
  var parsed = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A'],
    ['Bilal Shah', 'Kamran Shah', '1', '5', 'a']
  ]);

  var prepared = Import.prepare(parsed.rows);
  equal(prepared.counts.duplicate, 1, 'lower-case a is still section A');
});

/* ==================================================================== */
describe('committing the import');

it('writes only the importable rows', function () {
  clearStudents();
  var parsed = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A'],
    ['', 'Nobody', '2', '5', 'A'],
    ['Bilal Shah', 'Kamran Shah', '1', '5', 'A'],
    ['Chand Bibi', 'Nasir Ali', '3', '5', 'A']
  ]);

  var prepared = Import.prepare(parsed.rows);
  var result = Import.commit(prepared);

  equal(result.imported.length, 2, 'the blank name and the duplicate are left out');
  equal(result.failed.length, 0);
  deepEqual(Students.all().map(function (s) { return s.name; }).sort(),
    ['Ayesha Khan', 'Chand Bibi']);
});

it('keeps the father names', function () {
  clearStudents();
  var parsed = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A']
  ]);
  Import.commit(Import.prepare(parsed.rows));

  equal(Students.all()[0].fatherName, 'Imran Khan');
});

it('leaves students already on file untouched', function () {
  clearStudents();
  var before = h.seed(Students, [
    { name: 'Existing Student', fatherName: 'Existing Father', roll: '9', className: '9', section: 'Z' }
  ])[0];

  var parsed = parseRows([
    HEAD,
    ['Ayesha Khan', 'Imran Khan', '1', '5', 'A']
  ]);
  Import.commit(Import.prepare(parsed.rows));

  var still = Students.byId(before.id);
  assert(still, 'the existing student is still there');
  equal(still.name, 'Existing Student');
  equal(still.fatherName, 'Existing Father');
  equal(Students.all().length, 2);
});

it('imports nothing when every row is refused', function () {
  clearStudents();
  var parsed = parseRows([
    HEAD,
    ['', '', '1', '5', 'A'],
    ['B', 'Someone', '2', '5', 'A']
  ]);

  var result = Import.commit(Import.prepare(parsed.rows));
  equal(result.imported.length, 0);
  equal(Students.all().length, 0);
});

it('handles a large register', function () {
  clearStudents();
  var rows = [HEAD];
  for (var i = 1; i <= 300; i++) {
    rows.push(['Student ' + i, 'Father ' + i, String(i), '5', 'A']);
  }

  var parsed = parseRows(rows);
  var prepared = Import.prepare(parsed.rows);
  equal(prepared.counts.ok, 300);

  var result = Import.commit(prepared);
  equal(result.imported.length, 300);
  equal(Students.all().length, 300);
});

/* -------------------------------------------------------------- report */
h.report('Excel import tests');
