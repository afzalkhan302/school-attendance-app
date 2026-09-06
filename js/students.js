/* ==========================================================================
   students.js — Step 1: student management screen (add / edit / delete).
   Rows are rendered with createElement + textContent, so a student name is
   never treated as markup.
   ========================================================================== */

(function (window, document) {
  'use strict';

  var DB = window.SchoolDB.Students;

  var FIELDS = ['name', 'fatherName', 'roll', 'className', 'section'];
  var INPUT_IDS = {
    name: 'f-name',
    fatherName: 'f-father',
    roll: 'f-roll',
    className: 'f-class',
    section: 'f-section'
  };

  var el = {};
  var editingId = null;   // null while adding, a student id while editing
  var detailId = null;    // the student whose detail sheet is open
  var started = false;

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------- render */

  function initials(name) {
    var words = name.split(' ').filter(Boolean);
    if (!words.length) return '?';
    var first = words[0].charAt(0);
    var last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  }

  function icon(paths) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = paths;
    return svg;
  }

  var ICON_EDIT = '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>';
  var ICON_TRASH = '<polyline points="3 6 5 6 21 6"></polyline>' +
                   '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>' +
                   '<line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>';

  function buildCard(student) {
    var card = document.createElement('div');
    card.className = 'card';

    var avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = initials(student.name);
    card.appendChild(avatar);

    var body = document.createElement('div');
    body.className = 'card__body';

    var name = document.createElement('p');
    name.className = 'card__name';
    name.textContent = student.name;
    body.appendChild(name);

    if (student.fatherName) {
      var father = document.createElement('p');
      father.className = 'card__father';
      father.textContent = 'S/D of ' + student.fatherName;
      body.appendChild(father);
    }

    var meta = document.createElement('p');
    meta.className = 'card__meta';

    var roll = document.createElement('span');
    roll.className = 'chip';
    roll.textContent = 'Roll ' + student.roll;
    meta.appendChild(roll);

    var group = document.createElement('span');
    group.textContent = 'Class ' + student.className + ' · ' + student.section;
    meta.appendChild(group);

    body.appendChild(meta);

    // Tapping the card body opens the read-only detail view.
    body.setAttribute('role', 'button');
    body.setAttribute('tabindex', '0');
    body.setAttribute('aria-label', 'Details for ' + student.name);
    body.addEventListener('click', function () { openDetail(student.id); });
    body.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openDetail(student.id);
    });

    card.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'card__actions';

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'iconbtn';
    editBtn.setAttribute('aria-label', 'Edit ' + student.name);
    editBtn.appendChild(icon(ICON_EDIT));
    editBtn.addEventListener('click', function () { openSheet(student.id); });
    actions.appendChild(editBtn);

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'iconbtn iconbtn--danger';
    deleteBtn.setAttribute('aria-label', 'Delete ' + student.name);
    deleteBtn.appendChild(icon(ICON_TRASH));
    deleteBtn.addEventListener('click', function () { askDelete(student); });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    return card;
  }

  function render() {
    /* Rendering is no longer only ever triggered by this screen: a sync from
       another device, or a save settling, can call it at any moment — including
       after the window has gone away. Nothing to draw on is not an error. */
    if (!el.list || !el.count || !el.search) return;

    var all = DB.all();
    var term = el.search.value;
    var rows = DB.search(all, term);
    var searching = window.SchoolDB.util.text(term) !== '';

    el.count.textContent = String(all.length);
    // Only takes effect while the students screen is the visible one, so a
    // background refresh cannot overwrite another screen's subtitle.
    window.UI.setSubtitle('students', searching
      ? rows.length + ' of ' + all.length + ' shown'
      : (all.length === 1 ? '1 student' : all.length + ' students'));

    el.searchClear.hidden = !searching;
    el.list.textContent = '';

    if (!rows.length) {
      el.empty.hidden = false;
      if (searching) {
        el.emptyTitle.textContent = 'No matching students';
        el.emptyText.textContent = 'Nothing matches “' + window.SchoolDB.util.text(term) + '”.';
      } else {
        el.emptyTitle.textContent = 'No students yet';
        el.emptyText.textContent = 'Tap Add to register your first student.';
      }
      return;
    }

    el.empty.hidden = true;

    var groups = DB.group(rows);
    var fragment = document.createDocumentFragment();

    groups.forEach(function (group) {
      var head = document.createElement('div');
      head.className = 'group__head';

      var label = document.createElement('span');
      label.textContent = group.label;
      head.appendChild(label);

      var count = document.createElement('span');
      count.className = 'group__count';
      count.textContent = group.students.length === 1 ? '1 student' : group.students.length + ' students';
      head.appendChild(count);

      fragment.appendChild(head);
      group.students.forEach(function (student) { fragment.appendChild(buildCard(student)); });
    });

    el.list.appendChild(fragment);
  }

  function refreshSuggestions() {
    fillDatalist(el.dlClasses, DB.classes());
    fillDatalist(el.dlSections, DB.sections());
  }

  function fillDatalist(list, values) {
    list.textContent = '';
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      list.appendChild(option);
    });
  }

  /* ------------------------------------------------------------ form sheet */

  function clearErrors() {
    FIELDS.forEach(function (field) {
      el.inputs[field].classList.remove('is-invalid');
      var error = el.errors[field];
      error.textContent = '';
      error.hidden = true;
    });
  }

  function showErrors(errors) {
    var firstInvalid = null;
    FIELDS.forEach(function (field) {
      var message = errors[field];
      var input = el.inputs[field];
      var error = el.errors[field];
      if (message) {
        input.classList.add('is-invalid');
        error.textContent = message;
        error.hidden = false;
        if (!firstInvalid) firstInvalid = input;
      } else {
        input.classList.remove('is-invalid');
        error.textContent = '';
        error.hidden = true;
      }
    });
    if (errors.form) window.UI.toast(errors.form, 'error');
    if (firstInvalid) firstInvalid.focus();
  }

  function openSheet(id) {
    var student = id ? DB.byId(id) : null;

    if (id && !student) {
      window.UI.toast('That student no longer exists.', 'error');
      render();
      return;
    }

    editingId = student ? student.id : null;
    clearErrors();
    refreshSuggestions();

    el.title.textContent = student ? 'Edit student' : 'Add student';
    el.save.textContent = student ? 'Save changes' : 'Add student';

    el.inputs.name.value = student ? student.name : '';
    el.inputs.fatherName.value = student ? student.fatherName : '';
    el.inputs.roll.value = student ? student.roll : '';
    el.inputs.className.value = student ? student.className : lastUsed('className');
    el.inputs.section.value = student ? student.section : lastUsed('section');

    window.UI.showOverlay(el.sheet, function () { editingId = null; });

    // Give the sheet a frame to slide in before the keyboard opens.
    window.setTimeout(function () { el.inputs.name.focus(); }, 60);
  }

  /* Adding a whole class is the common case, so prefill class/section from
     the student added most recently. */
  function lastUsed(field) {
    var rows = DB.all();
    var newest = null;
    for (var i = 0; i < rows.length; i++) {
      if (!newest || rows[i].createdAt > newest.createdAt) newest = rows[i];
    }
    return newest ? newest[field] : '';
  }

  function submit(event) {
    event.preventDefault();

    var payload = {
      name: el.inputs.name.value,
      fatherName: el.inputs.fatherName.value,
      roll: el.inputs.roll.value,
      className: el.inputs.className.value,
      section: el.inputs.section.value
    };

    var result = editingId ? DB.update(editingId, payload) : DB.create(payload);

    if (!result.ok) {
      showErrors(result.errors);
      return;
    }

    var wasEditing = !!editingId;
    var name = result.student.name;

    window.UI.closeOverlay();
    render();
    refreshSuggestions();

    // Only claim it was saved once the write has actually landed.
    window.UI.afterSave(function () {
      window.UI.emit('students-changed');
      window.UI.toast(name + (wasEditing ? ' updated' : ' added'));
    }, function () {
      render();
      refreshSuggestions();
    });
  }

  /* --------------------------------------------------- import from Excel */

  /* The parsed-and-checked file, held between the preview and the Import tap.
     Null whenever the sheet is not showing a preview. */
  var prepared = null;

  var STATUS_LABELS = { ok: 'Will import', duplicate: 'Duplicate', invalid: 'Error' };

  function showImportStep(step) {
    imp.pick.hidden = step !== 'pick';
    imp.preview.hidden = step !== 'preview';
  }

  function importError(message) {
    imp.error.textContent = message || '';
    imp.error.hidden = !message;
  }

  function openImport() {
    prepared = null;
    imp.file.value = '';
    importError('');
    showImportStep('pick');
    window.UI.showOverlay(imp.sheet, function () { prepared = null; });
  }

  function chooseFile(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';   // let the same file be picked again after a fix
    if (!file) return;

    importError('');
    imp.choose.disabled = true;
    imp.choose.textContent = 'Reading…';

    window.SchoolImport.readFile(file, function (result) {
      imp.choose.disabled = false;
      imp.choose.textContent = 'Choose file';

      if (!result.ok) { importError(result.error); return; }

      prepared = window.SchoolImport.prepare(result.rows);
      renderPreview(file.name, result);
      showImportStep('preview');
    });
  }

  function renderPreview(filename, parsed) {
    var counts = prepared.counts;

    imp.filename.textContent = filename + ' — sheet “' + parsed.sheetName + '”, ' +
      counts.total + ' row' + (counts.total === 1 ? '' : 's');

    imp.nOk.textContent = String(counts.ok);
    imp.nDup.textContent = String(counts.duplicate);
    imp.nBad.textContent = String(counts.invalid);

    imp.skipnote.hidden = !parsed.truncated;
    if (parsed.truncated) {
      imp.skipnote.textContent = 'Only the first ' + counts.total + ' rows were read.';
    }

    imp.rows.textContent = '';
    var fragment = document.createDocumentFragment();

    prepared.rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.className = 'import__row import__row--' + row.status;

      [String(row.line), row.values.name, row.values.fatherName,
       row.values.roll, row.values.className, row.values.section].forEach(function (value) {
        var td = document.createElement('td');
        td.textContent = value || '—';
        tr.appendChild(td);
      });

      var status = document.createElement('td');
      status.className = 'import__status';
      status.textContent = STATUS_LABELS[row.status];
      // The reason belongs where the teacher is already looking.
      if (row.note) status.title = row.note;
      tr.appendChild(status);

      fragment.appendChild(tr);

      if (row.note) {
        var noteRow = document.createElement('tr');
        noteRow.className = 'import__noterow';
        var note = document.createElement('td');
        note.colSpan = 7;
        note.textContent = row.note;
        noteRow.appendChild(note);
        fragment.appendChild(noteRow);
      }
    });

    imp.rows.appendChild(fragment);

    imp.commit.disabled = counts.ok === 0;
    imp.commit.textContent = counts.ok === 0
      ? 'Nothing to import'
      : 'Import ' + counts.ok + ' student' + (counts.ok === 1 ? '' : 's');
  }

  function commitImport() {
    if (!prepared || !prepared.counts.ok) return;

    var snapshot = prepared;
    imp.commit.disabled = true;
    imp.commit.textContent = 'Importing…';

    var result = window.SchoolImport.commit(snapshot);

    window.UI.closeOverlay();
    render();
    refreshSuggestions();

    // Nothing is claimed until the write has actually reached the disk.
    window.UI.afterSave(function () {
      window.UI.emit('students-changed');

      var skipped = snapshot.counts.duplicate + snapshot.counts.invalid;
      window.UI.toast(result.imported.length + ' student' +
        (result.imported.length === 1 ? '' : 's') + ' imported' +
        (skipped ? ', ' + skipped + ' skipped' : ''));
    }, function () {
      render();
      refreshSuggestions();
    });
  }

  var imp = {};

  function initImport() {
    imp.sheet = $('import-sheet');
    imp.pick = $('import-step-pick');
    imp.preview = $('import-step-preview');
    imp.file = $('import-file');
    imp.choose = $('import-choose');
    imp.error = $('import-error');
    imp.filename = $('import-filename');
    imp.rows = $('import-rows');
    imp.commit = $('import-commit');
    imp.skipnote = $('import-skipnote');
    imp.nOk = $('import-n-ok');
    imp.nDup = $('import-n-dup');
    imp.nBad = $('import-n-bad');

    $('import-open').addEventListener('click', openImport);
    $('import-close').addEventListener('click', window.UI.closeOverlay);
    $('import-back').addEventListener('click', function () {
      prepared = null;
      importError('');
      showImportStep('pick');
    });

    imp.choose.addEventListener('click', function () { imp.file.click(); });
    imp.file.addEventListener('change', chooseFile);
    imp.commit.addEventListener('click', commitImport);
  }

  /* --------------------------------------------------------------- detail */

  /** Read-only view of one student, with their attendance history tallied. */
  function openDetail(id) {
    var student = DB.byId(id);

    if (!student) {
      window.UI.toast('That student no longer exists.', 'error');
      render();
      return;
    }

    detailId = student.id;

    el.detailName.textContent = student.name;
    el.detailFather.textContent = student.fatherName || '—';
    el.detailRoll.textContent = student.roll;
    el.detailClass.textContent = student.className;
    el.detailSection.textContent = student.section;

    var summary = window.SchoolDB.Attendance.studentSummary(student.id);
    el.detailPresent.textContent = String(summary.present);
    el.detailAbsent.textContent = String(summary.absent);
    el.detailLeave.textContent = String(summary.leave);
    el.detailPct.textContent = summary.total
      ? summary.percent + '% attendance across ' + summary.total +
        (summary.total === 1 ? ' recorded day' : ' recorded days')
      : 'No attendance recorded yet.';

    window.UI.showOverlay(el.detailSheet, function () { detailId = null; });
  }

  /* --------------------------------------------------------------- delete */

  function askDelete(student) {
    window.UI.confirm({
      title: 'Delete student?',
      text: student.name + ' (Roll ' + student.roll + ', Class ' + student.className +
            ' · Section ' + student.section + ') will be removed permanently.',
      confirmLabel: 'Delete',
      onConfirm: function () {
        // Removing a student also drops their attendance records (db.js).
        var removed = DB.remove(student.id);
        render();
        refreshSuggestions();

        if (!removed) {
          window.UI.toast('Student was already removed.', 'error');
          return;
        }

        window.UI.afterSave(function () {
          window.UI.emit('students-changed');
          window.UI.emit('attendance-changed');
          window.UI.toast(student.name + ' deleted');
        }, function () {
          render();
          refreshSuggestions();
        });
      }
    });
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    if (started) return;
    started = true;

    el.list = $('student-list');
    el.empty = $('student-empty');
    el.emptyTitle = $('student-empty-title');
    el.emptyText = $('student-empty-text');
    el.count = $('student-count');
    el.search = $('student-search');
    el.searchClear = $('student-search-clear');
    el.sheet = $('student-sheet');
    el.form = $('student-form');
    el.title = $('sheet-title');
    el.save = $('sheet-save');
    el.dlClasses = $('dl-classes');
    el.dlSections = $('dl-sections');

    el.inputs = {};
    el.errors = {};
    FIELDS.forEach(function (field) {
      el.inputs[field] = $(INPUT_IDS[field]);
      el.errors[field] = $('e-' + field);
    });

    el.detailSheet = $('detail-sheet');
    el.detailName = $('detail-name');
    el.detailFather = $('detail-father');
    el.detailRoll = $('detail-roll');
    el.detailClass = $('detail-class');
    el.detailSection = $('detail-section');
    el.detailPresent = $('detail-present');
    el.detailAbsent = $('detail-absent');
    el.detailLeave = $('detail-leave');
    el.detailPct = $('detail-pct');

    $('fab-add').addEventListener('click', function () { openSheet(null); });
    $('sheet-close').addEventListener('click', window.UI.closeOverlay);
    $('sheet-cancel').addEventListener('click', window.UI.closeOverlay);
    el.form.addEventListener('submit', submit);

    $('detail-close').addEventListener('click', window.UI.closeOverlay);
    $('detail-done').addEventListener('click', window.UI.closeOverlay);
    $('detail-edit').addEventListener('click', function () {
      var id = detailId;
      window.UI.closeOverlay();
      if (id) openSheet(id);
    });

    // Clear a field's error as soon as the teacher starts fixing it.
    FIELDS.forEach(function (field) {
      el.inputs[field].addEventListener('input', function () {
        if (!this.classList.contains('is-invalid')) return;
        this.classList.remove('is-invalid');
        el.errors[field].textContent = '';
        el.errors[field].hidden = true;
      });
    });

    // Sections are stored uppercase; show that while typing.
    el.inputs.section.addEventListener('input', function () {
      var upper = this.value.toUpperCase();
      if (upper === this.value) return;
      var caret = this.selectionStart;
      this.value = upper;
      try { this.setSelectionRange(caret, caret); } catch (err) { /* unsupported */ }
    });

    el.search.addEventListener('input', render);
    el.searchClear.addEventListener('click', function () {
      el.search.value = '';
      render();
      el.search.focus();
    });

    // Signing in as another school must not leave the previous roster on screen.
    window.UI.on('account-changed', function () {
      el.search.value = '';
      render();
      refreshSuggestions();
    });

    /* The register can also change without this screen doing it — a sync from
       another device. Re-rendering here is what makes that visible; edits made
       on this screen have already rendered, and a second pass is harmless. */
    window.UI.on('students-changed', function () {
      render();
      refreshSuggestions();
    });

    initImport();

    render();
    refreshSuggestions();
  }

  window.StudentsUI = {
    init: init, render: render, openDetail: openDetail,
    openImport: openImport, importState: function () { return prepared; }
  };

  /* app.js calls init() from its own DOMContentLoaded handler, which is
     registered first and therefore runs first. This is the fallback for when
     the DOM is already parsed by the time these scripts run — init() is
     guarded, so at most one of the two paths does the work. */
  function boot() { if (window.UI) init(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

}(window, document));
