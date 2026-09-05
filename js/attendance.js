/* ==========================================================================
   attendance.js — Step 2: marking attendance for one class, section and date.

   The screen holds a working copy of the marks and a snapshot of what is
   saved. Everything else — the dirty flag, the save-bar wording, the leave
   confirmation — is derived from the difference between those two.
   ========================================================================== */

(function (window, document) {
  'use strict';

  var DB = window.SchoolDB;
  var Students = DB.Students;
  var Attendance = DB.Attendance;
  var util = DB.util;

  var STATUSES = Attendance.STATUSES;

  var el = {};
  var rows = {};      // studentId -> { row, buttons: { present, absent, leave } }
  var started = false;

  var state = {
    className: '',
    section: '',
    date: '',
    roster: [],
    marks: {},        // working copy — studentId -> status
    saved: {},        // last snapshot read from or written to storage
    everSaved: false
  };

  function $(id) { return document.getElementById(id); }

  function copy(source) {
    var out = {};
    Object.keys(source).forEach(function (key) { out[key] = source[key]; });
    return out;
  }

  /* ---------------------------------------------------------- dirty state */

  function isDirty() {
    var ids = {};
    Object.keys(state.marks).forEach(function (id) { ids[id] = true; });
    Object.keys(state.saved).forEach(function (id) { ids[id] = true; });

    var keys = Object.keys(ids);
    for (var i = 0; i < keys.length; i++) {
      if (state.marks[keys[i]] !== state.saved[keys[i]]) return true;
    }
    return false;
  }

  function counts() {
    var out = { present: 0, absent: 0, leave: 0, pending: 0, total: state.roster.length };
    state.roster.forEach(function (student) {
      var status = state.marks[student.id];
      if (Attendance.isStatus(status)) out[status]++;
      else out.pending++;
    });
    return out;
  }

  /* -------------------------------------------------------------- pickers */

  function fillSelect(select, values, keepValue) {
    var previous = keepValue === undefined ? select.value : keepValue;
    select.textContent = '';
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    if (values.indexOf(previous) !== -1) select.value = previous;
    else if (values.length) select.value = values[0];
    else select.value = '';
    return select.value;
  }

  /** Sections that actually contain students in the chosen class. */
  function sectionsForClass(className) {
    var seen = {}, out = [];
    Students.all().forEach(function (student) {
      if (student.className.toLowerCase() !== String(className).toLowerCase()) return;
      if (seen[student.section]) return;
      seen[student.section] = true;
      out.push(student.section);
    });
    return out.sort(util.naturalCompare);
  }

  function syncPickers() {
    var classes = Students.classes();
    state.className = fillSelect(el.classSelect, classes, state.className);

    var sections = sectionsForClass(state.className);
    state.section = fillSelect(el.sectionSelect, sections, state.section);
  }

  /* --------------------------------------------------------- session load */

  function loadSession() {
    state.date = el.date.value;
    state.roster = (state.className && state.section)
      ? Students.roster(state.className, state.section)
      : [];

    if (util.isISODate(state.date) && state.roster.length) {
      state.saved = Attendance.sessionMarks(state.date, state.className, state.section);
    } else {
      state.saved = {};
    }

    state.marks = copy(state.saved);
    state.everSaved = Object.keys(state.saved).length > 0;

    render();
  }

  /* --------------------------------------------------------------- render */

  function statusButton(student, status) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'seg__btn seg__btn--' + status;
    button.setAttribute('data-status', status);
    button.textContent = Attendance.STATUS_LABELS[status];
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', Attendance.STATUS_LABELS[status] + ' — ' + student.name);
    button.addEventListener('click', function () { setStatus(student.id, status); });
    return button;
  }

  function buildRow(student) {
    var row = document.createElement('div');
    row.className = 'att';
    row.setAttribute('data-student', student.id);

    var head = document.createElement('div');
    head.className = 'att__head';

    var roll = document.createElement('span');
    roll.className = 'chip';
    roll.textContent = student.roll;
    head.appendChild(roll);

    var names = document.createElement('span');
    names.className = 'att__names';

    var name = document.createElement('span');
    name.className = 'att__name';
    name.textContent = student.name;
    names.appendChild(name);

    if (student.fatherName) {
      var father = document.createElement('span');
      father.className = 'att__father';
      father.textContent = 'S/D of ' + student.fatherName;
      names.appendChild(father);
    }

    head.appendChild(names);
    row.appendChild(head);

    var seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Attendance for ' + student.name);

    var buttons = {};
    STATUSES.forEach(function (status) {
      var button = statusButton(student, status);
      buttons[status] = button;
      seg.appendChild(button);
    });

    row.appendChild(seg);
    rows[student.id] = { row: row, buttons: buttons };
    paintRow(student.id);
    return row;
  }

  function paintRow(studentId) {
    var entry = rows[studentId];
    if (!entry) return;
    var current = state.marks[studentId];
    entry.row.classList.toggle('is-unmarked', !Attendance.isStatus(current));
    STATUSES.forEach(function (status) {
      var on = current === status;
      entry.buttons[status].classList.toggle('is-on', on);
      entry.buttons[status].setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function paintCounts() {
    var tally = counts();
    el.nPresent.textContent = String(tally.present);
    el.nAbsent.textContent = String(tally.absent);
    el.nLeave.textContent = String(tally.leave);
    el.nPending.textContent = String(tally.pending);
    paintSaveBar(tally);
  }

  function paintSaveBar(tally) {
    tally = tally || counts();

    if (!state.roster.length) {
      el.savebar.hidden = true;
      return;
    }
    el.savebar.hidden = window.UI.activeScreen() !== 'attendance';

    var dirty = isDirty();
    el.save.textContent = state.everSaved ? 'Update attendance' : 'Save attendance';
    el.save.disabled = !dirty && state.everSaved;

    var info;
    if (dirty) {
      info = tally.pending
        ? tally.pending + ' still to mark · unsaved'
        : 'All ' + tally.total + ' marked · unsaved';
    } else if (state.everSaved) {
      info = 'Saved for ' + util.formatDate(state.date);
    } else {
      info = 'Mark students, then save';
    }
    el.savebarInfo.textContent = info;
    el.savebarInfo.classList.toggle('is-dirty', dirty);
  }

  function paintNote() {
    if (!state.roster.length) {
      el.note.hidden = true;
      return;
    }
    el.note.hidden = false;
    el.note.textContent = state.everSaved
      ? 'Attendance already saved for this day — edit below and update.'
      : 'No attendance saved for this day yet.';
    el.note.classList.toggle('note--saved', state.everSaved);
  }

  function render() {
    rows = {};
    el.list.textContent = '';

    var hasStudents = Students.all().length > 0;

    // Nothing to mark: either the register is empty or this group is.
    if (!state.roster.length) {
      el.session.hidden = true;
      el.empty.hidden = false;
      el.note.hidden = true;
      el.savebar.hidden = true;

      if (!hasStudents) {
        el.emptyTitle.textContent = 'No students yet';
        el.emptyText.textContent = 'Add students before taking attendance.';
        el.emptyAction.hidden = false;
      } else {
        el.emptyTitle.textContent = 'No students in this group';
        el.emptyText.textContent = 'Class ' + state.className + ' · Section ' + state.section +
                                   ' has no students. Pick another class or section.';
        el.emptyAction.hidden = true;
      }
      window.UI.setSubtitle('attendance', 'Mark attendance');
      return;
    }

    el.empty.hidden = true;
    el.session.hidden = false;

    var term = util.text(el.search.value);
    var visible = Students.search(state.roster, term);
    el.searchClear.hidden = term === '';

    var fragment = document.createDocumentFragment();
    visible.forEach(function (student) { fragment.appendChild(buildRow(student)); });
    el.list.appendChild(fragment);

    // Counts come from state.marks over the whole roster, not from the DOM,
    // so filtered-out students still tally correctly.
    el.searchEmpty.hidden = visible.length > 0;
    if (!visible.length) {
      el.searchEmptyText.textContent = 'Nothing matches “' + term + '” in this class.';
    }

    paintNote();
    paintCounts();
    window.UI.setSubtitle('attendance',
      'Class ' + state.className + ' · ' + state.section + ' · ' + util.formatDate(state.date));
  }

  /* -------------------------------------------------------------- marking */

  function setStatus(studentId, status) {
    // Tapping the active status again clears it.
    if (state.marks[studentId] === status) delete state.marks[studentId];
    else state.marks[studentId] = status;

    paintRow(studentId);
    paintCounts();
  }

  function markAllPresent() {
    state.roster.forEach(function (student) {
      state.marks[student.id] = 'present';
      paintRow(student.id);
    });
    paintCounts();
    window.UI.toast('All ' + state.roster.length + ' marked present');
  }

  /* --------------------------------------------------------------- saving */

  function save() {
    if (!state.roster.length) return;

    var tally = counts();

    if (!tally.present && !tally.absent && !tally.leave) {
      window.UI.toast('Mark at least one student before saving.', 'error');
      return;
    }

    if (tally.pending) {
      window.UI.confirm({
        title: 'Save with students unmarked?',
        text: tally.pending + ' of ' + tally.total + ' students have no status yet. ' +
              'They will not be recorded for this date.',
        confirmLabel: 'Save anyway',
        tone: 'primary',
        onConfirm: commit
      });
      return;
    }

    commit();
  }

  function commit() {
    var result = Attendance.saveSession(state.date, state.className, state.section, state.marks);

    if (!result.ok) {
      window.UI.toast(result.error, 'error');
      return;
    }

    var previousSaved = state.saved;
    var previouslyEverSaved = state.everSaved;

    state.saved = copy(state.marks);
    state.everSaved = true;

    paintNote();
    paintCounts();

    window.UI.afterSave(function () {
      window.UI.emit('attendance-changed');
      var verb = result.created && !result.updated ? 'saved' : 'updated';
      window.UI.toast('Attendance ' + verb + ' for ' + util.formatDate(state.date) +
                      ' · ' + result.saved + ' students');
    }, function () {
      // The write was rolled back, so the session is unsaved again and the
      // save bar must say so rather than showing a saved state.
      state.saved = previousSaved;
      state.everSaved = previouslyEverSaved;
      paintNote();
      paintCounts();
    });
  }

  /* ------------------------------------------- guarding unsaved changes */

  function confirmDiscard(onConfirm) {
    window.UI.confirm({
      title: 'Discard unsaved attendance?',
      text: 'Your marks for ' + util.formatDate(state.date) +
            ' have not been saved. They will be lost.',
      confirmLabel: 'Discard',
      onConfirm: onConfirm
    });
  }

  /**
   * Wrap a picker change. The control has already moved by the time `change`
   * fires, so put it back and only re-apply once the teacher confirms.
   */
  function guardedChange(control, previousValue, apply) {
    var chosen = control.value;
    if (!isDirty()) { apply(chosen); return; }

    control.value = previousValue;
    confirmDiscard(function () {
      control.value = chosen;
      apply(chosen);
    });
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    if (started) return;
    started = true;

    el.classSelect = $('a-class');
    el.sectionSelect = $('a-section');
    el.date = $('a-date');
    el.note = $('a-note');
    el.session = $('a-session');
    el.list = $('a-list');
    el.search = $('a-search');
    el.searchClear = $('a-search-clear');
    el.searchEmpty = $('a-search-empty');
    el.searchEmptyText = $('a-search-empty-text');
    el.empty = $('a-empty');
    el.emptyTitle = $('a-empty-title');
    el.emptyText = $('a-empty-text');
    el.emptyAction = $('a-empty-action');
    el.allPresent = $('a-all-present');
    el.savebar = $('savebar');
    el.savebarInfo = $('savebar-info');
    el.save = $('a-save');

    el.nPresent = $('a-n-present');
    el.nAbsent = $('a-n-absent');
    el.nLeave = $('a-n-leave');
    el.nPending = $('a-n-pending');

    el.date.value = util.today();
    state.date = el.date.value;

    el.classSelect.addEventListener('change', function () {
      var self = this;
      guardedChange(self, state.className, function (value) {
        state.className = value;
        state.section = fillSelect(el.sectionSelect, sectionsForClass(value), state.section);
        loadSession();
      });
    });

    el.sectionSelect.addEventListener('change', function () {
      guardedChange(this, state.section, function (value) {
        state.section = value;
        loadSession();
      });
    });

    el.date.addEventListener('change', function () {
      guardedChange(this, state.date, function () { loadSession(); });
    });

    el.search.addEventListener('input', render);
    el.searchClear.addEventListener('click', function () {
      el.search.value = '';
      render();
      el.search.focus();
    });

    el.allPresent.addEventListener('click', markAllPresent);
    el.save.addEventListener('click', save);
    el.emptyAction.addEventListener('click', function () { window.UI.showScreen('students'); });

    // Leaving the screen with unsaved marks asks first.
    window.UI.setGuard('attendance', function (proceed) {
      if (!isDirty()) { proceed(); return; }
      confirmDiscard(proceed);
    });

    window.UI.onEnter('attendance', function () {
      syncPickers();
      loadSession();
    });

    // The roster can change from the students screen at any time.
    window.UI.on('students-changed', function () {
      var wasDirty = isDirty();
      syncPickers();

      if (!wasDirty) { loadSession(); return; }

      // Keep the teacher's in-progress marks; just refresh who is on the list.
      var kept = state.marks;
      loadSession();
      state.roster.forEach(function (student) {
        if (kept[student.id] !== undefined) state.marks[student.id] = kept[student.id];
      });
      render();
    });

    // A different school means a different roster, and any marks in progress
    // belonged to the school that has just been signed out.
    window.UI.on('account-changed', function () {
      state.className = '';
      state.section = '';
      state.roster = [];
      state.marks = {};
      state.saved = {};
      state.everSaved = false;
      el.search.value = '';
      el.date.value = util.today();
      state.date = el.date.value;
      syncPickers();
      loadSession();
    });

    // A browser refresh should not silently drop marks either.
    window.addEventListener('beforeunload', function (event) {
      if (window.UI.activeScreen() !== 'attendance' || !isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
      return '';
    });

    syncPickers();
  }

  window.AttendanceUI = {
    init: init,
    render: render,
    isDirty: isDirty,
    counts: counts,
    _state: state
  };

  function boot() { if (window.UI) init(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

}(window, document));
