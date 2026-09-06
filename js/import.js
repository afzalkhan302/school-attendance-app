/* ==========================================================================
   import.js — bulk student import from an Excel workbook.

   Parsing, column mapping and validation only; no DOM. The UI in students.js
   renders whatever prepare() returns.

   SheetJS is ~930 KB, so it is NOT on the boot path. load() injects it the
   first time a teacher opens the import screen. Everything is local: the file
   is read with FileReader and parsed in the page. Nothing is uploaded.
   ========================================================================== */

(function (window, document) {
  'use strict';

  var VENDOR_SRC = 'js/vendor/xlsx.full.min.js';

  var MAX_BYTES = 8 * 1024 * 1024;   // a class list is kilobytes; 8 MB is a mistake
  var MAX_ROWS = 5000;

  /* Accepted spellings for each column. Compared case-insensitively with all
     non-letters stripped, so "Roll No.", "roll_number" and "RollNumber" all
     land on the same field. A teacher's own file is not machine output. */
  var COLUMNS = [
    { field: 'name',       required: true,  label: 'Student Name',
      aliases: ['studentname', 'name', 'student', 'fullname', 'studentfullname'] },
    { field: 'fatherName', required: false, label: 'Father Name',
      aliases: ['fathername', 'father', 'fathersname', 'guardianname', 'guardian', 'parentname'] },
    { field: 'roll',       required: true,  label: 'Roll Number',
      aliases: ['rollnumber', 'roll', 'rollno', 'rollnum', 'srno', 'serialnumber'] },
    { field: 'className',  required: true,  label: 'Class',
      aliases: ['class', 'classname', 'grade', 'standard', 'std'] },
    { field: 'section',    required: true,  label: 'Section',
      aliases: ['section', 'sec', 'sectionname', 'branch'] }
  ];

  function normHeader(value) {
    return String(value === undefined || value === null ? '' : value)
      .toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /* Excel hands back numbers for numeric cells and Dates for date-formatted
     ones. A roll number typed as 007 comes back as 7, and a class of "10"
     comes back as the number 10 — both have to become the text the app stores. */
  function cellText(value) {
    if (value === undefined || value === null) return '';
    if (value instanceof Date) {
      /* A roll or a class should never be a date. Show what was actually in
         the cell so the teacher can see why the row was refused, rather than
         a silent blank. */
      return value.getFullYear() + '-' +
        ('0' + (value.getMonth() + 1)).slice(-2) + '-' +
        ('0' + value.getDate()).slice(-2);
    }
    if (typeof value === 'number') return String(value);
    return String(value).replace(/\s+/g, ' ').trim();
  }

  /* --------------------------------------------------------------- loading */

  var loading = null;

  /** Inject SheetJS once. Calls back with (error, XLSX). */
  function load(done) {
    if (window.XLSX) { done(null, window.XLSX); return; }

    if (loading) { loading.push(done); return; }
    loading = [done];

    function settle(err) {
      var waiters = loading || [];
      loading = null;
      waiters.forEach(function (waiter) { waiter(err, err ? null : window.XLSX); });
    }

    var script = document.createElement('script');
    script.src = VENDOR_SRC;
    script.async = true;
    script.onload = function () {
      settle(window.XLSX ? null : new Error('The spreadsheet reader did not load.'));
    };
    script.onerror = function () {
      settle(new Error('The spreadsheet reader could not be loaded.'));
    };
    document.head.appendChild(script);
  }

  /* --------------------------------------------------------------- reading */

  /** Read a picked file into rows of raw cell text. */
  function readFile(file, done) {
    if (!file) { done({ ok: false, error: 'No file chosen.' }); return; }

    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name || '')) {
      done({ ok: false, error: 'Choose an Excel file (.xlsx or .xls).' });
      return;
    }
    if (file.size > MAX_BYTES) {
      done({ ok: false, error: 'That file is too large. Choose one under 8 MB.' });
      return;
    }

    load(function (err) {
      if (err) { done({ ok: false, error: err.message }); return; }

      var reader = new window.FileReader();
      reader.onerror = function () { done({ ok: false, error: 'That file could not be read.' }); };
      reader.onload = function () {
        var result;
        try {
          result = parse(reader.result);
        } catch (parseError) {
          result = { ok: false, error: 'That file could not be read as a spreadsheet.' };
        }
        done(result);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Parse a workbook into { ok, rows, sheetName } or { ok:false, error }.
   * Rows carry the spreadsheet line number, so the preview can point at the
   * row the teacher sees in Excel rather than an index of my own making.
   */
  function parse(buffer) {
    var XLSX = window.XLSX;
    if (!XLSX) return { ok: false, error: 'The spreadsheet reader is not loaded.' };

    var workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    var sheetName = workbook.SheetNames && workbook.SheetNames[0];
    if (!sheetName) return { ok: false, error: 'That workbook has no sheets.' };

    var grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, blankrows: false, defval: ''
    });
    if (!grid.length) return { ok: false, error: 'That sheet is empty.' };

    var headerIndex = findHeaderRow(grid);
    if (headerIndex === -1) {
      return {
        ok: false,
        error: 'No column headings found. One row should name the columns: ' +
               COLUMNS.map(function (c) { return c.label; }).join(', ') + '.'
      };
    }

    var mapping = mapColumns(grid[headerIndex]);
    var missing = COLUMNS.filter(function (column) {
      return column.required && mapping[column.field] === undefined;
    });
    if (missing.length) {
      return {
        ok: false,
        error: 'Missing column' + (missing.length > 1 ? 's' : '') + ': ' +
               missing.map(function (c) { return c.label; }).join(', ') + '.'
      };
    }

    var rows = [];
    var seen = 0;

    for (var i = headerIndex + 1; i < grid.length; i++) {
      var raw = grid[i] || [];
      var values = {};
      var blank = true;

      for (var c = 0; c < COLUMNS.length; c++) {
        var column = COLUMNS[c];
        var at = mapping[column.field];
        var text = at === undefined ? '' : cellText(raw[at]);
        values[column.field] = text;
        if (text) blank = false;
      }

      if (blank) continue;               // spacer rows are not errors
      seen++;
      if (rows.length >= MAX_ROWS) continue;

      values.line = i + 1;               // 1-based, as Excel numbers them
      rows.push(values);
    }

    if (!rows.length) return { ok: false, error: 'That sheet has headings but no student rows.' };

    return { ok: true, rows: rows, sheetName: sheetName, truncated: seen > rows.length };
  }

  /** The first row that names at least two known columns, one being the name. */
  function findHeaderRow(grid) {
    var limit = Math.min(grid.length, 20);   // headings are never far down
    for (var i = 0; i < limit; i++) {
      var mapping = mapColumns(grid[i] || []);
      if (mapping.name === undefined) continue;
      var found = 0;
      for (var field in mapping) {
        if (Object.prototype.hasOwnProperty.call(mapping, field)) found++;
      }
      if (found >= 2) return i;
    }
    return -1;
  }

  /** { field: columnIndex } for whichever known columns this row names. */
  function mapColumns(headerRow) {
    var mapping = {};
    (headerRow || []).forEach(function (cell, index) {
      var key = normHeader(cell);
      if (!key) return;
      COLUMNS.forEach(function (column) {
        if (mapping[column.field] !== undefined) return;
        if (column.aliases.indexOf(key) !== -1) mapping[column.field] = index;
      });
    });
    return mapping;
  }

  /* ------------------------------------------------------------ validation */

  /**
   * Decide what happens to every parsed row, without writing anything.
   *
   * A row is `duplicate` when its roll number is already taken in that class
   * and section — either by a student already on file, or by an earlier row in
   * this same file. The first occurrence wins; later ones are reported, never
   * silently merged.
   */
  function prepare(rows) {
    var Students = window.SchoolDB.Students;
    var util = window.SchoolDB.util;

    var taken = {};
    Students.all().forEach(function (student) {
      taken[rollKey(student.className, student.section, student.roll)] = 'existing';
    });

    var prepared = (rows || []).map(function (row) {
      var check = Students.validate(row, null);
      var entry = {
        line: row.line,
        values: check.values,
        raw: row,
        errors: {},
        status: 'ok',
        note: ''
      };

      var complete = check.values.roll && check.values.className && check.values.section;
      var key = complete ? rollKey(check.values.className, check.values.section, check.values.roll) : null;

      /* Checked before the general validity report, because validate() also
         flags a clash with an existing student — and "duplicate roll" is a
         more useful thing to tell someone than "invalid row". */
      if (complete && taken[key]) {
        entry.status = 'duplicate';
        entry.note = taken[key] === 'existing'
          ? 'Roll ' + check.values.roll + ' already exists in ' +
            util.groupLabel(check.values.className, check.values.section) + '.'
          : 'Roll ' + check.values.roll + ' is repeated from line ' + taken[key] + '.';
        return entry;
      }

      if (!check.valid) {
        entry.status = 'invalid';
        entry.errors = check.errors;
        entry.note = firstError(check.errors);
        return entry;
      }

      taken[key] = row.line;   // claim it, so a later repeat is reported
      return entry;
    });

    return { rows: prepared, counts: countBy(prepared) };
  }

  function rollKey(className, section, roll) {
    return window.SchoolDB.util.groupKey(className, section) + '|' + String(roll).toLowerCase();
  }

  function firstError(errors) {
    for (var field in errors) {
      if (Object.prototype.hasOwnProperty.call(errors, field)) return errors[field];
    }
    return 'This row could not be read.';
  }

  function countBy(rows) {
    var counts = { total: rows.length, ok: 0, duplicate: 0, invalid: 0 };
    rows.forEach(function (row) { counts[row.status]++; });
    return counts;
  }

  /* --------------------------------------------------------------- commit */

  /**
   * Write the importable rows. Returns { imported, failed }.
   *
   * Rows go through the ordinary Students.create, so every rule that applies
   * to the Add Student form applies here too — there is no second, weaker path
   * into the register. The caller still waits on UI.afterSave() before telling
   * anyone it worked.
   */
  function commit(prepared) {
    var Students = window.SchoolDB.Students;
    var imported = [];
    var failed = [];

    prepared.rows.forEach(function (row) {
      if (row.status !== 'ok') return;
      var result = Students.create(row.values);
      if (result.ok) imported.push(result.student);
      else failed.push({ line: row.line, note: firstError(result.errors) });
    });

    return { imported: imported, failed: failed };
  }

  window.SchoolImport = {
    COLUMNS: COLUMNS,
    load: load,
    readFile: readFile,
    parse: parse,
    prepare: prepare,
    commit: commit,
    _cellText: cellText,
    _mapColumns: mapColumns
  };

}(window, document));
