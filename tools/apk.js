/* Builds the debug APK: `npm run android:apk`.

   This exists instead of chaining `cd android && gradlew.bat ...` in the npm
   script, because how a bare batch-file name resolves depends on which shell
   npm happens to hand the script to. Spawning the wrapper by absolute path
   removes the guesswork, and lets the failure be reported usefully. */

'use strict';

var path = require('path');
var fs = require('fs');
var { spawnSync } = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var ANDROID = path.join(ROOT, 'android');
var WINDOWS = process.platform === 'win32';

var APK = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

function run(label, command, args, options) {
  process.stdout.write('\n> ' + label + '\n');
  var result = spawnSync(command, args, Object.assign({
    cwd: ROOT, stdio: 'inherit', shell: false
  }, options || {}));

  if (result.error) fail(label + ' could not start: ' + result.error.message);
  if (result.status !== 0) fail(label + ' failed (exit ' + result.status + ')');
}

function fail(message) {
  process.stderr.write('\n' + message + '\n');
  process.exit(1);
}

function main() {
  if (!fs.existsSync(ANDROID)) {
    fail('No android/ project yet. Run:  npx cap add android');
  }

  var wrapper = path.join(ANDROID, WINDOWS ? 'gradlew.bat' : 'gradlew');
  if (!fs.existsSync(wrapper)) fail('Gradle wrapper missing: ' + wrapper);

  // Gradle finds the SDK through local.properties or ANDROID_HOME. Say so
  // clearly rather than letting Gradle fail with "SDK location not found".
  if (!fs.existsSync(path.join(ANDROID, 'local.properties')) &&
      !process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
    fail('Android SDK location unknown. Set ANDROID_HOME, or write sdk.dir into\n' +
         path.join(ANDROID, 'local.properties'));
  }

  run('assembling www/', process.execPath, [path.join(ROOT, 'tools', 'build.js')]);

  /* npx is a .cmd on Windows, which Node also refuses to spawn directly, so it
     goes through the command processor as well. Passing the arguments as argv
     rather than a shell string keeps them out of the shell's hands. */
  if (WINDOWS) {
    run('syncing the android project', process.env.ComSpec || 'cmd.exe',
        ['/c', 'npx.cmd', 'cap', 'sync', 'android']);
  } else {
    run('syncing the android project', 'npx', ['cap', 'sync', 'android']);
  }

  /* Node refuses to spawn .bat/.cmd directly (CVE-2024-27980), so on Windows
     the wrapper goes through the command processor by absolute path — passing
     it as an argv entry rather than a shell string, which would come apart on
     the spaces in this project's path. */
  if (WINDOWS) {
    run('gradlew assembleDebug', process.env.ComSpec || 'cmd.exe',
        ['/c', wrapper, 'assembleDebug'], { cwd: ANDROID });
  } else {
    run('gradlew assembleDebug', wrapper, ['assembleDebug'], { cwd: ANDROID });
  }

  if (!fs.existsSync(APK)) fail('Gradle reported success but no APK is at ' + APK);

  var size = (fs.statSync(APK).size / (1024 * 1024)).toFixed(1);
  process.stdout.write('\nAPK ready  (' + size + ' MB)\n  ' + APK + '\n' +
    '\nInstall it on a phone with USB debugging on:\n' +
    '  adb install -r "' + APK + '"\n');
}

main();
