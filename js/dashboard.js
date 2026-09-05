/* ==========================================================================
   dashboard.js — the home screen.

   Every figure is computed from the school's saved records at render time,
   through the same Attendance API the reports use, so the dashboard and the
   reports can never disagree. Nothing here is cached or stubbed.
   ========================================================================== */

(function (window, document) {
  'use strict';

  var DB = window.SchoolDB;
  var Students = DB.Students;
  var Attendance = DB.Attendance;
  var util = DB.util;

  var RECENT_DAYS = 5;

  var el = {};
  var started = false;

  function $(id) { return document.getElementById(id); }

  /* --------------------------------------------------------------- render */

  function render() {
    if (!DB.Auth.isSignedIn()) return;

    var account = DB.Auth.current();
    var today = util.today();

    el.school.textContent = account.schoolName;
    el.director.textContent = account.directorName ? 'Director: ' + account.directorName : '';
    el.today.textContent = util.formatDate(today);
    window.UI.paintMark(el.logo, account);

    var totalStudents = Students.all().length;
    var todayRows = Attendance.records({ date: today });
    var tally = Attendance.summarise(todayRows);

    el.total.textContent = String(totalStudents);
    el.present.textContent = String(tally.present);
    el.absent.textContent = String(tally.absent);
    el.leave.textContent = String(tally.leave);
    el.percent.textContent = tally.total ? tally.percent + '%' : '—';

    paintTodayState(totalStudents, tally);
    paintRecent();

    window.UI.setSubtitle('dashboard',
      totalStudents === 1 ? '1 student' : totalStudents + ' students');
  }

  function paintTodayState(totalStudents, tally) {
    var bar = el.bar;
    bar.textContent = '';

    if (!totalStudents) {
      el.todayNote.textContent = 'Add students to get started.';
      el.todayNote.className = 'dash__note';
      el.action.textContent = 'Add students';
      el.action.setAttribute('data-goes', 'students');
      return;
    }

    if (!tally.total) {
      el.todayNote.textContent = 'Attendance has not been taken today.';
      el.todayNote.className = 'dash__note dash__note--warn';
      el.action.textContent = 'Take attendance';
      el.action.setAttribute('data-goes', 'attendance');
      return;
    }

    var unmarked = totalStudents - tally.total;
    el.todayNote.textContent = unmarked > 0
      ? tally.total + ' of ' + totalStudents + ' students recorded today · ' +
        unmarked + ' still to mark'
      : 'All ' + totalStudents + ' students recorded today.';
    el.todayNote.className = 'dash__note' + (unmarked > 0 ? ' dash__note--warn' : ' dash__note--ok');

    el.action.textContent = unmarked > 0 ? 'Continue attendance' : 'Review attendance';
    el.action.setAttribute('data-goes', 'attendance');

    [['present', tally.present], ['absent', tally.absent], ['leave', tally.leave]]
      .forEach(function (pair) {
        if (!pair[1]) return;
        var segment = document.createElement('span');
        segment.className = 'summary__seg summary__seg--' + pair[0];
        segment.style.width = ((pair[1] / tally.total) * 100) + '%';
        bar.appendChild(segment);
      });
  }

  function paintRecent() {
    var days = Attendance.dailyTotals(RECENT_DAYS);

    el.recent.textContent = '';
    el.recentEmpty.hidden = days.length > 0;
    el.recentCard.hidden = false;

    days.forEach(function (day) {
      var rowEl = document.createElement('button');
      rowEl.type = 'button';
      rowEl.className = 'dayrow';
      rowEl.setAttribute('data-date', day.date);
      rowEl.setAttribute('aria-label', 'Open the report for ' + util.formatDate(day.date));

      var left = document.createElement('div');
      left.className = 'dayrow__main';

      var date = document.createElement('p');
      date.className = 'dayrow__date';
      date.textContent = util.formatDate(day.date);
      left.appendChild(date);

      var meta = document.createElement('p');
      meta.className = 'dayrow__meta';
      meta.textContent = day.total + (day.total === 1 ? ' student' : ' students') + ' recorded';
      left.appendChild(meta);

      rowEl.appendChild(left);

      var stats = document.createElement('div');
      stats.className = 'dayrow__stats';

      [['present', day.present], ['absent', day.absent], ['leave', day.leave]]
        .forEach(function (pair) {
          var stat = document.createElement('span');
          stat.className = 'tally tally--' + pair[0];
          stat.textContent = String(pair[1]);
          stat.title = pair[0];
          stats.appendChild(stat);
        });

      var pct = document.createElement('span');
      pct.className = 'dayrow__pct';
      pct.textContent = day.percent + '%';
      stats.appendChild(pct);

      rowEl.appendChild(stats);

      rowEl.addEventListener('click', function () {
        window.UI.openRecordsOn(this.getAttribute('data-date'));
      });

      el.recent.appendChild(rowEl);
    });
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    if (started) return;
    started = true;

    el.school = $('dash-school');
    el.director = $('dash-director');
    el.today = $('dash-today');
    el.logo = $('dash-logo');

    el.total = $('dash-total');
    el.present = $('dash-present');
    el.absent = $('dash-absent');
    el.leave = $('dash-leave');
    el.percent = $('dash-percent');

    el.bar = $('dash-bar');
    el.todayNote = $('dash-today-note');
    el.action = $('dash-action');

    el.recent = $('dash-recent');
    el.recentCard = $('dash-recent-card');
    el.recentEmpty = $('dash-recent-empty');

    el.action.addEventListener('click', function () {
      window.UI.showScreen(this.getAttribute('data-goes') || 'attendance');
    });

    $('dash-all-records').addEventListener('click', function () {
      window.UI.showScreen('records');
    });

    window.UI.onEnter('dashboard', render);

    // Any change to students, attendance, branding or the account moves these
    // numbers, so redraw whenever the dashboard is the visible screen.
    ['students-changed', 'attendance-changed', 'branding-changed'].forEach(function (event) {
      window.UI.on(event, function () {
        if (window.UI.activeScreen() === 'dashboard') render();
      });
    });

    window.UI.on('account-changed', function () {
      if (DB.Auth.isSignedIn()) render();
    });
  }

  window.DashboardUI = { init: init, render: render };

}(window, document));
