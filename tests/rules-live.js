/* Proves the rules that are ACTUALLY DEPLOYED to your Firebase project keep
   schools apart:  npm run verify:deployed

   The emulator suite (tests/rules.js) checks the firestore.rules FILE. This
   checks the project — what was last published to it, which is a different
   thing and the one that protects real data. A correct file that was never
   published leaves every school readable by every other, and only this test
   can tell you that.

   It talks to your live project. To do that it creates two throwaway accounts,
   has one try to read and write the other's data, and deletes both afterwards.
   Names are stamped and prefixed `zz-ruletest-` so they are obvious if a run
   is interrupted before cleanup.

   Nothing belonging to a real school is read, written or deleted.
*/

'use strict';

var path = require('path');
var h = require('./harness');

var describe = h.describe, it = h.it;
var assert = h.assert, equal = h.equal;

/* ------------------------------------------------------------------ config */

var CONFIG_PATH = path.resolve(__dirname, '..', 'js', 'firebase-config.js');
var fs = require('fs');

function loadConfig() {
  var source = fs.readFileSync(CONFIG_PATH, 'utf8');
  var sandbox = { window: {} };
  new Function('window', source)(sandbox.window);
  return sandbox.window.SchoolCloudConfig || {};
}

var config = loadConfig();

if (!config.enabled || !config.apiKey || !config.projectId) {
  console.error('\nCloud accounts are not configured yet.');
  console.error('Run:  npm run connect:firebase -- path/to/config.json');
  console.error('(see FIREBASE-SETUP.md)\n');
  process.exit(1);
}

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('\nThis test is for the REAL project. Emulator host variables are set,');
  console.error('which would make it pass without proving anything about production.\n');
  process.exit(1);
}

/* ------------------------------------------------------------------ setup */

var firebase = require('firebase/compat/app');
require('firebase/compat/auth');
require('firebase/compat/firestore');

var STAMP = Date.now().toString(36);
var DOMAIN = config.usernameDomain || 'users.school-attendance.app';

function emailFor(name) { return 'zz-ruletest-' + name + '-' + STAMP + '@' + DOMAIN; }

var A = { email: emailFor('a'), password: 'ruletest-' + STAMP };
var B = { email: emailFor('b'), password: 'ruletest-' + STAMP };

var STUDENT = {
  name: 'Rule Test Student', fatherName: 'Rule Test Father',
  roll: '1', className: '1', section: 'A', createdAt: 1, updatedAt: 1
};

function isDenied(err) {
  if (!err) return false;
  if (err.code === 'permission-denied' || err.code === 'unauthenticated') return true;
  return /permission|insufficient|unauthenticated|PERMISSION_DENIED|No matching allow statements|false for '/i
    .test(err.message || '');
}

/** Run something that must be refused, and say whether it was. */
async function wasRefused(run) {
  try {
    await run();
  } catch (err) {
    if (isDenied(err)) return true;
    throw err;         // a real failure, not a refusal — never count it as one
  }
  return false;
}

async function signIn(who) {
  try {
    return await firebase.auth().signInWithEmailAndPassword(who.email, who.password);
  } catch (err) {
    if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      return firebase.auth().createUserWithEmailAndPassword(who.email, who.password);
    }
    throw err;
  }
}

async function main() {
  firebase.initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId
  });

  var db = firebase.firestore();

  console.log('\nProject:   ' + config.projectId);
  console.log('Accounts:  ' + A.email);
  console.log('           ' + B.email);

  var uidA, uidB;

  /* ==================================================================== */
  describe('two throwaway accounts on the live project');

  await it('creates the first and writes a student', async function () {
    var credential = await signIn(A);
    uidA = credential.user.uid;
    await db.doc('schools/' + uidA).set({ schoolName: 'Rule Test A', updatedAt: Date.now() });
    await db.doc('schools/' + uidA + '/students/rt_1').set(STUDENT);
  });

  await it('creates the second and writes its own', async function () {
    await firebase.auth().signOut();
    var credential = await signIn(B);
    uidB = credential.user.uid;
    assert(uidB !== uidA, 'two separate accounts');
    await db.doc('schools/' + uidB).set({ schoolName: 'Rule Test B', updatedAt: Date.now() });
    await db.doc('schools/' + uidB + '/students/rt_2').set(STUDENT);
  });

  /* ==================================================================== */
  describe('the DEPLOYED rules keep them apart');

  // Signed in as B for all of these.

  await it('B cannot read A profile', async function () {
    equal(await wasRefused(function () { return db.doc('schools/' + uidA).get(); }), true);
  });

  await it('B cannot list A students', async function () {
    equal(await wasRefused(function () {
      return db.collection('schools/' + uidA + '/students').get();
    }), true);
  });

  await it('B cannot read one of A students directly', async function () {
    equal(await wasRefused(function () {
      return db.doc('schools/' + uidA + '/students/rt_1').get();
    }), true);
  });

  await it('B cannot read A attendance', async function () {
    equal(await wasRefused(function () {
      return db.collection('schools/' + uidA + '/attendance').get();
    }), true);
  });

  await it('B cannot write into A register', async function () {
    equal(await wasRefused(function () {
      return db.doc('schools/' + uidA + '/students/injected').set(STUDENT);
    }), true);
  });

  await it('B cannot overwrite one of A students', async function () {
    equal(await wasRefused(function () {
      return db.doc('schools/' + uidA + '/students/rt_1').set({ name: 'Vandalised' });
    }), true);
  });

  await it('B cannot delete A students', async function () {
    equal(await wasRefused(function () {
      return db.doc('schools/' + uidA + '/students/rt_1').delete();
    }), true);
  });

  await it('B cannot list every school on the project', async function () {
    equal(await wasRefused(function () { return db.collection('schools').get(); }), true);
  });

  await it('B cannot write outside the schools tree', async function () {
    equal(await wasRefused(function () { return db.doc('anythingElse/x').set({ a: 1 }); }), true);
  });

  await it('B can still use its own data', async function () {
    var own = await db.collection('schools/' + uidB + '/students').get();
    equal(own.size, 1, 'its own register is readable');
  });

  /* ==================================================================== */
  describe('signed out, the project gives up nothing');

  await it('refuses an unauthenticated read', async function () {
    await firebase.auth().signOut();
    equal(await wasRefused(function () { return db.doc('schools/' + uidA).get(); }), true);
  });

  await it('refuses an unauthenticated write', async function () {
    equal(await wasRefused(function () {
      return db.doc('schools/' + uidA + '/students/x').set(STUDENT);
    }), true);
  });

  /* ==================================================================== */
  describe('A is intact after everything B tried');

  await it('still has exactly its own one student, unmodified', async function () {
    await signIn(A);
    var students = await db.collection('schools/' + uidA + '/students').get();
    equal(students.size, 1, 'nothing was injected or deleted');

    var row = await db.doc('schools/' + uidA + '/students/rt_1').get();
    equal(row.data().name, 'Rule Test Student', 'and nothing was vandalised');
  });

  /* ------------------------------------------------------------ cleanup */

  await cleanUp();
  h.report('DEPLOYED Firestore rules on project ' + config.projectId);
}

/** Remove both throwaway accounts and their data. */
async function cleanUp() {
  console.log('\ncleaning up the throwaway accounts…');

  for (var who of [A, B]) {
    try {
      await firebase.auth().signOut();
      var credential = await signIn(who);
      var uid = credential.user.uid;
      var db = firebase.firestore();

      var students = await db.collection('schools/' + uid + '/students').get();
      for (var doc of students.docs) await doc.ref.delete();

      var attendance = await db.collection('schools/' + uid + '/attendance').get();
      for (var mark of attendance.docs) await mark.ref.delete();

      await db.doc('schools/' + uid).delete();
      await credential.user.delete();       // a user may always delete itself
      console.log('  removed ' + who.email);
    } catch (err) {
      console.log('  COULD NOT fully remove ' + who.email + ': ' + (err.message || err));
      console.log('  Delete it by hand in Authentication > Users, and its');
      console.log('  schools/<uid> document in Firestore.');
    }
  }
}

/* report() exits 1 itself if anything failed, and cleanUp() has already run by
   then. The explicit exit is because the Firebase SDK holds the event loop
   open with its connections. */
main().then(function () {
  process.exit(0);
}).catch(async function (err) {
  console.error('\n' + (err && err.stack ? err.stack : err));

  if (err && /auth\/operation-not-allowed/.test(err.code || '')) {
    console.error('\nEmail/Password sign-in is not enabled on this project.');
    console.error('Authentication > Sign-in method > Email/Password > Enable.\n');
  }
  if (err && /PERMISSION_DENIED|permission-denied/.test(err.code || err.message || '')) {
    console.error('\nEven the setup writes were refused. Are firestore.rules deployed?');
    console.error('  npm run deploy:rules\n');
  }

  try { await cleanUp(); } catch (cleanupError) { /* reported inside */ }
  process.exit(1);
});
