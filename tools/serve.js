/* Dependency-free static server for local preview: `npm start`.
   Nothing here ships in the app — it exists so the site can be opened on a
   phone over the LAN while developing. */

'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');

var ROOT = path.resolve(__dirname, '..');
var PORT = Number(process.env.PORT) || 5173;

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function createServer() {
  return http.createServer(function (req, res) {
    var urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    var filePath = path.join(ROOT, path.normalize(urlPath));

    // Never serve anything outside the project folder.
    if (filePath.indexOf(ROOT) !== 0) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(filePath, function (err, data) {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + urlPath);
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  });
}

module.exports = { createServer: createServer, ROOT: ROOT };

if (require.main === module) {
  createServer().listen(PORT, function () {
    console.log('School Attendance running at:');
    console.log('  http://localhost:' + PORT);

    var nets = os.networkInterfaces();
    Object.keys(nets).forEach(function (name) {
      nets[name].forEach(function (net) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log('  http://' + net.address + ':' + PORT + '   (open this on your phone)');
        }
      });
    });
  });
}
