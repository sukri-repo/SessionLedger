'use strict';

const http = require('http');
const { scanAll } = require('./scan');
const { render, payloadFor } = require('./render');

/**
 * Serves the page with a live refresh endpoint behind it. Bound to loopback
 * only — the payload contains the full text of every conversation on this
 * machine, so it must not be reachable from the network.
 */
function serve({ root, port = 4300, host = '127.0.0.1' } = {}) {
  let scanning = null;

  // One scan at a time: a double-click on Refresh should wait on the first
  // scan rather than start a second pass over half a gigabyte of transcripts.
  function scanOnce() {
    if (!scanning) {
      scanning = scanAll(root).finally(() => { scanning = null; });
    }
    return scanning;
  }

  const server = http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    const started = Date.now();

    try {
      if (url === '/' || url === '/index.html') {
        const sessions = await scanOnce();
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(render(sessions, { root, live: true }));
        log(req, 200, sessions.length, started);
        return;
      }

      if (url === '/api/sessions') {
        const sessions = await scanOnce();
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(payloadFor(sessions, { root, live: true })));
        log(req, 200, sessions.length, started);
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(err.message);
      process.stderr.write(`  ! ${req.url}: ${err.message}\n`);
    }
  });

  function log(req, status, n, started) {
    process.stderr.write(`  ${status} ${req.url} — ${n} sessions in ${Date.now() - started}ms\n`);
  }

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => resolve({ server, url: `http://${host}:${port}/` }));
  });
}

module.exports = { serve };
