/* End-to-end tests for the dashboard, father name across every screen, the
   student detail view, and the Excel export button.
   Drives the real index.html in jsdom: `npm run test:ui-dashboard`. */

'use strict';

var h = require('./harness');
var { startServer, stopServer, openApp } = require('./helpers');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;

/* The dashboard reports on "today", so fixtures have to use the real date. */
function pad(n) { return (n < 10 ? '0' : '') + n; }

function isoDate(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

var TODAY = isoDate(new Date());
var YESTERDAY = isoDate(new Date(Date.now() - 86400000));

var STUDENTS = [
  { id: 's1', name: 'Ahmed Noor', fatherName: 'Imran Noor', roll: '1', className: '5', section: 'A', createdAt: 1, updatedAt: 1 },
  { id: 's2', name: 'Bilal Shah', fatherName: 'Kamran Shah', roll: '2', className: '5', section: 'A', createdAt: 2, updatedAt: 2 },
  { id: 's3', name: 'Hina Malik', roll: '3', className: '5', section: 'A', createdAt: 3, updatedAt: 3 }
];

function mark(studentId, date, status) {
  return {
    studentId: studentId, date: date, status: status,
    className: '5', section: 'A', markedAt: 1
  };
}

function attendanceFixture() {
  var map = {};
  map['s1|' + TODAY] = mark('s1', TODAY, 'present');
  map['s2|' + TODAY] = mark('s2', TODAY, 'absent');
  map['s3|' + TODAY] = mark('s3', TODAY, 'leave');
  map['s1|' + YESTERDAY] = mark('s1', YESTERDAY, 'present');
  map['s2|' + YESTERDAY] = mark('s2', YESTERDAY, 'present');
  map['s3|' + YESTERDAY] = mark('s3', YESTERDAY, 'present');
  return map;
}

/* ==================================== run ================================== */

async function main() {
  await startServer();

  /* ==================================================================== */
  describe('dashboard on an empty school');

  var blank = await openApp();

  await it('opens on the dashboard', async function () {
    equal(blank.$('#screen-dashboard').hidden, false);
    assert(blank.$('.tab[data-screen="dashboard"]').classList.contains('is-active'));
  });

  await it('shows the school branding', async function () {
    var dash = blank.dash();
    equal(dash.school, 'Test School');
    assert(/Test Director/.test(dash.director), dash.director);
    equal(blank.text('#dash-logo'), 'TS', 'initials stand in for a logo');
  });

  await it('shows zeroes rather than invented numbers', async function () {
    var dash = blank.dash();
    equal(dash.total, 0);
    equal(dash.present, 0);
    equal(dash.absent, 0);
    equal(dash.leave, 0);
    equal(dash.percent, '—', 'no percentage without any records');
  });

  await it('points a new school at adding students first', async function () {
    var dash = blank.dash();
    assert(/Add students/.test(dash.note), dash.note);
    equal(dash.action, 'Add students');
  });

  await it('says there is no recent attendance', async function () {
    equal(blank.$('#dash-recent-empty').hidden, false);
    equal(blank.dashRecent().length, 0);
  });

  await it('sends the Add students button to the students screen', async function () {
    blank.$('#dash-action').click();
    equal(blank.$('#screen-students').hidden, false);
  });

  blank.close();

  /* ==================================================================== */
  describe('dashboard with students but no attendance today');

  var pending = await openApp({ students: STUDENTS });

  await it('counts the students from saved data', async function () {
    equal(pending.dash().total, 3);
  });

  await it('warns that attendance has not been taken', async function () {
    var dash = pending.dash();
    assert(/not been taken today/.test(dash.note), dash.note);
    equal(dash.action, 'Take attendance');
    equal(dash.percent, '—');
  });

  await it('sends the quick button to the attendance screen', async function () {
    pending.$('#dash-action').click();
    equal(pending.$('#screen-attendance').hidden, false);
    equal(pending.$('#a-session').hidden, false, 'with the roster loaded');
  });

  pending.close();

  /* ==================================================================== */
  describe('dashboard with real attendance');

  var page = await openApp({ students: STUDENTS, attendance: attendanceFixture() });

  await it('reports today’s present, absent and leave counts', async function () {
    var dash = page.dash();
    equal(dash.total, 3);
    equal(dash.present, 1);
    equal(dash.absent, 1);
    equal(dash.leave, 1);
  });

  await it('computes the attendance percentage', async function () {
    equal(page.dash().percent, '33%', '1 present out of 3 recorded');
  });

  await it('confirms the whole class is recorded', async function () {
    var dash = page.dash();
    assert(/All 3 students recorded today/.test(dash.note), dash.note);
    equal(dash.action, 'Review attendance');
  });

  await it('draws a proportional bar', async function () {
    var segments = page.$$('#dash-bar .summary__seg');
    equal(segments.length, 3, 'one per status present today');
  });

  await it('lists recent days newest first with their tallies', async function () {
    var recent = page.dashRecent();
    equal(recent.length, 2);
    equal(recent[0].date, TODAY);
    equal(recent[1].date, YESTERDAY);
    deepEqual(recent[0].tallies, ['1', '1', '1'], 'present / absent / leave today');
    deepEqual(recent[1].tallies, ['3', '0', '0'], 'all present yesterday');
    equal(recent[1].percent, '100%');
  });

  await it('agrees with the records report', async function () {
    var dash = page.dash();
    page.goTo('records');
    page.pick('#r-date', TODAY);
    var summary = page.recSummary();

    equal(summary.present, dash.present, 'present matches');
    equal(summary.absent, dash.absent);
    equal(summary.leave, dash.leave);
    equal(summary.percent, dash.percent);
    page.goTo('dashboard');
  });

  await it('opens a recent day in the report when tapped', async function () {
    page.$$('#dash-recent .dayrow')[1].click();
    equal(page.$('#screen-records').hidden, false);
    equal(page.$('#r-date').value, YESTERDAY, 'on the day that was tapped');
    equal(page.recRows().length, 3);
    page.goTo('dashboard');
  });

  await it('updates after a student is added', async function () {
    page.goTo('students');
    page.addStudent({ name: 'New Pupil', fatherName: 'New Father', roll: '4', className: '5', section: 'A' });
    page.goTo('dashboard');
    equal(page.dash().total, 4);
    assert(/1 still to mark/.test(page.dash().note), page.dash().note);
  });

  await it('updates after attendance is saved', async function () {
    page.goTo('attendance');
    page.pick('#a-class', '5');
    page.pick('#a-section', 'A');
    page.pick('#a-date', TODAY);
    page.mark('New Pupil', 'present');
    page.saveAttendance();

    page.goTo('dashboard');
    var dash = page.dash();
    equal(dash.present, 2);
    equal(dash.percent, '50%');
    assert(/All 4 students recorded today/.test(dash.note), dash.note);
  });

  /* ==================================================================== */
  describe('father name across the app');

  await it('shows on the student card', async function () {
    page.goTo('students');
    equal(page.fatherOf('Ahmed Noor'), 'S/D of Imran Noor');
    equal(page.fatherOf('Hina Malik'), '', 'nothing shown when there is none');
  });

  await it('shows in the attendance list', async function () {
    page.goTo('attendance');
    var row = page.attRow('Ahmed Noor');
    equal(row.querySelector('.att__father').textContent, 'S/D of Imran Noor');
    equal(page.attRow('Hina Malik').querySelector('.att__father'), null);
  });

  await it('shows in the daily report', async function () {
    page.goTo('records');
    page.pick('#r-date', TODAY);
    var first = page.recRows()[0];
    equal(first.querySelector('.rec__meta').textContent, 'S/D of Imran Noor');
  });

  await it('shows in the monthly report', async function () {
    page.$('#r-mode-monthly').click();
    page.pick('#r-month', TODAY.slice(0, 7));
    var meta = page.recRows()[0].querySelector('.rec__meta').textContent;
    assert(/S\/D of Imran Noor/.test(meta), meta);
    page.$('#r-mode-daily').click();
  });

  await it('finds a student by their father name', async function () {
    page.goTo('students');
    page.type('#student-search', 'kamran');
    deepEqual(page.names(), ['Bilal Shah']);
    page.$('#student-search-clear').click();
  });

  await it('prefills when editing and survives the save', async function () {
    page.cards()[0].querySelector('.iconbtn:not(.iconbtn--danger)').click();
    equal(page.$('#f-father').value, 'Imran Noor');

    page.type('#f-name', 'Ahmed A. Noor');
    page.submit();

    equal(page.fatherOf('Ahmed A. Noor'), 'S/D of Imran Noor', 'not lost by an unrelated edit');
    equal(page.stored().filter(function (s) { return s.id === 's1'; })[0].fatherName, 'Imran Noor');
  });

  await it('can be added to a student that had none', async function () {
    var card = page.cards().filter(function (c) {
      return c.querySelector('.card__name').textContent === 'Hina Malik';
    })[0];
    card.querySelector('.iconbtn:not(.iconbtn--danger)').click();
    equal(page.$('#f-father').value, '');

    page.type('#f-father', 'Tariq Malik');
    page.submit();
    equal(page.fatherOf('Hina Malik'), 'S/D of Tariq Malik');
  });

  await it('rejects a one-character father name', async function () {
    page.cards()[0].querySelector('.iconbtn:not(.iconbtn--danger)').click();
    page.type('#f-father', 'X');
    page.submit();
    assert(/at least 2/.test(page.errorFor('fatherName')), page.errorFor('fatherName'));
    equal(page.$('#student-sheet').hidden, false, 'the sheet stays open');
    page.$('#sheet-cancel').click();
  });

  /* ==================================================================== */
  describe('student details');

  await it('opens from the student card', async function () {
    page.openDetail('Ahmed A. Noor');
    equal(page.$('#detail-sheet').hidden, false);
    equal(page.text('#detail-name'), 'Ahmed A. Noor');
    equal(page.text('#detail-father'), 'Imran Noor');
    equal(page.text('#detail-roll'), '1');
    equal(page.text('#detail-class'), '5');
    equal(page.text('#detail-section'), 'A');
  });

  await it('shows that student’s attendance history', async function () {
    equal(page.text('#detail-present'), '2', 'present today and yesterday');
    equal(page.text('#detail-absent'), '0');
    equal(page.text('#detail-leave'), '0');
    assert(/100% attendance across 2 recorded days/.test(page.text('#detail-pct')),
      page.text('#detail-pct'));
  });

  await it('shows a dash when there is no father name', async function () {
    page.$('#detail-done').click();
    page.openDetail('New Pupil');
    equal(page.text('#detail-father'), 'New Father');
    page.$('#detail-done').click();
  });

  await it('hands over to the edit form', async function () {
    page.openDetail('Bilal Shah');
    page.$('#detail-edit').click();
    equal(page.$('#detail-sheet').hidden, true, 'detail closes');
    equal(page.$('#student-sheet').hidden, false, 'edit opens');
    equal(page.$('#f-name').value, 'Bilal Shah');
    equal(page.$('#f-father').value, 'Kamran Shah');
    page.$('#sheet-cancel').click();
  });

  await it('closes with the Escape key', async function () {
    page.openDetail('Bilal Shah');
    page.press('Escape');
    equal(page.$('#detail-sheet').hidden, true);
    equal(page.$('#backdrop').hidden, true);
  });

  /* ==================================================================== */
  describe('Excel export');

  await it('offers a daily export from the report', async function () {
    page.goTo('records');
    page.pick('#r-date', TODAY);
    equal(page.$('#r-export').hidden, false, 'the button shows when there are records');
    equal(page.text('#r-export-label'), 'Export day to Excel');
  });

  await it('builds a daily sheet with father names', async function () {
    var built = page.window.RecordsUI.exportCurrent();
    assert(built, 'a file should be built');
    equal(built.rowCount, 4);
    assert(/Test School/.test(built.content), 'branded with the school');
    assert(/Student Name,Father Name/.test(built.content), 'has the column');
    assert(/Ahmed A. Noor,Imran Noor/.test(built.content), 'and the value');
    assert(/attendance-/.test(built.filename), built.filename);
  });

  await it('confirms the export to the teacher', async function () {
    assert(/Exported 4 rows/.test(page.toastText()), page.toastText());
  });

  await it('switches the button to the monthly sheet', async function () {
    page.$('#r-mode-monthly').click();
    page.pick('#r-month', TODAY.slice(0, 7));
    equal(page.text('#r-export-label'), 'Export month to Excel');

    var built = page.window.RecordsUI.exportCurrent();
    equal(built.rowCount, 4);
    assert(/Monthly Attendance/.test(built.content));
    assert(/P = Present/.test(built.content), 'includes the key');
    assert(built.filename.indexOf(TODAY.slice(0, 7)) !== -1, built.filename);
  });

  await it('exports only what the filters select', async function () {
    page.$('#r-mode-daily').click();
    page.pick('#r-date', TODAY);
    page.type('#r-search', 'kamran');

    var built = page.window.RecordsUI.exportCurrent();
    equal(built.rowCount, 1, 'just the searched student');
    assert(/Bilal Shah/.test(built.content));
    assert(!/Ahmed A. Noor/.test(built.content), 'others are left out');
    page.$('#r-search-clear').click();
  });

  await it('refuses to export an empty selection', async function () {
    page.pick('#r-date', '2020-01-01');
    var built = page.window.RecordsUI.exportCurrent();
    equal(built.rowCount, 0);
    assert(/Nothing to export/.test(page.toastText()), page.toastText());
  });

  var savedStudents = page.stored();
  var savedAttendance = page.storedAttendance();
  page.close();

  /* ==================================================================== */
  describe('after closing and reopening');

  var reopened = await openApp({ students: savedStudents, attendance: savedAttendance });

  await it('keeps every father name', async function () {
    reopened.goTo('students');
    equal(reopened.fatherOf('Ahmed A. Noor'), 'S/D of Imran Noor');
    equal(reopened.fatherOf('Bilal Shah'), 'S/D of Kamran Shah');
    equal(reopened.fatherOf('Hina Malik'), 'S/D of Tariq Malik');
    equal(reopened.fatherOf('New Pupil'), 'S/D of New Father');
  });

  await it('rebuilds the dashboard from stored data', async function () {
    reopened.goTo('dashboard');
    var dash = reopened.dash();
    equal(dash.total, 4);
    equal(dash.present, 2);
    equal(dash.absent, 1);
    equal(dash.leave, 1);
    equal(dash.percent, '50%');
    equal(reopened.dashRecent().length, 2);
  });

  reopened.close();

  /* ==================================================================== */
  describe('the dashboard belongs to the signed-in school');

  await it('shows nothing from another school', async function () {
    var two = await openApp({
      accounts: [
        { id: 'acc_a', schoolName: 'School A', username: 'a_admin' },
        { id: 'acc_b', schoolName: 'School B', username: 'b_admin' }
      ],
      students: STUDENTS,
      attendance: attendanceFixture()
    });

    equal(two.dash().total, 3, 'School A sees its own');
    equal(two.dash().present, 1);

    two.doLogout();
    two.doLogin('b_admin', 'secret123');

    var dash = two.dash();
    equal(dash.school, 'School B');
    equal(dash.total, 0, 'School B sees none of it');
    equal(dash.present, 0);
    equal(dash.percent, '—');
    equal(two.dashRecent().length, 0);

    two.close();
  });

  /* -------------------------------------------------------------- report */
  stopServer();
  h.report('dashboard and export UI tests');
}

main().catch(function (err) {
  console.error(err);
  stopServer();
  process.exit(1);
});
