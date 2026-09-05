/* Assembles the shipping files into www/, which is what Capacitor copies into
   the APK: `npm run build`.

   There is no bundler and nothing is transformed — the app is plain HTML, CSS
   and JS and runs exactly as written. This exists only so that webDir points at
   a folder holding *just* the app. Pointing Capacitor at the project root would
   package node_modules/, tests/ and android/ into the APK. */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, 'www');

/* Everything the app needs at runtime, and nothing else. */
var SHIP = ['index.html', 'css', 'js'];

/* Returns the number of files copied. */
function copy(from, to) {
  if (!fs.statSync(from).isDirectory()) {
    fs.copyFileSync(from, to);
    return 1;
  }
  fs.mkdirSync(to, { recursive: true });
  return fs.readdirSync(from).reduce(function (count, name) {
    return count + copy(path.join(from, name), path.join(to, name));
  }, 0);
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  var files = 0;
  SHIP.forEach(function (name) {
    var from = path.join(ROOT, name);
    if (!fs.existsSync(from)) throw new Error('missing from the project: ' + name);
    files += copy(from, path.join(OUT, name));
  });

  /* The APK loads index.html from the assets folder, so a missing entry point
     is a blank white screen on the phone rather than a build error. Check it. */
  var entry = path.join(OUT, 'index.html');
  if (!fs.existsSync(entry)) throw new Error('www/index.html was not produced');

  var html = fs.readFileSync(entry, 'utf8');
  var refs = (html.match(/(?:src|href)="([^"]+)"/g) || [])
    .map(function (m) { return m.replace(/^(?:src|href)="/, '').replace(/"$/, ''); })
    .filter(function (ref) { return !/^(https?:|data:|#|\/\/)/.test(ref); });

  var missing = refs.filter(function (ref) {
    return !fs.existsSync(path.join(OUT, ref.replace(/^\//, '').split('?')[0]));
  });
  if (missing.length) {
    throw new Error('index.html references files that are not in the build: ' + missing.join(', '));
  }

  return { files: files, refs: refs.length };
}

if (require.main === module) {
  var result = build();
  console.log('build ok  ->  www/');
  console.log('  ' + result.files + ' files copied');
  console.log('  ' + result.refs + ' local script/style references all resolve');
}

module.exports = { build: build, OUT: OUT };
