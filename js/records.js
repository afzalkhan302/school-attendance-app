/* ==========================================================================
   records.js — browsing saved attendance.

   Two modes over the same filters: Daily shows every student's status for one
   date, Monthly rolls a whole month up into per-student totals.
   ========================================================================== */

(function (window, document) {
  'use strict';

  var DB = window.SchoolDB;
  var Students = DB.Students;
  var Attendance = DB.Attendance;
  var util = DB.util;

  var ANY = '';                 // value of the "All classes / All sections" option

  var el = {};
  var mode = 'daily';           // 'daily' | 'monthly'
  var started = false;

  function $(id) { return document.getElementById(id); }

  /* -------------------------------------------------------------- filters */

  function fillFilterSelect(select, values, allLabel) {
    var previous = select.value;
    select.textContent = '';

    var any = document.createElement('option');
    any.value = ANY;
    any.textContent = allLabel;
    select.appendChild(any);

    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });

    select.value = values.indexOf(previous) !== -1 ? previous : ANY;
  }

  function syncFilters() {
    fillFilterSelect(el.classSelect, Students.classes(), 'All classes');
    fillFilterSelect(el.sectionSelect, Students.sections(), 'All sections');
  }

  function filters() {
    return {
      className: el.classSelect.value || undefined,
      section: el.sectionSelect.value || undefined,
      term: el.search.value
    };
  }

  /* --------------------------------------------------------------- pieces */

  function chip(text) {
    var span = document.createElement('span');
    span.className = 'chip';
    span.textContent = text;
    return span;
  }

  function pill(status) {
    var span = document.createElement('span');
    span.className = 'pill pill--' + status;
    span.textContent = Attendance.STATUS_LABELS[status];
    return span;
  }

  function recordBody(name, meta) {
    var body = document.createElement('div');
    body.className = 'rec__body';

    var nameEl = document.createElement('p');
    nameEl.className = 'rec__name';
    nameEl.textContent = name;
    body.appendChild(nameEl);

    var metaEl = document.createElement('p');
    metaEl.className = 'rec__meta';
    metaEl.textContent = meta;
    body.appendChild(metaEl);

    return body;
  }

  function paintSummary(title, tally) {
    var account = window.SchoolDB.Auth.current();

    el.summary.hidden = false;
    // Reports carry the school name, the same way an exported sheet will.
    el.summarySchool.textContent = account ? account.schoolName : '';
    el.summaryTitle.textContent = title;
    el.sPresent.textContent = String(tally.present);
    el.sAbsent.textContent = String(tally.absent);
    el.sLeave.textContent = String(tally.leave);
    el.sPct.textContent = tally.percent + '%';

    // Proportional bar: present / absent / leave.
    el.summaryBar.textContent = '';
    if (!tally.total) return;

    [['present', tally.present], ['absent', tally.absent], ['leave', tally.leave]]
      .forEach(function (pair) {
        if (!pair[1]) return;
        var segment = document.createElement('span');
        segment.className = 'summary__seg summary__seg--' + pair[0];
        segment.style.width = ((pair[1] / tally.total) * 100) + '%';
        el.summaryBar.appendChild(segment);
      });
  }

  /* ---------------------------------------------------------- daily view */

  function renderDaily() {
    var date = el.date.value;

    if (!util.isISODate(date)) {
      showEmpty('Pick a date', 'Choose a date to see that day’s attendance.');
      return;
    }

    var options = filters();
    options.date = date;

    var rows = Attendance.records(options);

    if (!rows.length) {
      showEmpty('No attendance for this day',
        'Nothing was recorded for ' + util.formatDate(date) + scopeSuffix() + '.');
      return;
    }

    paintSummary(util.formatDate(date), Attendance.summarise(rows));

    var fragment = document.createDocumentFragment();
    var lastGroup = null;

    rows.forEach(function (record) {
      var groupLabel = 'Class ' + record.className + ' · Section ' + record.section;
      if (groupLabel !== lastGroup) {
        lastGroup = groupLabel;
        fragment.appendChild(groupHead(groupLabel));
      }

      var row = document.createElement('div');
      row.className = 'rec';
      row.appendChild(chip(record.roll));
      row.appendChild(recordBody(record.name, record.fatherName
        ? 'S/D of ' + record.fatherName
        : 'Roll ' + record.roll));
      row.appendChild(pill(record.status));
      fragment.appendChild(row);
    });

    showList(fragment, rows.length + (rows.length === 1 ? ' record' : ' records'));
  }

  /* -------------------------------------------------------- monthly view */

  function renderMonthly() {
    var month = el.month.value;

    if (!util.isISOMonth(month)) {
      showEmpty('Pick a month', 'Choose a month to see the summary.');
      return;
    }

    var options = filters();
    var students = Attendance.monthlySummary(month, options);

    if (!students.length) {
      showEmpty('No attendance this month',
        'Nothing was recorded in ' + util.formatMonth(month) + scopeSuffix() + '.');
      return;
    }

    var totals = { present: 0, absent: 0, leave: 0, total: 0, percent: 0 };
    students.forEach(function (entry) {
      totals.present += entry.present;
      totals.absent += entry.absent;
      totals.leave += entry.leave;
      totals.total += entry.total;
    });
    totals.percent = totals.total ? Math.round((totals.present / totals.total) * 100) : 0;

    paintSummary(util.formatMonth(month), totals);

    var fragment = document.createDocumentFragment();
    var lastGroup = null;

    students.forEach(function (entry) {
      var groupLabel = 'Class ' + entry.className + ' · Section ' + entry.section;
      if (groupLabel !== lastGroup) {
        lastGroup = groupLabel;
        fragment.appendChild(groupHead(groupLabel));
      }

      var row = document.createElement('div');
      row.className = 'rec rec--month';
      row.appendChild(chip(entry.roll));
      row.appendChild(recordBody(
        entry.name,
        (entry.fatherName ? 'S/D of ' + entry.fatherName + ' · ' : '') +
        entry.total + (entry.total === 1 ? ' day' : ' days')
      ));

      var stats = document.createElement('div');
      stats.className = 'rec__stats';

      [['present', entry.present], ['absent', entry.absent], ['leave', entry.leave]]
        .forEach(function (pair) {
          var stat = document.createElement('span');
          stat.className = 'tally tally--' + pair[0];
          stat.textContent = String(pair[1]);
          stat.title = Attendance.STATUS_LABELS[pair[0]];
          stats.appendChild(stat);
        });

      var pct = document.createElement('span');
      pct.className = 'rec__pct';
      pct.textContent = entry.percent + '%';
      stats.appendChild(pct);

      row.appendChild(stats);
      fragment.appendChild(row);
    });

    showList(fragment, students.length + (students.length === 1 ? ' student' : ' students'));
  }

  /* --------------------------------------------------------------- shared */

  function groupHead(label) {
    var head = document.createElement('div');
    head.className = 'group__head';
    var span = document.createElement('span');
    span.textContent = label;
    head.appendChild(span);
    return head;
  }

  /** " in Class 5 · Section A" — describes the active class/section filter. */
  function scopeSuffix() {
    var className = el.classSelect.value;
    var section = el.sectionSelect.value;
    var term = util.text(el.search.value);

    var parts = [];
    if (className) parts.push('Class ' + className);
    if (section) parts.push('Section ' + section);

    var out = parts.length ? ' for ' + parts.join(' · ') : '';
    if (term) out += ' matching “' + term + '”';
    return out;
  }

  function showEmpty(title, text) {
    el.list.textContent = '';
    el.summary.hidden = true;
    el.empty.hidden = false;
    el.emptyTitle.textContent = title;
    el.emptyText.textContent = text;
    window.UI.setSubtitle('records', 'Attendance records');
  }

  function showList(fragment, subtitle) {
    el.empty.hidden = true;
    el.list.textContent = '';
    el.list.appendChild(fragment);
    window.UI.setSubtitle('records', subtitle);
  }

  function render() {
    el.searchClear.hidden = util.text(el.search.value) === '';
    if (mode === 'daily') renderDaily();
    else renderMonthly();
  }

  /* --------------------------------------------------------------- export */

  /**
   * Build the sheet for whichever report is on screen and hand it to the
   * browser. Returns the built file so tests can inspect it without needing a
   * download to actually happen.
   */
  function exportCurrent() {
    var Export = window.SchoolExport;
    var options = { filters: filters() };

    var built;
    if (mode === 'daily') {
      if (!util.isISODate(el.date.value)) {
        window.UI.toast('Choose a date first.', 'error');
        return null;
      }
      options.date = el.date.value;
      built = Export.daily(options);
    } else {
      if (!util.isISOMonth(el.month.value)) {
        window.UI.toast('Choose a month first.', 'error');
        return null;
      }
      options.month = el.month.value;
      built = Export.monthly(options);
    }

    if (!built.rowCount) {
      window.UI.toast('Nothing to export for this selection.', 'error');
      return built;
    }

    window.UI.download(built.filename, built.content);
    window.UI.toast('Exported ' + built.rowCount +
      (built.rowCount === 1 ? ' row' : ' rows') + ' to ' + built.filename);

    return built;
  }

  function setMode(next) {
    if (mode === next) return;
    mode = next;

    var daily = mode === 'daily';
    el.modeDaily.classList.toggle('is-active', daily);
    el.modeMonthly.classList.toggle('is-active', !daily);
    el.modeDaily.setAttribute('aria-selected', daily ? 'true' : 'false');
    el.modeMonthly.setAttribute('aria-selected', daily ? 'false' : 'true');
    el.dateField.hidden = !daily;
    el.monthField.hidden = daily;
    el.exportLabel.textContent = daily ? 'Export day to Excel' : 'Export month to Excel';

    render();
  }

  /** Jump straight to one date in the daily report (used by the dashboard). */
  function showDate(date) {
    if (!util.isISODate(date)) return;
    setMode('daily');
    el.date.value = date;
    render();
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    if (started) return;
    started = true;

    el.modeDaily = $('r-mode-daily');
    el.modeMonthly = $('r-mode-monthly');
    el.dateField = $('r-date-field');
    el.monthField = $('r-month-field');
    el.date = $('r-date');
    el.month = $('r-month');
    el.classSelect = $('r-class');
    el.sectionSelect = $('r-section');
    el.search = $('r-search');
    el.searchClear = $('r-search-clear');
    el.summary = $('r-summary');
    el.summarySchool = $('r-summary-school');
    el.summaryTitle = $('r-summary-title');
    el.summaryBar = $('r-summary-bar');
    el.sPresent = $('r-s-present');
    el.sAbsent = $('r-s-absent');
    el.sLeave = $('r-s-leave');
    el.sPct = $('r-s-pct');
    el.list = $('r-list');
    el.empty = $('r-empty');
    el.emptyTitle = $('r-empty-title');
    el.emptyText = $('r-empty-text');
    el.exportButton = $('r-export');
    el.exportLabel = $('r-export-label');

    el.date.value = util.today();
    el.month.value = util.thisMonth();

    el.modeDaily.addEventListener('click', function () { setMode('daily'); });
    el.modeMonthly.addEventListener('click', function () { setMode('monthly'); });
    el.exportButton.addEventListener('click', exportCurrent);

    el.date.addEventListener('change', render);
    el.month.addEventListener('change', render);
    el.classSelect.addEventListener('change', render);
    el.sectionSelect.addEventListener('change', render);
    el.search.addEventListener('input', render);
    el.searchClear.addEventListener('click', function () {
      el.search.value = '';
      render();
      el.search.focus();
    });

    window.UI.onEnter('records', function () {
      syncFilters();
      render();
    });

    window.UI.on('students-changed', syncFilters);
    window.UI.on('attendance-changed', function () {
      if (window.UI.activeScreen() === 'records') render();
    });

    // Another school's filters and results must not carry over.
    window.UI.on('account-changed', function () {
      el.search.value = '';
      el.classSelect.value = '';
      el.sectionSelect.value = '';
      el.date.value = util.today();
      el.month.value = util.thisMonth();
      setMode('daily');
      syncFilters();
      render();
    });

    syncFilters();
  }

  window.RecordsUI = {
    init: init,
    render: render,
    setMode: setMode,
    showDate: showDate,
    exportCurrent: exportCurrent,
    mode: function () { return mode; }
  };

  function boot() { if (window.UI) init(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

}(window, document));
