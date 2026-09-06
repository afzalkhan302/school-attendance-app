/* ==========================================================================
   firebase-config.js — YOUR Firebase project goes here.

   Until this is filled in the app runs exactly as it always has: accounts and
   data live on the device only, and nothing is sent anywhere. Filling it in
   turns on cloud accounts, so one username and password works on any phone.

   ---------------------------------------------------------------------------
   HOW TO FILL THIS IN
   ---------------------------------------------------------------------------

   1. Go to https://console.firebase.google.com and create a project.

   2. In the project, open  Build > Authentication > Get started
      and enable the  Email/Password  provider.

   3. Open  Build > Firestore Database > Create database.
      Start in production mode and pick a region near your schools.

   4. Open  Project settings (the gear) > General, scroll to "Your apps",
      and add a Web app (the </> icon). Firebase shows you a config block
      that looks exactly like the one below. Copy the values across.

   5. Publish the security rules in  firestore.rules  (in this folder):
        Firestore Database > Rules > paste the file > Publish
      Those rules are what stop one school reading another school's data.
      WITHOUT THEM ANY SIGNED-IN USER CAN READ EVERYTHING.

   6. Set  enabled: true  below, then rebuild the APK.

   Do not commit real keys to a public repository. A Firebase web apiKey is
   not a secret — it identifies the project, it does not grant access — but the
   security rules absolutely are what protect the data. Get step 5 right.
   ========================================================================== */

window.SchoolCloudConfig = {
  /* Written by tools/connect-firebase.js. */
  enabled: true,

  apiKey: "AIzaSyCfSf2BAYVtJ3Kdd3EhHA0Y4__SXLCun0Q",
  authDomain: "school-attendance-app-da033.firebaseapp.com",
  projectId: "school-attendance-app-da033",
  appId: "1:998386196514:web:78e3072803f40a9ed7aa7b",
  storageBucket: "school-attendance-app-da033.firebasestorage.app",
  messagingSenderId: "998386196514",
  measurementId: "G-1CELCD94HZ",

  /* Usernames become addresses in this domain for Firebase Auth. Nothing
     is delivered there. NEVER change this once schools have signed up —
     it is half of how their accounts are addressed. */
  usernameDomain: "users.school-attendance.app"
};
