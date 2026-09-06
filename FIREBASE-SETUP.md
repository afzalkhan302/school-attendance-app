# Connecting your Firebase project

Everything on the client side is written and verified. What is left needs your
Google account, which is not something that can be done for you: creating the
project, copying its keys, and deploying the rules.

Budget twenty minutes. Steps 1–4 are in the Firebase console; 5–8 are
commands here; step 9 is the two-phone check that nothing automated can replace.

---

## 1. Create the project

<https://console.firebase.google.com> → **Add project**. Analytics is not used;
turning it off is fine.

## 2. Turn on Email/Password sign-in

**Build → Authentication → Get started → Email/Password → Enable → Save.**

The app asks teachers for a *username*, not an email. It turns
`abc_admin` into `abc_admin@users.school-attendance.app` before handing it to
Firebase, because Firebase identifies accounts by address. Nothing is ever
delivered to that domain — it only has to be valid and identical on every
device. A useful side effect: Firebase refuses a duplicate address, so
usernames are globally unique without any extra work.

## 3. Create the database

**Build → Firestore Database → Create database.** Choose a region near your
schools. **Start in production mode** — you are about to publish rules that are
stricter than the test-mode defaults anyway.

## 4. Get your keys

**Project settings (gear) → General → Your apps → Web (`</>`)**. Register the
app. Firebase shows a `firebaseConfig` block — save it to a file, say
`my-config.txt`. Copy it exactly as shown; the next step reads it in whatever
shape you pasted.

## 5. Point the app at the project

```bash
npm run connect:firebase -- my-config.txt
```

That writes `js/firebase-config.js` (values only — the instructions in it are
kept) and sets the default project in `.firebaserc`, so the CLI and the app
cannot disagree about which project they mean. It refuses placeholder keys and
a malformed `projectId` rather than letting them fail confusingly later.

It leaves `usernameDomain` alone. **Never change that once schools have signed
up** — it is half of how their accounts are addressed.

## 6. Publish the security rules

```bash
node node_modules/firebase-tools/lib/bin/firebase.js login
npm run deploy:rules
```

The login opens a browser and is the one step that cannot be scripted.

> **Do not skip this.** Until these rules are live, any signed-in user of your
> project can read every school's students and attendance. The client cannot
> enforce isolation — anyone can send requests straight to the database. These
> rules are the only thing that stops it.

You can also paste `firestore.rules` into **Firestore Database → Rules →
Publish** if you would rather not use the CLI.

## 7. Verify the rules that are actually deployed

```bash
npm run verify:deployed
```

This is the step that proves it. `npm run verify:firebase` checks the rules
*file* against the emulator; this one checks **your project** — what was last
published to it, which is a different thing and the one that protects real
data. A correct file that never got published looks identical until you run
this.

It creates two throwaway accounts (`zz-ruletest-…`), has one try every read,
write, overwrite, delete and listing against the other, confirms all of them
are refused, checks signed-out access is refused too, and then deletes both
accounts and their data. Nothing belonging to a real school is touched.

Expect:

```
Project:   your-project-id
All 15 DEPLOYED Firestore rules on project your-project-id passed.
```

If instead you see reads *succeeding*, the rules did not publish. Go back to
step 6 and do not ship the APK until this passes.

If a run is interrupted before cleanup, remove any `zz-ruletest-` users in
**Authentication → Users** and their `schools/<uid>` documents in Firestore.

## 8. Rebuild the APK

```bash
npm run android:apk
```

Confirm cloud mode actually shipped:

```bash
unzip -p android/app/build/outputs/apk/debug/app-debug.apk   assets/public/js/firebase-config.js | grep enabled
```

It must say `enabled: true`. If it says `false`, the build ran before step 5.

---

## 9. Test on two physical phones

This is the part no automated test can stand in for. You need two Android
phones, or one phone and one emulator.

**Install on both**

```bash
adb devices                     # both should be listed
adb -s <serial-1> install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s <serial-2> install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`adb devices` shows the serials. With only one phone plugged in you can drop
the `-s <serial>`.

**A — create the school (phone 1)**

1. Open the app. You get the setup form.
2. School `ABC Public School`, director `Mr. Imran Khan`, username `abc_admin`,
   password `secret123`.
3. It should open the dashboard. *If it says a connection is needed, the phone
   has no internet — creating an account requires one.*
4. Students → add `Ayesha Khan` (father `Imran Khan`, roll 1, class 5, section A)
   and `Bilal Shah` (father `Kamran Shah`, roll 2, class 5, section A).
5. Attendance → class 5, section A, today → mark Ayesha present, Bilal absent →
   Save.

**B — sign in on phone 2 (the actual feature)**

6. Open the app on phone 2. It shows setup, because this device knows nothing.
   Tap **Sign in instead**.
7. Username `abc_admin`, password `secret123`.
8. **Expect:** the dashboard shows *ABC Public School*, 2 students, and today's
   present/absent counts. Students shows both names **with father names**.
   Attendance for today shows Ayesha present, Bilal absent.

That is items 1 through 5 of what you asked for, confirmed on real hardware.

**C — changes travel both ways**

9. On phone 2, add `Chand Bibi` (roll 3, class 5, section A).
10. Within a second or two, phone 1's Students list should show three students
    without being touched. (If phone 1 is asleep, wake it.)
11. Delete `Bilal Shah` on phone 1. He should disappear from phone 2.

**D — offline**

12. Put phone 1 in aeroplane mode.
13. Add `Dawood Khan` (roll 4). It saves — the app is offline-first.
14. Phone 2 should **not** show him yet.
15. Turn aeroplane mode off. Within a few seconds phone 2 should show him.
16. Force-close and reopen phone 1. `Dawood Khan` must still be there.

**E — isolation, the one that matters**

17. On phone 2: Settings → **Log out**.
18. Tap **Create one** and register a *different* school: `XYZ Model School`,
    director `Mrs. Sara Ahmed`, username `xyz_admin`, password `other456`.
19. **Expect: zero students, no attendance, and the app bar reads XYZ Model
    School.** Not one row from ABC may appear anywhere — Students, Attendance,
    Records, Dashboard or an Excel export.
20. Add a student here, then log out and back in as `abc_admin`. ABC must show
    its own three students and nothing from XYZ.

**If step 19 shows anything belonging to ABC, stop.** The rules did not deploy.
Re-run step 7 and do not distribute the APK.

**F — the register survives**

21. On phone 1: Students → Import from Excel, with a sheet of ten students.
    Import them, then check phone 2 receives all ten.
22. Force-close both apps and reopen. Everything should still be there.

---

## Verifying without touching production

The rules and the whole sync layer are covered by tests that run against the
**Firebase emulator** — Google's own Auth and Firestore builds running the real
rules engine locally. Nothing is mocked and nothing touches your project:

```bash
npm run verify:firebase
```

- `tests/rules.js` (23 checks) loads `firestore.rules` into the emulator and
  tries, as one authenticated school, every read and write against another
  school's data — profile, students, attendance, listing, overwriting,
  deleting — plus unauthenticated access and paths outside the tree.
- `tests/firebase-live.js` (23 checks) drives the real `js/cloud.js` through
  register, sign-in on a second device, push, pull, deletion propagation,
  wrong passwords, duplicate usernames, cross-school access on the wire, and
  offline queueing with `disableNetwork` / `enableNetwork`.

Run this after any change to `firestore.rules`, before deploying it.

## What the emulator does not prove

- **That your project has the rules deployed.** The emulator loads the file
  from disk; your project uses whatever was last published to it. Step 5 is
  yours to get right, and step 8.5 is how you confirm it.
- **Real latency and flaky mobile connections.** Everything here runs on
  localhost.
- **Firestore's on-disk offline cache.** `enablePersistence()` needs IndexedDB,
  which Node does not have, so the offline test ran against the in-memory
  cache. The queue-and-flush behaviour is verified; that a *closed and
  reopened* app still holds queued writes is not. The app's own IndexedDB
  store keeps the data regardless, so nothing is lost either way — it would
  only mean a re-push on next launch.
- **The exact vendored browser bundle.** The live tests load the same Firebase
  release (12.18.0) through Node's entry point, because the file in
  `js/vendor/` is a browser IIFE that Node cannot link. The bundle is what runs
  in the APK.
