/* End-to-end tests for the attendance and records screens.
   Drives the real index.html in jsdom: `npm run test:ui-attendance`. */

'use strict';

var h = require('./harness');
var { startServer, stopServer, openApp } = require('./helpers');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal, deepEqual = h.deepEqual;

var DAY1 = '2026-09-04';
var DAY2 = '2026-09-07';
var OTHER_MONTH = '2026-10-05';

var CLASS_5A = [
  { name: 'Ahmed Noor', roll: '1', className: '5', section: 'A' },
  { name: 'Bilal Shah', roll: '2', className: '5', section: 'A' },
  { name: 'Hina Malik', roll: '3', className: '5', section: 'A' }
];

var CLASS_6B = [
  { name: 'Sana Tariq', roll: '1', className: '6', section: 'B' },
  { name: 'Zara Ali', roll: '2', className: '6', section: 'B' }
];

/** Open the attendance screen on a specific group and date. */
function openSession(page, className, section, date) {
  page.goTo('attendance');
  page.pick('#a-class', className);
  page.pick('#a-section', section);
  page.pick('#a-date', date);
}

/* ==================================== run ================================== */

async function main() {
  await startServer();

  /* ==================================================================== */
  describe('attendance with an empty register');

  var blank = await openApp();

  await it('tells the teacher to add students first', async function () {
    blank.goTo('attendance');
    equal(blank.$('#screen-attendance').hidden, false);
    equal(blank.$('#a-empty').hidden, false, 'empty state should show');
    equal(blank.$('#a-session').hidden, true, 'no marking UI');
    equal(blank.text('#a-empty-title'), 'No students yet');
    equal(blank.$('#a-empty-action').hidden, false, 'offers a way to the students screen');
  });

  await it('hides the save bar when there is nothing to mark', async function () {
    equal(blank.$('#savebar').hidden, true);
  });

  await it('jumps to the students screen from the empty state', async function () {
    blank.$('#a-empty-action').click();
    equal(blank.$('#screen-students').hidden, false);
    equal(blank.$('#screen-attendance').hidden, true);
  });

  await it('shows no records either', async function () {
    blank.goTo('records');
    equal(blank.$('#r-empty').hidden, false);
    equal(blank.$('#r-summary').hidden, true);
    equal(blank.recRows().length, 0);
  });

  blank.close();

  /* ==================================================================== */
  describe('adding students then taking attendance');

  var page = await openApp();

  await it('adds five students across two classes', async function () {
    CLASS_5A.concat(CLASS_6B).forEach(function (student) { page.addStudent(student); });
    equal(page.stored().length, 5);
    equal(page.text('#student-count'), '5');
  });

  await it('offers only the classes and sections that have students', async function () {
    page.goTo('attendance');
    deepEqual(page.$$('#a-class option').map(function (o) { return o.value; }), ['5', '6']);
    deepEqual(page.$$('#a-section option').map(function (o) { return o.value; }), ['A'],
      'class 5 only has section A');
  });

  await it('switches the section list when the class changes', async function () {
    page.pick('#a-class', '6');
    deepEqual(page.$$('#a-section option').map(function (o) { return o.value; }), ['B']);
    page.pick('#a-class', '5');
    deepEqual(page.$$('#a-section option').map(function (o) { return o.value; }), ['A']);
  });

  await it('loads the roster for the chosen class, section and date', async function () {
    openSession(page, '5', 'A', DAY1);
    equal(page.$('#a-session').hidden, false);
    equal(page.$('#a-empty').hidden, true);
    deepEqual(page.attNames(), ['Ahmed Noor', 'Bilal Shah', 'Hina Malik']);
    assert(/Class 5 · A · Fri, 4 Sep 2026/.test(page.text('#appbar-sub')), page.text('#appbar-sub'));
  });

  await it('starts with everyone unmarked', async function () {
    deepEqual(page.attCounts(), { present: 0, absent: 0, leave: 0, pending: 3 });
    equal(page.markOf('Ahmed Noor'), '');
    assert(/No attendance saved/.test(page.text('#a-note')), page.text('#a-note'));
    equal(page.text('#savebar-info'), 'Mark students, then save');
  });

  await it('gives every student Present, Absent and Leave buttons', async function () {
    var row = page.attRow('Ahmed Noor');
    deepEqual(
      Array.prototype.slice.call(row.querySelectorAll('.seg__btn')).map(function (b) {
        return b.textContent;
      }),
      ['Present', 'Absent', 'Leave']
    );
  });

  await it('marks a student and updates the counts live', async function () {
    page.mark('Ahmed Noor', 'present');
    equal(page.markOf('Ahmed Noor'), 'present');
    deepEqual(page.attCounts(), { present: 1, absent: 0, leave: 0, pending: 2 });

    page.mark('Bilal Shah', 'absent');
    page.mark('Hina Malik', 'leave');
    deepEqual(page.attCounts(), { present: 1, absent: 1, leave: 1, pending: 0 });
  });

  await it('lets a wrong tap be changed', async function () {
    page.mark('Hina Malik', 'present');
    equal(page.markOf('Hina Malik'), 'present');
    deepEqual(page.attCounts(), { present: 2, absent: 1, leave: 0, pending: 0 });
    page.mark('Hina Malik', 'leave');
    deepEqual(page.attCounts(), { present: 1, absent: 1, leave: 1, pending: 0 });
  });

  await it('clears a mark when the active status is tapped again', async function () {
    page.mark('Hina Malik', 'leave');
    equal(page.markOf('Hina Malik'), '');
    deepEqual(page.attCounts(), { present: 1, absent: 1, leave: 0, pending: 1 });
    page.mark('Hina Malik', 'leave');
    deepEqual(page.attCounts(), { present: 1, absent: 1, leave: 1, pending: 0 });
  });

  await it('warns that the marks are unsaved', async function () {
    assert(/unsaved/.test(page.text('#savebar-info')), page.text('#savebar-info'));
    equal(page.attendanceCount(), 0, 'nothing written until save');
  });

  await it('saves the attendance', async function () {
    page.saveAttendance();
    equal(page.confirmOpen(), false, 'everyone marked, so no warning');
    assert(/Attendance saved for Fri, 4 Sep 2026/.test(page.toastText()), page.toastText());
    equal(page.attendanceCount(), 3);
  });

  await it('writes one record per student, keyed by student and date', async function () {
    var stored = page.storedAttendance();
    var keys = Object.keys(stored).sort();
    equal(keys.length, 3);
    keys.forEach(function (key) {
      assert(key.indexOf('|' + DAY1) > 0, 'key should end with the date: ' + key);
      equal(stored[key].date, DAY1);
      equal(stored[key].className, '5');
      equal(stored[key].section, 'A');
    });
  });

  await it('switches the save bar into update mode', async function () {
    assert(/Saved for Fri, 4 Sep 2026/.test(page.text('#savebar-info')), page.text('#savebar-info'));
    equal(page.$('#a-save').textContent, 'Update attendance');
    equal(page.$('#a-save').disabled, true, 'nothing left to save');
    assert(/already saved/.test(page.text('#a-note')), page.text('#a-note'));
  });

  var savedStudents = page.stored();
  var savedAttendance = page.storedAttendance();

  /* ==================================================================== */
  describe('mark all present');

  await it('marks the whole class in one tap', async function () {
    openSession(page, '6', 'B', DAY1);
    deepEqual(page.attCounts(), { present: 0, absent: 0, leave: 0, pending: 2 });

    page.$('#a-all-present').click();
    deepEqual(page.attCounts(), { present: 2, absent: 0, leave: 0, pending: 0 });
    equal(page.markOf('Sana Tariq'), 'present');
    equal(page.markOf('Zara Ali'), 'present');
    assert(/All 2 marked present/.test(page.toastText()), page.toastText());
  });

  await it('still needs saving afterwards', async function () {
    assert(/unsaved/.test(page.text('#savebar-info')), page.text('#savebar-info'));
    equal(page.attendanceCount(), 3, 'only the 5-A records so far');
    page.saveAttendance();
    equal(page.attendanceCount(), 5);
  });

  await it('keeps the two classes separate', async function () {
    openSession(page, '5', 'A', DAY1);
    equal(page.markOf('Bilal Shah'), 'absent', '5-A is untouched by the 6-B save');
  });

  /* ==================================================================== */
  describe('saving with students still unmarked');

  await it('asks before saving an incomplete session', async function () {
    openSession(page, '5', 'A', DAY2);
    page.mark('Ahmed Noor', 'present');
    page.saveAttendance();

    equal(page.confirmOpen(), true, 'should warn');
    assert(/2 of 3 students have no status/.test(page.text('#confirm-text')), page.text('#confirm-text'));
    equal(page.attendanceCount(), 5, 'nothing saved while the dialog is open');
  });

  await it('cancels without saving', async function () {
    page.confirmNo();
    equal(page.attendanceCount(), 5);
    assert(/unsaved/.test(page.text('#savebar-info')));
  });

  await it('saves the partial session when confirmed', async function () {
    page.saveAttendance();
    page.confirmYes();
    equal(page.attendanceCount(), 6, 'one record added for day 2');
  });

  await it('refuses to save nothing at all', async function () {
    openSession(page, '5', 'A', OTHER_MONTH);
    page.saveAttendance();
    equal(page.confirmOpen(), false);
    assert(/Mark at least one/.test(page.toastText()), page.toastText());
    equal(page.attendanceCount(), 6);
  });

  /* ==================================================================== */
  describe('unsaved changes are protected');

  await it('asks before switching tabs with unsaved marks', async function () {
    openSession(page, '5', 'A', OTHER_MONTH);
    page.mark('Ahmed Noor', 'absent');

    page.goTo('records');
    equal(page.confirmOpen(), true, 'should warn before leaving');
    equal(page.$('#screen-attendance').hidden, false, 'still on attendance');
    assert(/Discard unsaved/.test(page.text('#confirm-title')), page.text('#confirm-title'));
  });

  await it('stays put when the teacher cancels', async function () {
    page.confirmNo();
    equal(page.$('#screen-attendance').hidden, false);
    equal(page.markOf('Ahmed Noor'), 'absent', 'marks survive the cancel');
  });

  await it('leaves and drops the marks when confirmed', async function () {
    page.goTo('records');
    page.confirmYes();
    equal(page.$('#screen-records').hidden, false);

    page.goTo('attendance');
    equal(page.markOf('Ahmed Noor'), '', 'the discarded mark is gone');
    equal(page.attendanceCount(), 6, 'and was never written');
  });

  await it('asks before changing the date with unsaved marks', async function () {
    openSession(page, '5', 'A', OTHER_MONTH);
    page.mark('Bilal Shah', 'leave');

    page.pick('#a-date', DAY1);
    equal(page.confirmOpen(), true);
    equal(page.$('#a-date').value, OTHER_MONTH, 'the date snaps back until confirmed');

    page.confirmYes();
    equal(page.$('#a-date').value, DAY1, 'then the change goes through');
    equal(page.markOf('Bilal Shah'), 'absent', 'day 1 marks are loaded');
  });

  await it('asks before changing the class with unsaved marks', async function () {
    openSession(page, '5', 'A', OTHER_MONTH);
    page.mark('Hina Malik', 'present');

    page.pick('#a-class', '6');
    equal(page.confirmOpen(), true);
    equal(page.$('#a-class').value, '5', 'the class snaps back');

    page.confirmNo();
    equal(page.$('#a-class').value, '5');
    equal(page.markOf('Hina Malik'), 'present', 'marks kept');
  });

  await it('switches freely when there is nothing unsaved', async function () {
    // The previous test deliberately left marks pending — drop them first.
    page.goTo('records');
    page.confirmYes();
    equal(page.$('#screen-records').hidden, false);

    openSession(page, '5', 'A', DAY1);
    equal(page.confirmOpen(), false, 'a clean session changes date without asking');

    page.goTo('records');
    equal(page.confirmOpen(), false, 'no warning when clean');
    equal(page.$('#screen-records').hidden, false);
  });

  /* ==================================================================== */
  describe('searching within a class');

  await it('filters the marking list', async function () {
    openSession(page, '5', 'A', DAY1);
    page.type('#a-search', 'hina');
    deepEqual(page.attNames(), ['Hina Malik']);
    equal(page.$('#a-search-clear').hidden, false);
  });

  await it('keeps the counts for the whole class while filtered', async function () {
    deepEqual(page.attCounts(), { present: 1, absent: 1, leave: 1, pending: 0 },
      'counts cover all three students, not just the visible one');
  });

  await it('finds a student by roll number', async function () {
    page.type('#a-search', '2');
    deepEqual(page.attNames(), ['Bilal Shah']);
  });

  await it('shows a no-match state', async function () {
    page.type('#a-search', 'zzzz');
    equal(page.attNames().length, 0);
    equal(page.$('#a-search-empty').hidden, false);
  });

  await it('marks correctly while filtered', async function () {
    page.type('#a-search', 'ahmed');
    page.mark('Ahmed Noor', 'leave');
    deepEqual(page.attCounts(), { present: 0, absent: 1, leave: 2, pending: 0 });
  });

  await it('restores the list from the clear button', async function () {
    page.$('#a-search-clear').click();
    equal(page.attNames().length, 3);
    equal(page.$('#a-search').value, '');
    equal(page.markOf('Ahmed Noor'), 'leave', 'the mark made while filtered survived');
  });

  await it('discards that experiment', async function () {
    page.goTo('students');
    page.confirmYes();
    equal(page.attendanceCount(), 6);
  });

  page.close();

  /* ==================================================================== */
  describe('reopening the app');

  var reopened = await openApp({ students: savedStudents, attendance: savedAttendance });

  await it('still has the students and the saved attendance', async function () {
    equal(reopened.stored().length, 5);
    equal(reopened.attendanceCount(), 3);
  });

  await it('loads the saved marks when the same date is opened again', async function () {
    openSession(reopened, '5', 'A', DAY1);
    equal(reopened.markOf('Ahmed Noor'), 'present');
    equal(reopened.markOf('Bilal Shah'), 'absent');
    equal(reopened.markOf('Hina Malik'), 'leave');
    deepEqual(reopened.attCounts(), { present: 1, absent: 1, leave: 1, pending: 0 });
  });

  await it('shows it as already saved rather than a blank session', async function () {
    assert(/already saved/.test(reopened.text('#a-note')), reopened.text('#a-note'));
    equal(reopened.$('#a-save').textContent, 'Update attendance');
    equal(reopened.$('#a-save').disabled, true);
  });

  await it('has nothing to save when an edit is undone', async function () {
    reopened.mark('Hina Malik', 'present');   // Hina was saved as 'leave'
    equal(reopened.$('#a-save').disabled, false, 'a real change enables saving');
    reopened.mark('Hina Malik', 'leave');     // back to the saved value
    equal(reopened.$('#a-save').disabled, true, 'undoing the edit leaves nothing to save');
  });

  await it('creates no duplicates when the same session is saved again', async function () {
    reopened.mark('Ahmed Noor', 'absent');
    reopened.saveAttendance();
    equal(reopened.attendanceCount(), 3, 'still exactly three records');

    reopened.mark('Ahmed Noor', 'present');   // and change it back
    reopened.saveAttendance();
    equal(reopened.attendanceCount(), 3, 'still exactly three records');
    equal(reopened.markOf('Ahmed Noor'), 'present');
  });

  await it('shows a different date as an empty session', async function () {
    openSession(reopened, '5', 'A', DAY2);
    deepEqual(reopened.attCounts(), { present: 0, absent: 0, leave: 0, pending: 3 });
    assert(/No attendance saved/.test(reopened.text('#a-note')));
  });

  /* ==================================================================== */
  describe('editing saved attendance');

  await it('updates a mark in place', async function () {
    openSession(reopened, '5', 'A', DAY1);
    reopened.mark('Bilal Shah', 'present');
    equal(reopened.$('#a-save').disabled, false, 'the edit enables saving');

    reopened.saveAttendance();
    assert(/Attendance updated/.test(reopened.toastText()), reopened.toastText());
    equal(reopened.attendanceCount(), 3, 'no extra record');
  });

  await it('persists the edit to storage', async function () {
    var stored = reopened.storedAttendance();
    var bilal = reopened.stored().filter(function (s) { return s.name === 'Bilal Shah'; })[0];
    equal(stored[bilal.id + '|' + DAY1].status, 'present');
  });

  var editedStudents = reopened.stored();
  var editedAttendance = reopened.storedAttendance();

  reopened.close();

  var again = await openApp({ students: editedStudents, attendance: editedAttendance });

  await it('keeps the edit after another restart', async function () {
    openSession(again, '5', 'A', DAY1);
    equal(again.markOf('Bilal Shah'), 'present');
    equal(again.attendanceCount(), 3);
  });

  again.close();

  /* ==================================================================== */
  describe('deleting a student');

  var cascade = await openApp({ students: savedStudents, attendance: savedAttendance });

  await it('removes their attendance with them', async function () {
    equal(cascade.attendanceCount(), 3);
    var card = cascade.cards().filter(function (c) {
      return c.querySelector('.card__name').textContent === 'Bilal Shah';
    })[0];
    card.querySelector('.iconbtn--danger').click();
    cascade.confirmYes();

    equal(cascade.stored().length, 4);
    equal(cascade.attendanceCount(), 2, 'their attendance record went too');
  });

  await it('leaves the rest of the class intact', async function () {
    openSession(cascade, '5', 'A', DAY1);
    deepEqual(cascade.attNames(), ['Ahmed Noor', 'Hina Malik']);
    equal(cascade.markOf('Ahmed Noor'), 'present');
    equal(cascade.markOf('Hina Malik'), 'leave');
  });

  cascade.close();

  /* ==================================================================== */
  describe('records — daily');

  var records = await openApp({ students: savedStudents, attendance: savedAttendance });

  await it('adds a second day and another month to work with', async function () {
    openSession(records, '5', 'A', DAY2);
    records.$('#a-all-present').click();
    records.saveAttendance();

    openSession(records, '5', 'A', OTHER_MONTH);
    records.mark('Ahmed Noor', 'absent');
    records.mark('Bilal Shah', 'present');
    records.mark('Hina Malik', 'present');
    records.saveAttendance();

    equal(records.attendanceCount(), 9, '3 + 3 + 3');
  });

  await it('shows one day with each student’s status', async function () {
    records.goTo('records');
    records.pick('#r-date', DAY1);
    deepEqual(records.recNames(), ['Ahmed Noor', 'Bilal Shah', 'Hina Malik']);
    deepEqual(records.recStatuses(), ['Present', 'Absent', 'Leave']);
  });

  await it('summarises the day', async function () {
    var summary = records.recSummary();
    equal(summary.visible, true);
    equal(summary.title, 'Fri, 4 Sep 2026');
    equal(summary.present, 1);
    equal(summary.absent, 1);
    equal(summary.leave, 1);
    equal(summary.percent, '33%');
  });

  await it('switches to another day', async function () {
    records.pick('#r-date', DAY2);
    equal(records.recRows().length, 3);
    deepEqual(records.recStatuses(), ['Present', 'Present', 'Present']);
    equal(records.recSummary().percent, '100%');
  });

  await it('reports a day with nothing recorded', async function () {
    records.pick('#r-date', '2026-09-06');
    equal(records.recRows().length, 0);
    equal(records.$('#r-empty').hidden, false);
    equal(records.$('#r-summary').hidden, true);
    assert(/Sat, 5 Sep 2026|Sun, 6 Sep 2026/.test(records.text('#r-empty-text')),
      records.text('#r-empty-text'));
  });

  await it('filters by class', async function () {
    records.pick('#r-date', DAY1);
    records.pick('#r-class', '6');
    equal(records.recRows().length, 0, '6-B has nothing on day 1 in this fixture');

    records.pick('#r-class', '5');
    equal(records.recRows().length, 3);
  });

  await it('filters by section', async function () {
    records.pick('#r-section', 'A');
    equal(records.recRows().length, 3);
    records.pick('#r-section', 'B');
    equal(records.recRows().length, 0);
  });

  await it('resets to all classes and sections', async function () {
    records.pick('#r-class', '');
    records.pick('#r-section', '');
    equal(records.recRows().length, 3);
  });

  await it('searches by name and roll', async function () {
    records.type('#r-search', 'hina');
    deepEqual(records.recNames(), ['Hina Malik']);
    equal(records.recSummary().leave, 1, 'the summary follows the search');

    records.type('#r-search', '1');
    deepEqual(records.recNames(), ['Ahmed Noor']);

    records.type('#r-search', 'nobody');
    equal(records.recRows().length, 0);
    equal(records.$('#r-empty').hidden, false);

    records.$('#r-search-clear').click();
    equal(records.recRows().length, 3);
  });

  /* ==================================================================== */
  describe('records — monthly');

  await it('switches to the monthly report', async function () {
    records.$('#r-mode-monthly').click();
    equal(records.$('#r-month-field').hidden, false);
    equal(records.$('#r-date-field').hidden, true);
    assert(records.$('#r-mode-monthly').classList.contains('is-active'));
  });

  await it('rolls September up per student', async function () {
    records.pick('#r-month', '2026-09');
    deepEqual(records.recNames(), ['Ahmed Noor', 'Bilal Shah', 'Hina Malik']);
    equal(records.recSummary().title, 'September 2026');

    var ahmed = records.recRows()[0];
    var tallies = Array.prototype.slice.call(ahmed.querySelectorAll('.tally'))
      .map(function (t) { return t.textContent; });
    deepEqual(tallies, ['2', '0', '0'], 'present / absent / leave across day 1 and day 2');
    equal(ahmed.querySelector('.rec__pct').textContent, '100%');
  });

  await it('counts a mixed record correctly', async function () {
    var hina = records.recRows()[2];
    deepEqual(
      Array.prototype.slice.call(hina.querySelectorAll('.tally')).map(function (t) { return t.textContent; }),
      ['1', '0', '1'],
      'present on day 2, leave on day 1'
    );
    equal(hina.querySelector('.rec__pct').textContent, '50%');
  });

  await it('shows a different month separately', async function () {
    records.pick('#r-month', '2026-10');
    equal(records.recRows().length, 3);
    var ahmed = records.recRows()[0];
    deepEqual(
      Array.prototype.slice.call(ahmed.querySelectorAll('.tally')).map(function (t) { return t.textContent; }),
      ['0', '1', '0']
    );
    equal(records.recSummary().percent, '67%', '2 of 3 present');
  });

  await it('reports a month with nothing recorded', async function () {
    records.pick('#r-month', '2025-01');
    equal(records.recRows().length, 0);
    equal(records.$('#r-empty').hidden, false);
    assert(/January 2025/.test(records.text('#r-empty-text')), records.text('#r-empty-text'));
  });

  await it('applies the class filter to the monthly report', async function () {
    records.pick('#r-month', '2026-09');
    records.pick('#r-class', '5');
    equal(records.recRows().length, 3);
    records.pick('#r-class', '6');
    equal(records.recRows().length, 0);
    records.pick('#r-class', '');
  });

  await it('applies the search to the monthly report', async function () {
    records.type('#r-search', 'bilal');
    deepEqual(records.recNames(), ['Bilal Shah']);
    records.$('#r-search-clear').click();
  });

  await it('goes back to the daily report', async function () {
    records.$('#r-mode-daily').click();
    equal(records.$('#r-date-field').hidden, false);
    equal(records.$('#r-month-field').hidden, true);
    equal(records.recRows().length, 3);
  });

  await it('refreshes after new attendance is saved', async function () {
    records.pick('#r-date', '2026-11-02');
    equal(records.recRows().length, 0);

    openSession(records, '6', 'B', '2026-11-02');
    records.$('#a-all-present').click();
    records.saveAttendance();

    records.goTo('records');
    equal(records.recRows().length, 2, 'the new day shows up');
    deepEqual(records.recNames(), ['Sana Tariq', 'Zara Ali']);
  });

  records.close();

  /* -------------------------------------------------------------- report */
  stopServer();
  h.report('attendance UI tests');
}

main().catch(function (err) {
  console.error(err);
  stopServer();
  process.exit(1);
});
