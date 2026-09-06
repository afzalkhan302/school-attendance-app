/* Security rules, evaluated by the real Firestore rules engine.

   This is NOT the fake in tests/fake-firebase.js. It loads firestore.rules
   into the Firebase emulator — Google's own Firestore build, running the same
   rules evaluator that runs in production — and asks it, as two separately
   authenticated schools, whether it will serve requests it should refuse.

   The client can never be trusted to enforce isolation: anyone can send
   whatever request they like straight to the database. These rules are the
   only thing that actually stops one school reading another's register, so
   they get tested against the real evaluator rather than a stand-in.

   Needs the emulator running:
       npm run emulators          (leave it running in another terminal)
       npm run test:rules

   `npm run verify:firebase` does both in one go.
*/

'use strict';

var fs = require('fs');
var path = require('path');
var h = require('./harness');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal;

var testing = require('@firebase/rules-unit-testing');
var PROJECT = 'demo-school-attendance';

var SCHOOL_A = 'uid_school_a';
var SCHOOL_B = 'uid_school_b';

var STUDENT = {
  name: 'Ayesha Khan', fatherName: 'Imran Khan',
  roll: '1', className: '5', section: 'A', createdAt: 1, updatedAt: 1
};

var MARK = {
  studentId: 's_1', date: '2026-09-04', status: 'present',
  className: '5', section: 'A', markedAt: 1
};

/* The rules engine reports a refusal in several different shapes depending on
   the operation — "PERMISSION_DENIED", "false for 'get' @ L38", "No matching
   allow statements", "Null value error." — so classifying them by matching the
   message is guesswork. assertFails / assertSucceeds are the library's own
   helpers and know every shape. A wrong answer here would be the worst kind:
   a test that reports isolation is fine when it is not. */
var assertFails = testing.assertFails;
var assertSucceeds = testing.assertSucceeds;

/** Assert the rules ALLOW this. Rejects (failing the test) if they refuse. */
function permitted(promise) { return assertSucceeds(promise); }

/** Assert the rules REFUSE this. Rejects (failing the test) if they allow it. */
function refused(promise) { return assertFails(promise); }

async function main() {
  var env;
  try {
    env = await testing.initializeTestEnvironment({
      projectId: PROJECT,
      firestore: {
        rules: fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8'),
        host: '127.0.0.1',
        port: 8080
      }
    });
  } catch (err) {
    console.error('\nCould not reach the Firestore emulator on 127.0.0.1:8080.');
    console.error('Start it first:  npm run emulators\n');
    console.error(err.message);
    process.exit(1);
  }

  await env.clearFirestore();

  var a = env.authenticatedContext(SCHOOL_A).firestore();
  var b = env.authenticatedContext(SCHOOL_B).firestore();
  var nobody = env.unauthenticatedContext().firestore();

  /* Seed both schools with the rules bypassed, so the tests below are about
     reading and writing, not about whether the seed itself was permitted. */
  await env.withSecurityRulesDisabled(async function (context) {
    var db = context.firestore();
    await db.doc('schools/' + SCHOOL_A).set({ schoolName: 'ABC Public School' });
    await db.doc('schools/' + SCHOOL_A + '/students/s_1').set(STUDENT);
    await db.doc('schools/' + SCHOOL_A + '/attendance/s_1|2026-09-04').set(MARK);

    await db.doc('schools/' + SCHOOL_B).set({ schoolName: 'XYZ Model School' });
    await db.doc('schools/' + SCHOOL_B + '/students/s_2').set(STUDENT);
    await db.doc('schools/' + SCHOOL_B + '/attendance/s_2|2026-09-04').set(MARK);
  });

  /* ==================================================================== */
  describe('a school can use its own data');

  await it('reads its own profile', async function () {
    await permitted(a.doc('schools/' + SCHOOL_A).get());
  });

  await it('reads its own students', async function () {
    await permitted(a.collection('schools/' + SCHOOL_A + '/students').get());
  });

  await it('reads its own attendance', async function () {
    await permitted(a.collection('schools/' + SCHOOL_A + '/attendance').get());
  });

  await it('writes its own students', async function () {
    await permitted(
      a.doc('schools/' + SCHOOL_A + '/students/s_new').set(STUDENT)
    );
  });

  await it('writes its own attendance', async function () {
    await permitted(
      a.doc('schools/' + SCHOOL_A + '/attendance/s_new|2026-09-05').set(MARK)
    );
  });

  await it('deletes its own rows', async function () {
    await permitted(a.doc('schools/' + SCHOOL_A + '/students/s_new').delete());
  });

  /* ==================================================================== */
  describe('a school cannot touch another school');

  await it('cannot read the other profile', async function () {
    await refused(a.doc('schools/' + SCHOOL_B).get());
  });

  await it('cannot list the other register', async function () {
    await refused(a.collection('schools/' + SCHOOL_B + '/students').get());
  });

  await it('cannot read one of their students directly', async function () {
    await refused(a.doc('schools/' + SCHOOL_B + '/students/s_2').get());
  });

  await it('cannot read their attendance', async function () {
    await refused(a.collection('schools/' + SCHOOL_B + '/attendance').get());
  });

  await it('cannot write into their register', async function () {
    await refused(
      a.doc('schools/' + SCHOOL_B + '/students/injected').set(STUDENT)
    );
  });

  await it('cannot overwrite one of their students', async function () {
    await refused(
      a.doc('schools/' + SCHOOL_B + '/students/s_2').set({ name: 'Vandalised' })
    );
  });

  await it('cannot delete their students', async function () {
    await refused(a.doc('schools/' + SCHOOL_B + '/students/s_2').delete());
  });

  await it('cannot rewrite their attendance', async function () {
    await refused(
      a.doc('schools/' + SCHOOL_B + '/attendance/s_2|2026-09-04').set(MARK)
    );
  });

  await it('cannot reach them from the other direction either', async function () {
    await refused(b.doc('schools/' + SCHOOL_A + '/students/s_1').get());
    await refused(b.doc('schools/' + SCHOOL_A).get());
  });

  await it('cannot list every school to find out who exists', async function () {
    await refused(a.collection('schools').get());
  });

  /* ==================================================================== */
  describe('nobody signed in gets nothing');

  await it('cannot read a profile', async function () {
    await refused(nobody.doc('schools/' + SCHOOL_A).get());
  });

  await it('cannot read students', async function () {
    await refused(nobody.collection('schools/' + SCHOOL_A + '/students').get());
  });

  await it('cannot write anything', async function () {
    await refused(nobody.doc('schools/' + SCHOOL_A + '/students/x').set(STUDENT));
  });

  await it('cannot create a school of its own', async function () {
    await refused(nobody.doc('schools/anything').set({ schoolName: 'Squatter' }));
  });

  /* ==================================================================== */
  describe('nothing is readable outside the schools tree');

  await it('refuses a collection the rules never mention', async function () {
    await refused(a.doc('anythingElse/x').set({ a: 1 }));
    await refused(a.doc('anythingElse/x').get());
  });

  /* ==================================================================== */
  describe('the data actually survived the permitted writes');

  await it('school A still holds exactly its own rows', async function () {
    var students = await a.collection('schools/' + SCHOOL_A + '/students').get();
    equal(students.size, 1, 'the seeded student, and the one added then deleted');

    var attendance = await a.collection('schools/' + SCHOOL_A + '/attendance').get();
    equal(attendance.size, 2, 'seeded mark plus the one written above');
  });

  await it('school B is untouched by everything A tried', async function () {
    await env.withSecurityRulesDisabled(async function (context) {
      var db = context.firestore();
      var students = await db.collection('schools/' + SCHOOL_B + '/students').get();
      equal(students.size, 1, 'no row was injected');

      var row = await db.doc('schools/' + SCHOOL_B + '/students/s_2').get();
      equal(row.data().name, 'Ayesha Khan', 'and none was vandalised');
    });
  });

  await env.cleanup();
  h.report('Firestore security rules (real rules engine)');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
