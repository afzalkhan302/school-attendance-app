/* End-to-end tests for the students screen.

   Serves the real index.html over HTTP and loads it in jsdom, so the actual
   markup, script order and event wiring are exercised — not a mock. jsdom is
   a devDependency; nothing here ships with the app. */

'use strict';

var h = require('./harness');
var { startServer, stopServer, openApp } = require('./helpers');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal;

var SEED = [
  { id: 's_seed1', name: 'Ali Raza', roll: '1', className: '5', section: 'A', createdAt: 1, updatedAt: 1 },
  { id: 's_seed2', name: 'Hina Malik', roll: '2', className: '5', section: 'A', createdAt: 2, updatedAt: 2 }
];

/* ==================================== run ================================== */

async function main() {
  await startServer();

  /* ---------------------------------------------------------------- boot */
  describe('first launch');

  var page = await openApp();

  await it('lands on the dashboard, then opens students from the tab bar', async function () {
    equal(page.$('#screen-dashboard').hidden, false, 'the dashboard is home');
    equal(page.$('#screen-students').hidden, true);
    assert(page.$('.tab[data-screen="dashboard"]').classList.contains('is-active'));

    page.goTo('students');
    equal(page.$('#screen-students').hidden, false);
    equal(page.$('#screen-attendance').hidden, true);
    assert(page.$('.tab[data-screen="students"]').classList.contains('is-active'));
  });

  await it('shows the empty state and a zero count', async function () {
    equal(page.$('#student-empty').hidden, false);
    equal(page.$('#student-count').textContent, '0');
    equal(page.$('#student-empty-title').textContent, 'No students yet');
    equal(page.cards().length, 0);
  });

  await it('has no overlay open', async function () {
    equal(page.$('#backdrop').hidden, true);
    equal(page.$('#student-sheet').hidden, true);
    equal(page.$('#confirm').hidden, true);
  });

  /* ----------------------------------------------------------- add sheet */
  describe('add student');

  await it('opens the sheet from the Add button', async function () {
    page.$('#fab-add').click();
    equal(page.$('#student-sheet').hidden, false, 'sheet should be visible');
    equal(page.$('#backdrop').hidden, false, 'backdrop should be visible');
    equal(page.$('#sheet-title').textContent, 'Add student');
    equal(page.$('#sheet-save').textContent, 'Add student');
    equal(page.$('#f-name').value, '', 'form starts blank');
  });

  await it('blocks an empty submit and flags every required field', async function () {
    page.submit();
    equal(page.$('#student-sheet').hidden, false, 'sheet must stay open');
    assert(/required/.test(page.errorFor('name')), 'name: ' + page.errorFor('name'));
    assert(/required/.test(page.errorFor('roll')), 'roll: ' + page.errorFor('roll'));
    assert(/required/.test(page.errorFor('className')), 'class: ' + page.errorFor('className'));
    assert(/required/.test(page.errorFor('section')), 'section: ' + page.errorFor('section'));
    equal(page.stored().length, 0, 'nothing should be saved');
  });

  await it('clears a field error as soon as the teacher types', async function () {
    page.type('#f-name', 'Ay');
    equal(page.errorFor('name'), '', 'name error should clear');
    assert(/required/.test(page.errorFor('roll')), 'other errors stay until fixed');
  });

  await it('uppercases the section while typing', async function () {
    page.type('#f-section', 'b');
    equal(page.$('#f-section').value, 'B');
  });

  await it('saves a valid student and closes the sheet', async function () {
    page.fillForm({ name: '  Ayesha   Khan ', roll: '12', className: '5', section: 'a' });
    page.submit();

    equal(page.$('#student-sheet').hidden, true, 'sheet should close');
    equal(page.$('#backdrop').hidden, true, 'backdrop should close');
    equal(page.cards().length, 1);
    equal(page.names()[0], 'Ayesha Khan', 'name whitespace collapsed');
    equal(page.$('#student-count').textContent, '1');
    equal(page.$('#student-empty').hidden, true);
    equal(page.$('#toast').hidden, false, 'a confirmation toast should appear');
    assert(/Ayesha Khan added/.test(page.$('#toast').textContent), page.$('#toast').textContent);
  });

  await it('writes the student to device storage', async function () {
    var rows = page.stored();
    equal(rows.length, 1);
    equal(rows[0].name, 'Ayesha Khan');
    equal(rows[0].roll, '12');
    equal(rows[0].className, '5');
    equal(rows[0].section, 'A', 'section stored uppercase');
  });

  await it('shows roll, class and section on the card', async function () {
    var card = page.cards()[0];
    equal(card.querySelector('.chip').textContent, 'Roll 12');
    assert(/Class 5/.test(card.querySelector('.card__meta').textContent));
    equal(card.querySelector('.avatar').textContent, 'AK', 'initials from first and last name');
    equal(page.groupLabels()[0], 'Class 5 · Section A');
  });

  await it('rejects a duplicate roll in the same class and section', async function () {
    page.addStudent({ name: 'Bilal Ahmed', roll: '12', className: '5', section: 'A' });
    equal(page.$('#student-sheet').hidden, false, 'sheet stays open on error');
    assert(/already used/.test(page.errorFor('roll')), page.errorFor('roll'));
    equal(page.cards().length, 1, 'no card added');
    equal(page.stored().length, 1);
    page.$('#sheet-cancel').click();
    equal(page.$('#student-sheet').hidden, true);
  });

  await it('accepts the same roll in a different section', async function () {
    page.addStudent({ name: 'Bilal Ahmed', roll: '12', className: '5', section: 'B' });
    equal(page.cards().length, 2);
    equal(page.$('#student-count').textContent, '2');
    equal(page.groupLabels().length, 2, 'two class/section groups');
  });

  await it('prefills class and section from the last student added', async function () {
    page.$('#fab-add').click();
    equal(page.$('#f-class').value, '5');
    equal(page.$('#f-section').value, 'B');
    equal(page.$('#f-name').value, '', 'name is not prefilled');
    page.$('#sheet-close').click();
  });

  await it('sorts by class, then section, then roll number', async function () {
    page.addStudent({ name: 'Zara Ali', roll: '3', className: '10', section: 'A' });
    page.addStudent({ name: 'Ahmed Noor', roll: '2', className: '5', section: 'A' });
    equal(page.names().join(' | '), 'Ahmed Noor | Ayesha Khan | Bilal Ahmed | Zara Ali',
      'class 5 before class 10; roll 2 before roll 12');
    equal(page.groupLabels().join(' | '), 'Class 5 · Section A | Class 5 · Section B | Class 10 · Section A');
  });

  await it('closes the sheet with the Escape key', async function () {
    page.$('#fab-add').click();
    equal(page.$('#student-sheet').hidden, false);
    page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    equal(page.$('#student-sheet').hidden, true);
    equal(page.$('#backdrop').hidden, true);
  });

  await it('closes the sheet by tapping the backdrop', async function () {
    page.$('#fab-add').click();
    page.$('#backdrop').click();
    equal(page.$('#student-sheet').hidden, true);
  });

  /* -------------------------------------------------------------- search */
  describe('search');

  await it('filters by name', async function () {
    page.type('#student-search', 'ayesha');
    equal(page.cards().length, 1);
    equal(page.names()[0], 'Ayesha Khan');
    equal(page.$('#appbar-sub').textContent, '1 of 4 shown');
    equal(page.$('#student-search-clear').hidden, false);
  });

  await it('filters by class and section', async function () {
    page.type('#student-search', '5-a');
    equal(page.names().join(' | '), 'Ahmed Noor | Ayesha Khan');
  });

  await it('shows a no-results state', async function () {
    page.type('#student-search', 'zzzz');
    equal(page.cards().length, 0);
    equal(page.$('#student-empty').hidden, false);
    equal(page.$('#student-empty-title').textContent, 'No matching students');
  });

  await it('restores the full list from the clear button', async function () {
    page.$('#student-search-clear').click();
    equal(page.$('#student-search').value, '');
    equal(page.cards().length, 4);
    equal(page.$('#student-empty').hidden, true);
    equal(page.$('#appbar-sub').textContent, '4 students');
  });

  /* ---------------------------------------------------------------- edit */
  describe('edit student');

  await it('opens the sheet prefilled with the student', async function () {
    var card = page.cards()[1]; // Ayesha Khan
    card.querySelector('.iconbtn:not(.iconbtn--danger)').click();
    equal(page.$('#student-sheet').hidden, false);
    equal(page.$('#sheet-title').textContent, 'Edit student');
    equal(page.$('#sheet-save').textContent, 'Save changes');
    equal(page.$('#f-name').value, 'Ayesha Khan');
    equal(page.$('#f-roll').value, '12');
    equal(page.$('#f-class').value, '5');
    equal(page.$('#f-section').value, 'A');
  });

  await it('lets a student keep its own roll number', async function () {
    page.type('#f-name', 'Ayesha K Khan');
    page.submit();
    equal(page.$('#student-sheet').hidden, true, 'should save, not report a clash');
    equal(page.names()[1], 'Ayesha K Khan');
    equal(page.cards().length, 4, 'edit must not create a new row');
    assert(/Ayesha K Khan updated/.test(page.$('#toast').textContent), page.$('#toast').textContent);
  });

  await it('persists the edit to storage', async function () {
    var match = page.stored().filter(function (r) { return r.name === 'Ayesha K Khan'; });
    equal(match.length, 1);
    equal(page.stored().length, 4);
  });

  await it('blocks an edit that collides with another student', async function () {
    page.cards()[0].querySelector('.iconbtn:not(.iconbtn--danger)').click(); // Ahmed Noor, roll 2
    page.type('#f-roll', '12'); // already taken by Ayesha in 5-A
    page.submit();
    equal(page.$('#student-sheet').hidden, false, 'sheet stays open');
    assert(/already used/.test(page.errorFor('roll')), page.errorFor('roll'));
    page.$('#sheet-cancel').click();
    equal(page.names()[0], 'Ahmed Noor', 'original row untouched');
  });

  await it('moves a student to another class', async function () {
    page.cards()[3].querySelector('.iconbtn:not(.iconbtn--danger)').click(); // Zara Ali, class 10
    page.fillForm({ name: 'Zara Ali', roll: '3', className: '6', section: 'C' });
    page.submit();
    equal(page.groupLabels().join(' | '),
      'Class 5 · Section A | Class 5 · Section B | Class 6 · Section C');
  });

  /* -------------------------------------------------------------- delete */
  describe('delete student');

  await it('asks for confirmation before deleting', async function () {
    page.cards()[0].querySelector('.iconbtn--danger').click(); // Ahmed Noor
    equal(page.$('#confirm').hidden, false);
    equal(page.$('#backdrop').hidden, false);
    assert(/Ahmed Noor/.test(page.$('#confirm-text').textContent), page.$('#confirm-text').textContent);
    assert(/Roll 2/.test(page.$('#confirm-text').textContent));
  });

  await it('keeps the student when the teacher cancels', async function () {
    page.$('#confirm-no').click();
    equal(page.$('#confirm').hidden, true);
    equal(page.cards().length, 4);
    equal(page.names()[0], 'Ahmed Noor');
  });

  await it('removes the student on confirm', async function () {
    page.cards()[0].querySelector('.iconbtn--danger').click();
    page.$('#confirm-yes').click();
    equal(page.$('#confirm').hidden, true);
    equal(page.cards().length, 3);
    equal(page.names().indexOf('Ahmed Noor'), -1, 'card should be gone');
    equal(page.$('#student-count').textContent, '3');
    equal(page.stored().length, 3, 'removed from storage too');
    assert(/Ahmed Noor deleted/.test(page.$('#toast').textContent), page.$('#toast').textContent);
  });

  await it('frees the deleted roll number for reuse', async function () {
    page.addStudent({ name: 'New Student', roll: '2', className: '5', section: 'A' });
    equal(page.$('#student-sheet').hidden, true, 'roll 2 should be available again');
    equal(page.cards().length, 4);
  });

  await it('drops the empty group when its last student goes', async function () {
    // Bilal Ahmed is the only student in 5-B.
    var bilal = page.cards().filter(function (c) {
      return c.querySelector('.card__name').textContent === 'Bilal Ahmed';
    })[0];
    bilal.querySelector('.iconbtn--danger').click();
    page.$('#confirm-yes').click();
    equal(page.groupLabels().indexOf('Class 5 · Section B'), -1, 'group header should disappear');
  });

  /* ------------------------------------------------------------ tab bar */
  describe('navigation');

  await it('switches to the attendance screen and hides Add', async function () {
    page.$('.tab[data-screen="attendance"]').click();
    equal(page.$('#screen-attendance').hidden, false);
    equal(page.$('#screen-students').hidden, true);
    equal(page.$('#fab-add').hidden, true, 'Add belongs to the students screen');
    assert(page.$('.tab[data-screen="attendance"]').classList.contains('is-active'));
  });

  await it('switches back to students', async function () {
    page.$('.tab[data-screen="students"]').click();
    equal(page.$('#screen-students').hidden, false);
    equal(page.$('#fab-add').hidden, false);
  });

  /* -------------------------------------------------------------- safety */
  describe('safety');

  await it('renders a name containing markup as plain text', async function () {
    page.addStudent({ name: '<img src=x onerror=alert(1)>', roll: '99', className: '9', section: 'Z' });
    var card = page.cards().filter(function (c) {
      return c.querySelector('.card__name').textContent.indexOf('<img') === 0;
    })[0];
    assert(card, 'the student should be listed');
    equal(card.querySelector('.card__name').querySelectorAll('*').length, 0, 'no elements injected');
    equal(card.querySelector('.card__name').textContent, '<img src=x onerror=alert(1)>');
  });

  page.close();

  /* --------------------------------------------------- reopening the app */
  describe('reopening the app');

  var reopened = await openApp({ students: SEED });

  await it('restores students saved by a previous session', async function () {
    equal(reopened.cards().length, 2);
    equal(reopened.names().join(' | '), 'Ali Raza | Hina Malik');
    equal(reopened.$('#student-count').textContent, '2');
    equal(reopened.$('#student-empty').hidden, true);
    equal(reopened.groupLabels()[0], 'Class 5 · Section A');
  });

  await it('offers the saved classes and sections as input suggestions', async function () {
    var classes = reopened.$$('#dl-classes option').map(function (o) { return o.value; });
    var sections = reopened.$$('#dl-sections option').map(function (o) { return o.value; });
    equal(classes.join(','), '5');
    equal(sections.join(','), 'A');
  });

  await it('can edit a restored student', async function () {
    reopened.cards()[0].querySelector('.iconbtn:not(.iconbtn--danger)').click();
    reopened.type('#f-name', 'Ali Raza Khan');
    reopened.submit();
    equal(reopened.names()[0], 'Ali Raza Khan');
    equal(reopened.stored()[0].name, 'Ali Raza Khan');
  });

  reopened.close();

  /* ------------------------------------------------- corrupted storage */
  describe('damaged storage');

  var recovered = await openApp({ students: 'not-an-array' });

  await it('boots to the empty state instead of a blank screen', async function () {
    equal(recovered.cards().length, 0);
    equal(recovered.$('#student-empty').hidden, false);
    equal(recovered.$('#student-count').textContent, '0');
  });

  await it('still accepts a new student', async function () {
    recovered.addStudent({ name: 'Fresh Start', roll: '1', className: '1', section: 'A' });
    equal(recovered.cards().length, 1);
  });

  recovered.close();

  /* -------------------------------------------------------------- report */
  stopServer();
  h.report('student UI tests');
}

main().catch(function (err) {
  console.error(err);
  stopServer();
  process.exit(1);
});
