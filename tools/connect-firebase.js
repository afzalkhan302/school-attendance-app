/* Points the app at a Firebase project: `npm run connect:firebase <file>`
   (or pipe the config in on stdin).

   Hand-editing js/firebase-config.js works, but it is six fields that all have
   to be exactly right and a wrong one usually shows up much later as a
   confusing auth error. This takes the block Firebase gives you — in whatever
   shape you copied it — checks it, and writes both js/firebase-config.js and
   .firebaserc so the CLI and the app agree on the project.

   Accepts any of:
     the JSON from the console
     the `const firebaseConfig = { ... };` JavaScript snippet
     the whole `<script>` block from "Add Firebase to your web app"
*/

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var CONFIG = path.join(ROOT, 'js', 'firebase-config.js');
var FIREBASERC = path.join(ROOT, '.firebaserc');

var REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'];
var OPTIONAL = ['storageBucket', 'messagingSenderId', 'measurementId'];

function die(message) {
  process.stderr.write('\n' + message + '\n\n');
  process.exit(1);
}

/** Pull the first {...} out of whatever was pasted and read it as JS. */
function extract(source) {
  var start = source.indexOf('{');
  if (start === -1) die('No config object found in that input.');

  var depth = 0;
  var inString = null;

  for (var i = start; i < source.length; i++) {
    var ch = source[i];

    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  die('The config object in that input is not closed — check the paste.');
}

function parse(source) {
  var body = extract(source);
  var value;
  try {
    /* The console hands out JavaScript, not JSON: unquoted keys and single
       quotes. Evaluating an object literal the user just pasted themselves is
       reasonable here — it is their own config, on their own machine, and the
       alternative is a fragile hand-rolled parser. */
    value = new Function('return (' + body + ');')();
  } catch (err) {
    die('Could not read that config: ' + err.message);
  }
  if (!value || typeof value !== 'object') die('That input is not a config object.');
  return value;
}

function check(config) {
  var missing = REQUIRED.filter(function (field) { return !config[field]; });
  if (missing.length) {
    die('Missing from the config: ' + missing.join(', ') +
        '\nCopy the whole block from Project settings > General > Your apps.');
  }

  if (!/^[a-z0-9-]+$/.test(config.projectId)) {
    die('projectId "' + config.projectId + '" does not look right — it should be ' +
        'lowercase letters, digits and hyphens.');
  }

  if (/YOUR|REPLACE|xxx/i.test(config.apiKey + config.projectId)) {
    die('That still looks like the placeholder, not a real project.');
  }
}

/** Rewrite only the values, so the instructions in the file survive. */
function write(config, usernameDomain) {
  var source = fs.readFileSync(CONFIG, 'utf8');
  var start = source.indexOf('window.SchoolCloudConfig');
  if (start === -1) die('js/firebase-config.js has been changed too much to update safely.');

  var block =
    'window.SchoolCloudConfig = {\n' +
    '  /* Written by tools/connect-firebase.js. */\n' +
    '  enabled: true,\n\n' +
    REQUIRED.concat(OPTIONAL).filter(function (field) {
      return config[field];
    }).map(function (field) {
      return '  ' + field + ': ' + JSON.stringify(String(config[field])) + ',';
    }).join('\n') + '\n\n' +
    '  /* Usernames become addresses in this domain for Firebase Auth. Nothing\n' +
    '     is delivered there. NEVER change this once schools have signed up —\n' +
    '     it is half of how their accounts are addressed. */\n' +
    '  usernameDomain: ' + JSON.stringify(usernameDomain) + '\n' +
    '};\n';

  fs.writeFileSync(CONFIG, source.slice(0, start) + block, 'utf8');

  fs.writeFileSync(FIREBASERC,
    JSON.stringify({ projects: { default: config.projectId } }, null, 2) + '\n', 'utf8');
}

function existingUsernameDomain() {
  var source = fs.readFileSync(CONFIG, 'utf8');
  var match = source.match(/usernameDomain:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : 'users.school-attendance.app';
}

function run(source) {
  if (!String(source).trim()) {
    die('Nothing to read.\n\n' +
        'Usage:\n' +
        '  npm run connect:firebase -- path/to/config.json\n' +
        '  npm run connect:firebase              (then paste, then Ctrl+Z Enter on Windows)');
  }

  var config = parse(source);
  check(config);

  var domain = existingUsernameDomain();
  write(config, domain);

  process.stdout.write(
    '\nConnected to Firebase project: ' + config.projectId + '\n' +
    '  js/firebase-config.js   enabled: true\n' +
    '  .firebaserc             default project set\n' +
    '  usernameDomain          ' + domain + '   (unchanged)\n' +
    '\nNext:\n' +
    '  node node_modules/firebase-tools/lib/bin/firebase.js login\n' +
    '  npm run deploy:rules       publish firestore.rules\n' +
    '  npm run verify:deployed    prove the live rules keep schools apart\n' +
    '  npm run android:apk        rebuild with cloud accounts on\n\n');
}

var fileArg = process.argv[2];

if (fileArg) {
  if (!fs.existsSync(fileArg)) die('No such file: ' + fileArg);
  run(fs.readFileSync(fileArg, 'utf8'));
} else if (process.stdin.isTTY) {
  process.stdout.write('Paste the Firebase config, then Ctrl+Z and Enter (Windows) / Ctrl+D:\n');
  var chunks = [];
  process.stdin.on('data', function (chunk) { chunks.push(chunk); });
  process.stdin.on('end', function () { run(Buffer.concat(chunks).toString('utf8')); });
} else {
  var piped = [];
  process.stdin.on('data', function (chunk) { piped.push(chunk); });
  process.stdin.on('end', function () { run(Buffer.concat(piped).toString('utf8')); });
}
