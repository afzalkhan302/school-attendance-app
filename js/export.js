/* ==========================================================================
   export.js — daily and monthly attendance sheets for Excel.

   Emits CSV rather than a real .xlsx: a spreadsheet is a ZIP archive, and
   building one would mean shipping a compression library into an app that
   otherwise has no dependencies and must run offline. Excel, LibreOffice and
   Google Sheets all open these directly, and the byte-order mark on the front
   is what makes Excel read them as UTF-8 so non-ASCII names survive.

   Pure string building — no DOM — so the output can be asserted in tests.
   ========================================================================== */

(function (global) {
  'use strict';

  var BOM = '﻿';
  var CRLF = '\r\n';   // Excel is happiest with CRLF

  var STATUS_LABELS = { present: 'Present', absent: 'Absent', leave: 'Leave' };
  var STATUS_SHORT = { present: 'P', absent: 'A', leave: 'L' };

  /**
   * Quote a CSV cell. Beyond the usual quoting, a leading =, +, - or @ is
   * prefixed with an apostrophe: spreadsheets treat those as formulas, and a
   * student name is never a formula.
   */
  function cell(value) {
    var text = value === null || value === undefined ? '' : String(value);

    if (/^[=+\-@]/.test(text)) text = "'" + text;

    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function row(values) {
    return values.map(cell).join(',');
  }

  function build(lines) {
    return BOM + lines.join(CRLF) + CRLF;
  }

  /** Heading block naming the school, so a printed sheet identifies itself. */
  function heading(account, title, scope, generatedOn) {
    var lines = [];

    lines.push(row([account && account.schoolName ? account.schoolName : 'School']));
    if (account && account.directorName) {
      lines.push(row(['Director', account.directorName]));
    }
    lines.push(row([title]));
    lines.push(row(['Scope', scope]));
    lines.push(row(['Generated', generatedOn]));
    lines.push('');

    return lines;
  }

  /** Describes the class/section/search filters in force, for the heading. */
  function scopeText(filters) {
    filters = filters || {};
    var parts = [];

    if (filters.className) parts.push('Class ' + filters.className);
    if (filters.section) parts.push('Section ' + filters.section);
    if (!parts.length) parts.push('All classes');
    if (filters.term) parts.push('matching "' + filters.term + '"');

    return parts.join(' · ');
  }

  function fileSafe(value) {
    return String(value || '')
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'school';
  }

  /* ============================== daily sheet ============================= */

  /**
   * One row per student for a single date: roll, name, father name, class,
   * section, status. Ends with a tally so the sheet is usable as-is.
   */
  function daily(options) {
    var DB = options.db || global.SchoolDB;
    var date = options.date;
    var filters = options.filters || {};
    var account = options.account !== undefined ? options.account : DB.Auth.current();

    var query = {
      date: date,
      className: filters.className || undefined,
      section: filters.section || undefined,
      term: filters.term || undefined
    };

    var rows = DB.Attendance.records(query);
    var tally = DB.Attendance.summarise(rows);
    var util = DB.util;

    var lines = heading(account, 'Daily Attendance', scopeText(filters),
      util.formatDate(date) || date);

    lines.push(row(['#', 'Roll No', 'Student Name', 'Father Name', 'Class', 'Section', 'Status']));

    rows.forEach(function (record, index) {
      lines.push(row([
        index + 1,
        record.roll,
        record.name,
        record.fatherName,
        record.className,
        record.section,
        STATUS_LABELS[record.status] || record.status
      ]));
    });

    lines.push('');
    lines.push(row(['Total students', tally.total]));
    lines.push(row(['Present', tally.present]));
    lines.push(row(['Absent', tally.absent]));
    lines.push(row(['Leave', tally.leave]));
    lines.push(row(['Attendance %', tally.percent + '%']));

    return {
      filename: fileSafe(account && account.schoolName) + '-attendance-' + date + '.csv',
      content: build(lines),
      rowCount: rows.length
    };
  }

  /* ============================= monthly sheet ============================ */

  /**
   * A register grid: one row per student, one column per day that has any
   * attendance in the month, then P/A/L totals and a percentage.
   */
  function monthly(options) {
    var DB = options.db || global.SchoolDB;
    var month = options.month;
    var filters = options.filters || {};
    var account = options.account !== undefined ? options.account : DB.Auth.current();
    var util = DB.util;

    var students = DB.Attendance.monthlySummary(month, filters);

    // Only the days actually recorded — a blank column per weekend helps nobody.
    var dates = DB.Attendance.recordedDates({
      month: month,
      className: filters.className || undefined,
      section: filters.section || undefined,
      term: filters.term || undefined
    }).slice().sort();

    var lines = heading(account, 'Monthly Attendance', scopeText(filters),
      util.formatMonth(month) || month);

    var header = ['#', 'Roll No', 'Student Name', 'Father Name', 'Class', 'Section'];
    dates.forEach(function (date) { header.push(Number(date.slice(8, 10))); });
    header.push('Present', 'Absent', 'Leave', 'Days', 'Attendance %');
    lines.push(row(header));

    students.forEach(function (student, index) {
      var byDate = {};
      student.days.forEach(function (day) { byDate[day.date] = day.status; });

      var line = [
        index + 1,
        student.roll,
        student.name,
        student.fatherName,
        student.className,
        student.section
      ];

      dates.forEach(function (date) {
        line.push(byDate[date] ? STATUS_SHORT[byDate[date]] : '');
      });

      line.push(student.present, student.absent, student.leave, student.total,
                student.percent + '%');
      lines.push(row(line));
    });

    lines.push('');
    lines.push(row(['Days recorded', dates.length]));
    lines.push(row(['Students', students.length]));
    lines.push('');
    lines.push(row(['Key', 'P = Present', 'A = Absent', 'L = Leave', 'blank = not recorded']));

    return {
      filename: fileSafe(account && account.schoolName) + '-attendance-' + month + '.csv',
      content: build(lines),
      rowCount: students.length
    };
  }

  global.SchoolExport = {
    daily: daily,
    monthly: monthly,
    cell: cell,
    row: row,
    fileSafe: fileSafe,
    BOM: BOM
  };

}(typeof window !== 'undefined' ? window : globalThis));
