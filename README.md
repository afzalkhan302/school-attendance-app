# School Attendance

An offline-first attendance app for schools. Built as a mobile-first web app
with no framework and no build step, so it can be wrapped into an Android APK
with Capacitor later without a rewrite.

## Status

| Step | Feature | State |
|------|---------|-------|
| 1 | Student management (add / edit / delete / details) | **Done** |
| 2 | Attendance marking + records | **Done** |
| 3 | School accounts, login, settings, data isolation | **Done** |
| 4 | Dashboard, father name, Excel export, mobile polish | **Done** |
| 5 | Local storage | **Done** |
| 6 | Mobile UI | **Done** |
| 7 | Android platform (Capacitor) | **Done** |
| 8 | Excel student import | **Done** |
| 9 | Cloud accounts, multi-device sync | **Done** — verified on the Firebase emulator; needs your project to go live (`FIREBASE-SETUP.md`) |

## Running it

```bash
npm start          # http://localhost:5173
```

The server also prints a LAN address — open that on an Android phone (same
Wi-Fi) to try the real thing. Or just open `index.html` directly in a browser;
there is no build step.

## Tests

```bash
npm test                    # everything (518 tests)

npm run test:model          # student model + father name
npm run test:attendance     # attendance model, dates, dashboard aggregates
npm run test:accounts       # accounts, sign-in, isolation, hashing
npm run test:export         # daily and monthly Excel sheets
npm run test:storage        # IndexedDB, migration, write failures
npm run test:boot           # boot resilience, scroll lock
npm run test:import         # Excel parsing, validation, duplicates
npm run test:cloud          # cloud accounts across two devices
npm run test:ui-import      # the import screen, in jsdom
npm run test:ui             # students screen, in jsdom
npm run test:ui-attendance  # attendance + records screens, in jsdom
npm run test:ui-accounts    # setup, sign-in, settings, isolation, in jsdom
npm run test:ui-dashboard   # dashboard, father name, details, export, in jsdom
npm run test:ui-storage     # IndexedDB through the real UI, in jsdom

npm run verify:firebase     # 46 checks against the real Firebase emulator
```

`verify:firebase` is separate from `npm test` because it starts the Firebase
emulator (which needs Java). It runs `tests/rules.js` and `tests/firebase-live.js`
against Google's own Auth and Firestore builds and the real rules engine —
nothing mocked, and nothing that touches a live project. See `FIREBASE-SETUP.md`.

`jsdom` and `fake-indexeddb` are devDependencies used only by the tests —
neither Node nor jsdom ships an IndexedDB, so the suites inject one to
exercise the real code path.

The UI suites serve the real `index.html` over HTTP and drive it in jsdom, so
the actual markup, script order and event wiring are exercised.

The app has **no npm runtime dependencies and no build step for its own code**.
Two libraries are vendored in `js/vendor/` (SheetJS for reading Excel, the
Firebase SDK for cloud accounts); both are loaded lazily, so a school that never
imports a spreadsheet and never turns on cloud accounts downloads and parses
neither. See `js/vendor/README.md` for versions and provenance.

**The app touches the network only when cloud accounts are switched on.** Left
off, it behaves exactly as it always has: everything on the device, nothing
sent anywhere.

## Layout

```
index.html        auth view + app shell: five screens, sheets, dialogs
css/styles.css    mobile-first styles, light + dark, safe-area aware
js/crypto.js      SHA-256 and salted password hashing (no dependencies)
js/storage.js     durable key/value store: IndexedDB -> localStorage -> memory
js/db.js          data model: schools, students, attendance
js/export.js      daily and monthly Excel sheets (CSV builders, no DOM)
js/app.js         auth/app routing, branding, tabs, sheet, dialog, toast, download
js/auth.js        first-time school setup and sign-in
js/dashboard.js   home screen: live totals and recent attendance
js/students.js    students screen and the student detail view
js/attendance.js  attendance marking screen
js/records.js     daily and monthly attendance reports + export
js/settings.js    school profile, credentials, logo, logout
js/import.js      reads an Excel workbook into validated student rows
js/cloud.js       optional Firebase auth + Firestore replica
js/cloud-sync.js  joins the cloud to the app: merge in, push out
js/firebase-config.js   YOUR project keys (empty = cloud off)
js/vendor/        SheetJS and the Firebase SDK, loaded on demand
firestore.rules   security rules — deploy these or schools can read each other
tools/serve.js    dev-only static server
tools/build.js    assembles www/ for Capacitor
tools/apk.js      build + sync + gradlew assembleDebug
tests/            model tests and UI tests
```

Screens never call into each other. They announce changes on a small event bus
(`UI.emit` / `UI.on`), so signing in as another school, or deleting a student,
refreshes every affected screen without any screen knowing about the others.

## Storage

**IndexedDB is the store.** `js/storage.js` keeps one object store of string
values, falling back to `localStorage` and then to memory. It is hand-written
rather than pulled from a library: the app needs one key/value store, which is
a fraction of what idb-keyval or Dexie carry, and nothing else here has a
runtime dependency.

Two rules make it safe, and both exist because of bugs found in the earlier
`localStorage`-only layer:

1. **Reads always come from the cache**, hydrated once at startup from
   whichever backend opened. Nothing can later swap the read source for an
   empty map, so a failing write can never make saved data look missing —
   which is exactly what used to happen.
2. **A failed write rolls the cache back and reports the error.** Memory never
   claims to hold more than the disk does, and `SchoolDB.flush()` tells the
   caller whether the write landed, so the UI never says "saved" unless it did.

Reads stay synchronous, so the screens are unchanged. Writes are optimistic and
settle later; every write call site waits on `UI.afterSave()` before showing
success, and re-renders against stored data if the write failed.

### Migrating a device from the old build

On first launch, anything under a `sa.` key in `localStorage` is copied into
IndexedDB, **read back and compared byte-for-byte**, and only then recorded as
migrated. The `localStorage` originals are deliberately left in place. If
verification fails the flag is not set, the legacy values keep being served,
and the next launch tries again.

## Accounts and data isolation

Several schools can share one device. Isolation is a property of **where the
data lives**, not a filter someone has to remember to apply. The same key names
are used inside IndexedDB:

```
sa.accounts.v1                     every school account on this device
sa.session.v1                      who is signed in (only if "remember" is on)
sa.<accountId>.students.v1         one school's register
sa.<accountId>.attendance.v1       one school's attendance
```

`SchoolDB.Students` and `SchoolDB.Attendance` resolve their storage key from
the active session on every call. Signed out, that key is `null` and every
read returns empty — there is no code path that can read another school's rows.

### Accounts

```json
{
  "id": "acc_m4x2k1abc",
  "schoolName": "ABC Public School",
  "directorName": "Mr. Imran Khan",
  "username": "abc_admin",
  "salt": "e5d5ede4f9b2b9cb004a260cdd3f8f55",
  "iterations": 20000,
  "passwordHash": "…64 hex chars…",
  "logo": "data:image/png;base64,…",
  "createdAt": 1757000000000,
  "updatedAt": 1757000000000
}
```

- School name and username must both be unique on the device, because sign-in
  accepts either one.
- Usernames are 3–24 of `a–z A–Z 0–9 . - _`; passwords are at least 6
  characters.
- The password is never stored. `js/crypto.js` computes a salted SHA-256
  stretched over 20,000 iterations; each account gets its own random salt, and
  changing a password re-salts. Digests are compared with a length-independent
  equality check.
- **What this is and is not:** it stops the password being readable at a glance
  from device storage. It is not server-side authentication, and someone with
  the unlocked device can still brute-force a weak password offline. There is
  no password reset — that would need a server.
- Logos are resized to 256px and stored as a data URL, capped at ~300 KB so the
  storage quota is not at risk. Only `data:image/(png|jpeg|webp|gif)` is
  accepted.

### Sessions

"Remember login on this device" writes the session to `localStorage`, so the
app reopens signed in. Unchecked, it goes to `sessionStorage` and closing the
app signs you out. Logging out clears both. A session pointing at an account
that no longer exists is ignored rather than trusted.

### Upgrading an older device

Data written before accounts existed (`sa.students.v1`, `sa.attendance.v1`) is
adopted by the **first** school registered, so updating the app does not look
like losing the register. The old keys are copied, not moved, and a second
school never receives them.

## Students and attendance

### Students — `sa.<accountId>.students.v1`

```json
{
  "id": "s_m4x2k1abc",
  "name": "Ayesha Khan",
  "fatherName": "Imran Khan",
  "roll": "12",
  "className": "5",
  "section": "A",
  "createdAt": 1757000000000,
  "updatedAt": 1757000000000
}
```

- Name, roll number, class and section are all required.
- **Father name is optional.** Making it mandatory would have blocked editing
  every student saved before the field existed. Rows without it read back as
  `""`, never `undefined`, so nothing downstream has to check. It appears on
  the student card, the detail view, the attendance list, both reports and both
  Excel sheets, and it is searchable alongside the student name.
- A roll number is unique **within a class + section of one school** — roll 12
  can exist in 5-A and 5-B, and in another school entirely.
- Sections are stored uppercase and whitespace is collapsed, so `5-a` and `5-A`
  are one group.
- Sorting is natural: class 2 before class 10, roll 2 before roll 10.

### Attendance — `sa.<accountId>.attendance.v1`

A map keyed by `"<studentId>|<date>"`.

```json
{
  "s_m4x2k1abc|2026-09-04": {
    "studentId": "s_m4x2k1abc",
    "date": "2026-09-04",
    "status": "present",
    "className": "5",
    "section": "A",
    "markedAt": 1757000000000
  }
}
```

The key is why **duplicates cannot happen**: one student can hold only one
record per date, structurally. Saving the same date again overwrites in place,
so re-opening a date loads what is there and saving again is an edit.

- Status is `present`, `absent` or `leave`. Anything else is refused.
- A student left unmarked has no record written; an earlier one for that date
  is cleared rather than guessed at.
- `className` / `section` are recorded **as of the day attendance was taken**,
  so moving a student later does not rewrite history.
- Deleting a student deletes their attendance — no orphaned records.
- Dates are local calendar days (`yyyy-mm-dd`). `Date#toISOString` is avoided
  because it converts to UTC and would file attendance under the wrong day for
  anyone not on GMT.
- Attendance percentage is present days ÷ days recorded.

If storage is unavailable (private mode, site data blocked), the app falls back
to memory for the session and warns rather than failing.

## Excel export

The Records screen exports whichever report is on screen — *Export day to
Excel* in daily mode, *Export month to Excel* in monthly mode — honouring the
class, section and search filters in force.

Both sheets are **CSV**, not `.xlsx`. A real spreadsheet file is a ZIP archive,
and building one would mean shipping a compression library into an app that
otherwise has no dependencies and must run offline. Excel, LibreOffice and
Google Sheets all open these directly; the byte-order mark on the front is what
makes Excel read them as UTF-8, so Urdu, Arabic and other non-ASCII names
survive intact. Cells beginning `=`, `+`, `-` or `@` are prefixed with an
apostrophe, because a student name is never a formula.

- **Daily** — one row per student: number, roll, name, father name, class,
  section, status; then the day's present/absent/leave tally and percentage.
- **Monthly** — a register grid: one row per student, one column per day that
  has any attendance in the month (`P` / `A` / `L`, blank where nothing was
  recorded), then totals and an attendance percentage.

Both are headed with the school name, director and the date or month.

## Using it

**First run** — set up the school: name, director, username, password, and
optionally a logo. That account is created on the device and signed in.

**Dashboard** — the home screen. School logo and name, total students, and
today's present / absent / leave counts with an attendance percentage, all read
from saved records at render time. Below that, the last five recorded days —
tap one to open it in the report — and a quick button that reads *Take
attendance*, *Continue attendance* or *Review attendance* depending on what is
still outstanding.

**Branding** — the school name and logo appear in the app bar on every screen,
on the settings screen, and at the head of every report, ready for the same
stamp on an Excel export later.

**Students** — add, edit and delete; search by name, father name, roll, class or
section. Tapping a card opens a read-only detail view with that student's
attendance history tallied.

**Attendance** — pick class, section and date; the roster loads underneath. Tap
Present / Absent / Leave per student (tapping the active one clears it), or
*Mark all present* and correct the exceptions. Counts update live. Saving with
students unmarked asks first. Leaving the screen, or changing class/section/
date, with unsaved marks asks before discarding.

**Records** — *Daily* shows one date with every student's status and a
summary. *Monthly* rolls a month up into per-student totals and percentages.
Both filter by class and section and search by name or roll.

**Settings** — change school name, director, username (needs the password),
password (needs the current one), logo, and log out.

## Importing students from Excel

*Students > Import from Excel.* Takes `.xlsx` and `.xls`. The sheet needs a
heading row naming **Student Name**, **Roll Number**, **Class** and **Section**;
**Father Name** is optional, as it is everywhere else.

Headings are matched loosely — `Roll No.`, `roll_number` and `RollNumber` all
land on the same field — and a title row or two above the headings is fine.
Numeric cells become text, so a roll typed as a number still reads as `7`.

Nothing is written until the preview is confirmed. Every row is shown with its
verdict:

- **Will import** — good.
- **Duplicate** — that roll number is already used in that class and section,
  either by a student on file or by an earlier row in the same file. The first
  occurrence wins and the rest are reported, never silently merged.
- **Error** — a required field is missing or too short, with the reason.

Importing writes the good rows through the same `Students.create` the Add
Student form uses, so there is no second, weaker way into the register. Manual
Add Student is unchanged.

The file is read in the page with `FileReader`. It is never uploaded.

## Cloud accounts (optional)

Off by default. Filling in `js/firebase-config.js` turns on one account that
works on any number of phones — the setup steps are in that file, and the
security rules to deploy are in `firestore.rules`.

**The local store stays the source of every read.** Firestore is a replica, so
every screen, and the whole offline story, is unchanged:

```
sign in  ->  Firebase Auth checks the password
             the school is pulled down and merged into the local store
             the app carries on reading locally, exactly as before
change   ->  saved locally first, then mirrored up
remote   ->  a snapshot listener merges the change in and re-renders
```

- **Usernames** become addresses (`abc_admin@users.school-attendance.app`)
  because Firebase Auth identifies accounts by email. Nothing is delivered
  there; it only has to be valid and the same on every device. Firebase then
  enforces username uniqueness for free.
- **Isolation is structural.** Everything lives under `schools/{uid}/…` and the
  rules allow a request only where `request.auth.uid == uid`. There is no query
  a signed-in teacher can write that reaches another school.
- **A pull is a merge, not an overwrite.** The last agreed state is kept as a
  common ancestor, so a row missing from an incoming snapshot is recognised as
  *deleted elsewhere* only if the cloud previously had it — otherwise it is
  something this phone added and has not pushed yet, and it survives. Without
  that, a snapshot arriving before the first push wipes unsynced work.
- **Offline:** a device that has signed in before signs in again with no signal,
  from the local copy. Creating a *new* account needs a connection, and says so.
- **Conflicts** are last-write-wins per document. Two phones editing different
  students merge cleanly; two phones editing the same student, the later write
  wins.

### How it was verified

`npm run verify:firebase` runs 46 checks against the **Firebase emulator** —
Google's Auth and Firestore, running the real rules engine. `tests/rules.js`
attacks the isolation directly: as one authenticated school, every read, write,
overwrite, delete and listing aimed at another school, plus unauthenticated
access. `tests/firebase-live.js` drives the real `js/cloud.js` through register,
sign-in on a second device, sync both ways, deletion propagation, wrong
passwords, duplicate usernames, and offline queueing via Firestore's own
`disableNetwork` / `enableNetwork`.

The `tests/cloud.js` suite with its in-memory double is kept as well — it runs
in `npm test` without needing Java or the emulator, and covers the UI wiring
that the live tests do not reach.

### What is not done

- **The app is not connected to a live Firebase project yet.** `js/firebase-config.js`
  is empty, so cloud accounts are off and the app runs device-only. Creating the
  project, copying the keys and publishing the rules need a Google account:
  `FIREBASE-SETUP.md` has the steps.
- No password reset — that needs email, and usernames here are synthetic
  addresses. Changing a password still works from Settings on a signed-in device.
- Existing device-only schools are not uploaded automatically. They keep working
  locally; there is no migrate-to-cloud button yet.
- **This has been tested against a fake Firebase, not a real project.** The
  suite in `tests/cloud.js` runs two jsdom devices against one in-memory backend
  and covers register, sign-in, pull, push, delete propagation, isolation
  between schools, wrong passwords and offline behaviour — but the real SDK,
  real security rules and real latency have not been exercised. Try it on two
  phones before relying on it.

## Android

The app code is unchanged by this — Capacitor loads the same `index.html` from
the APK's assets that the browser loads over HTTP.

```bash
npm run build          # assemble www/ from index.html, css/ and js/
npm run android:sync   # build, then copy into android/
npm run android:apk    # build, sync, and assemble a debug APK
npm run android:open   # open the project in Android Studio
```

The APK lands at
`android/app/build/outputs/apk/debug/app-debug.apk`.

### Why there is a build step now

There is still no bundler and nothing is transformed. `tools/build.js` only
copies the shipping files into `www/`, because Capacitor packages its `webDir`
verbatim: pointing it at the project root would put `node_modules/`, `tests/`
and `android/` inside the APK. The script also fails the build if `index.html`
references a file that did not make it into `www/` — on a phone that mistake is
a blank white screen rather than an error.

### What the native side needs

| Requirement | Version |
|---|---|
| JDK | 21 |
| Android SDK Platform | 36 |
| Android SDK Build-Tools | 36.0.0 |
| Gradle | 8.14.3, via the checked-in wrapper — do not install it separately |
| minSdk | 24 (Android 7.0) |

`android/local.properties` points Gradle at the SDK. It is machine-specific and
not source-controlled; Android Studio regenerates it, or write `sdk.dir`
by hand.

`AndroidManifest.xml` sets `android:windowSoftInputMode="adjustResize"` on the
activity. Without it the keyboard pans the WebView instead of resizing it, the
viewport units keep reporting the full screen height, and the lower half of a
form ends up behind the keyboard with no way to scroll to it. `cap sync` does
not overwrite the manifest, so the setting survives.

### Boot must always reach a screen

`#auth-view` and `#app-view` both start hidden, so nothing is painted until the
stored data has loaded and boot routes to one of them. That makes a stalled read
indistinguishable from a broken app: a blank screen, and on a phone no console
to ask why. Three things guarantee it ends somewhere:

1. Every IndexedDB step in `js/storage.js` is bounded — the open at 5s, the
   hydrating read at 8s — and the read settles on transaction abort and error,
   not only on request error.
2. `js/app.js` keeps a 9s failsafe. If boot has still routed nowhere it shows
   the **sign-in** form. It never opens the app: a stalled read is not a reason
   to let anyone past authentication.
3. `index.html` installs an error handler before any other script, so a throw
   during startup renders the message on the page instead of leaving it blank.
