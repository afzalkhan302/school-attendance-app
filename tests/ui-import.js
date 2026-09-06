/* The Excel import driven through the real UI: the button on the students
   screen, the preview it renders, and what actually lands in the register.
   `npm run test:ui-import` */

'use strict';

var path = require('path');
var h = require('./harness');
var { startServer, stopServer, openApp } = require('./helpers');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;

var XLSX = require(path.resolve(__dirname, '..', 'js', 'vendor', 'xlsx.full.min.js'));

var HEAD = ['Student Name', 'Father Name', 'Roll Number', 'Class', 'Section'];

function workbookBytes(rows) {
  var sheet = XLSX.utils.aoa_to_sheet(rows);
  var book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Students');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

/**
 * Hand the page a file as though the teacher had picked it.
 *
 * The page loads the real vendored SheetJS over the test server, the same way
 * the app does. Injecting the Node copy instead would be faster but would not
 * work: SheetJS type-checks the ArrayBuffer it is given, and one made inside
 * jsdom fails `instanceof` against Node's realm.
 */
function pickFile(page, rows, filename) {
  var bytes = workbookBytes(rows);
  var file = new page.window.File([new Uint8Array(bytes)], filename || 'students.xlsx');

  var input = page.$('#import-file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new page.window.Event('change', { bubbles: true }));
}

/** The vendored reader is ~930 KB; fetching and parsing it takes a moment. */
async function waitForPreview(page) {
  for (var i = 0; i < 200; i++) {
    if (!page.$('#import-step-preview').hidden) return;
    if (!page.$('#import-error').hidden) {
      throw new Error('import refused the file: ' + page.text('#import-error'));
    }
    await page.tick();
  }
  throw new Error('timed out waiting for the preview');
}

function previewRows(page) {
  return page.$$('#import-rows .import__row').map(function (tr) {
    var cells = Array.prototype.slice.call(tr.querySelectorAll('td'));
    return {
      line: cells[0].textContent,
      name: cells[1].textContent,
      status: cells[6].textContent,
      kind: tr.className.replace('import__row import__row--', '')
    };
  });
}

function counts(page) {
  return {
    ok: Number(page.text('#import-n-ok')),
    duplicate: Number(page.text('#import-n-dup')),
    invalid: Number(page.text('#import-n-bad'))
  };
}

/* ==================================== run ================================== */

async function main() {
  await startServer();

  /* ==================================================================== */
  describe('opening the import sheet');

  var page = await openApp();

  await it('has an import button on the students screen', async function () {
    page.goTo('students');
    var button = page.$('#import-open');
    assert(button, 'the button exists');
    assert(/Import from Excel/.test(button.textContent), button.textContent);
  });

  await it('opens on the file-picking step', async function () {
    page.$('#import-open').click();
    equal(page.$('#import-sheet').hidden, false, 'the sheet is open');
    equal(page.$('#import-step-pick').hidden, false, 'asking for a file');
    equal(page.$('#import-step-preview').hidden, true, 'no preview yet');
  });

  await it('lists the columns the file needs', async function () {
    var text = page.text('#import-sheet');
    ['Student Name', 'Father Name', 'Roll Number', 'Class', 'Section'].forEach(function (column) {
      assert(text.indexOf(column) !== -1, 'names the ' + column + ' column');
    });
  });

  await it('says the file is not uploaded anywhere', async function () {
    assert(/read on this device/.test(page.text('#import-sheet')), 'reassures about privacy');
  });

  /* ==================================================================== */
  describe('previewing a good file');

  await it('shows every row with its verdict', async function () {
    pickFile(page, [
      HEAD,
      ['Ayesha Khan', 'Imran Khan', '1', '5', 'A'],
      ['Bilal Shah', 'Kamran Shah', '2', '5', 'A']
    ]);
    await waitForPreview(page);

    deepEqual(counts(page), { ok: 2, duplicate: 0, invalid: 0 });

    var rows = previewRows(page);
    equal(rows.length, 2);
    deepEqual(rows.map(function (r) { return r.name; }), ['Ayesha Khan', 'Bilal Shah']);
    deepEqual(rows.map(function (r) { return r.status; }), ['Will import', 'Will import']);
  });

  await it('names the file and the sheet', async function () {
    var label = page.text('#import-filename');
    assert(/students\.xlsx/.test(label), label);
    assert(/Students/.test(label), label);
  });

  await it('offers to import exactly the good rows', async function () {
    var button = page.$('#import-commit');
    equal(button.disabled, false);
    equal(button.textContent, 'Import 2 students');
  });

  await it('nothing is written until Import is tapped', async function () {
    equal(page.dbStudents().length, 0, 'the preview alone changes nothing');
  });

  await it('imports them, and the list shows them', async function () {
    page.$('#import-commit').click();
    await page.waitFor(function () { return page.dbStudents().length === 2; }, 'the import to land');

    equal(page.$('#import-sheet').hidden, true, 'the sheet closed');
    deepEqual(page.names(), ['Ayesha Khan', 'Bilal Shah']);
    equal(page.fatherOf('Ayesha Khan'), 'S/D of Imran Khan', 'father names came across');
    assert(/2 students imported/.test(page.toastText()), page.toastText());
  });

  /* ==================================================================== */
  describe('a file with problems in it');

  await it('separates duplicates and errors from the rest', async function () {
    page.$('#import-open').click();
    pickFile(page, [
      HEAD,
      ['Chand Bibi', 'Nasir Ali', '3', '5', 'A'],      // fine
      ['Dawood Khan', 'Tariq Khan', '1', '5', 'A'],    // roll 1 is Ayesha's
      ['', 'Nobody', '4', '5', 'A'],                   // no name
      ['Erum Shah', 'Salim Shah', '3', '5', 'A']       // repeats line 2
    ]);
    await waitForPreview(page);

    deepEqual(counts(page), { ok: 1, duplicate: 2, invalid: 1 });

    var rows = previewRows(page);
    deepEqual(rows.map(function (r) { return r.kind; }),
      ['ok', 'duplicate', 'invalid', 'duplicate']);
  });

  await it('explains each rejection in the row', async function () {
    var notes = page.$$('#import-rows .import__noterow').map(function (tr) {
      return tr.textContent;
    });

    assert(notes.some(function (n) { return /already exists in Class 5/.test(n); }),
      'says which existing student clashes: ' + JSON.stringify(notes));
    assert(notes.some(function (n) { return /repeated from line 2/.test(n); }),
      'points at the earlier line: ' + JSON.stringify(notes));
    assert(notes.some(function (n) { return /name is required/i.test(n); }),
      'says what is missing: ' + JSON.stringify(notes));
  });

  await it('imports only the good row and reports the rest as skipped', async function () {
    equal(page.$('#import-commit').textContent, 'Import 1 student');
    page.$('#import-commit').click();
    await page.waitFor(function () { return page.dbStudents().length === 3; }, 'the import to land');

    deepEqual(page.dbStudents().sort(), ['Ayesha Khan', 'Bilal Shah', 'Chand Bibi']);
    assert(/1 student imported, 3 skipped/.test(page.toastText()), page.toastText());
  });

  await it('left the students already on file alone', async function () {
    equal(page.fatherOf('Ayesha Khan'), 'S/D of Imran Khan');
  });

  /* ==================================================================== */
  describe('files that cannot be used at all');

  await it('reports a missing column instead of a preview', async function () {
    page.$('#import-open').click();
    pickFile(page, [
      ['Student Name', 'Father Name'],
      ['Zahra Bibi', 'Ali Raza']
    ]);
    await page.waitFor(function () { return !page.$('#import-error').hidden; }, 'the error', 200);

    var message = page.text('#import-error');
    assert(/Missing columns/.test(message), message);
    assert(/Roll Number/.test(message), message);
    equal(page.$('#import-step-preview').hidden, true, 'no preview offered');
  });

  await it('refuses a file that is not a spreadsheet', async function () {
    var input = page.$('#import-file');
    var file = new page.window.File(['not a spreadsheet'], 'notes.txt');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    await page.tick();

    assert(/Choose an Excel file/.test(page.text('#import-error')), page.text('#import-error'));
  });

  await it('changed nothing while all that was going on', async function () {
    equal(page.dbStudents().length, 3);
  });

  /* ==================================================================== */
  describe('manual Add Student still works');

  await it('adds one by hand exactly as before', async function () {
    page.window.UI.closeOverlay();
    page.goTo('students');
    page.addStudent({ name: 'Manual Entry', fatherName: 'Manual Father', roll: '9', className: '9', section: 'Z' });
    await page.waitFor(function () { return page.dbStudents().length === 4; }, 'the manual add');

    assert(/Manual Entry added/.test(page.toastText()), page.toastText());
    equal(page.fatherOf('Manual Entry'), 'S/D of Manual Father');
  });

  await it('and the roll rules still apply to it', async function () {
    page.addStudent({ name: 'Clash', fatherName: 'Someone', roll: '9', className: '9', section: 'Z' });
    await page.tick();

    assert(/already used/.test(page.errorFor('roll')), page.errorFor('roll'));
    equal(page.dbStudents().length, 4, 'nothing was added');
  });

  page.close();

  /* ==================================================================== */
  describe('imported students survive a relaunch');

  await it('are still there after the app is reopened', async function () {
    var device = new (require('fake-indexeddb').IDBFactory)();

    var first = await openApp({ account: null, indexedDB: device });
    first.doRegister({
      schoolName: 'Import School', directorName: 'Director',
      username: 'import_admin', password: 'secret123'
    });
    await first.waitFor(first.appVisible, 'setup to finish');

    first.goTo('students');
    first.$('#import-open').click();
    pickFile(first, [
      HEAD,
      ['Ayesha Khan', 'Imran Khan', '1', '5', 'A'],
      ['Bilal Shah', 'Kamran Shah', '2', '5', 'A']
    ]);
    await waitForPreview(first);
    first.$('#import-commit').click();
    await first.waitFor(function () { return first.dbStudents().length === 2; }, 'the import');
    // Let the save settle before tearing the window down, or the flush
    // callback fires into a page that no longer exists.
    await first.waitFor(function () { return /imported/.test(first.toastText()); }, 'the import toast');
    first.close();

    var again = await openApp({ account: null, indexedDB: device });
    again.goTo('students');
    deepEqual(again.names(), ['Ayesha Khan', 'Bilal Shah']);
    equal(again.fatherOf('Bilal Shah'), 'S/D of Kamran Shah');
    again.close();
  });

  /* -------------------------------------------------------------- report */
  stopServer();
  h.report('Excel import UI tests');
}

main().catch(function (err) {
  console.error(err);
  stopServer();
  process.exit(1);
});
