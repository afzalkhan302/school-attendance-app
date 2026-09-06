/* Is Email/Password sign-in actually enabled on the project?
   `npm run check:auth`

   Asks Identity Toolkit to sign in as an address that cannot exist. The answer
   distinguishes the two cases without creating, modifying or deleting anything:

     OPERATION_NOT_ALLOWED            the provider is OFF
     EMAIL_NOT_FOUND                  the provider is ON, no such user
     INVALID_LOGIN_CREDENTIALS        the provider is ON (newer wording)
     API key not valid                the apiKey in firebase-config.js is wrong

   The console showing the provider as enabled and the API actually accepting
   password sign-in are not the same claim, and only the second one matters.
*/

'use strict';

var fs = require('fs');
var path = require('path');

var CONFIG = path.resolve(__dirname, '..', 'js', 'firebase-config.js');

function loadConfig() {
  var source = fs.readFileSync(CONFIG, 'utf8');
  var window = {};
  new Function('window', source)(window);
  return window.SchoolCloudConfig || {};
}

function die(message, code) {
  process.stderr.write('\n' + message + '\n\n');
  process.exit(code === undefined ? 1 : code);
}

var config = loadConfig();

if (!config.apiKey || !config.projectId) {
  die('No Firebase config yet — js/firebase-config.js has no apiKey.\n' +
      'Paste the web config block, then:\n' +
      '  npm run connect:firebase -- my-config.txt');
}

var probeEmail = 'zz-probe-' + Date.now().toString(36) + '@' +
  (config.usernameDomain || 'users.school-attendance.app');

var body = JSON.stringify({
  email: probeEmail,
  password: 'not-a-real-password',
  returnSecureToken: true
});

var url = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' +
  encodeURIComponent(config.apiKey);

process.stdout.write('\nProject:  ' + config.projectId + '\n');
process.stdout.write('Checking Email/Password sign-in…\n');

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body
}).then(function (response) {
  return response.json().then(function (data) { return { status: response.status, data: data }; });
}).then(function (result) {
  var error = (result.data && result.data.error) || {};
  var message = String(error.message || '');

  if (/OPERATION_NOT_ALLOWED/.test(message)) {
    die('Email/Password sign-in is NOT enabled on ' + config.projectId + '.\n\n' +
        'Firebase console > Authentication > Sign-in method > Email/Password > Enable.\n' +
        'Every registration would fail with auth/operation-not-allowed until then.');
  }

  if (/API key not valid|API_KEY_INVALID/i.test(message)) {
    die('That apiKey is not valid for this project.\n' +
        'Re-copy the config from Project settings > General > Your apps.');
  }

  if (/EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD/.test(message)) {
    process.stdout.write('\nEmail/Password sign-in is ENABLED and accepting requests.\n' +
      '  (probed with an address that does not exist; nothing was created)\n\n');
    return;
  }

  if (result.status === 200) {
    // Vanishingly unlikely, but it would mean the probe address exists.
    die('Unexpected: the probe address signed in. Delete ' + probeEmail +
        ' in Authentication > Users.');
  }

  die('Could not tell whether Email/Password is enabled.\n' +
      'HTTP ' + result.status + ': ' + (message || JSON.stringify(result.data)));
}).catch(function (err) {
  die('Could not reach Identity Toolkit: ' + (err && err.message) + '\n' +
      'Check the internet connection.');
});
