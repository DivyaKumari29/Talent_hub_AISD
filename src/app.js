// Router layer: HTTP parsing, routing, auth, error mapping. No business rules here.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const { createRepos } = require('./repositories');
const { createServices } = require('./services');
const { HttpError } = require('./errors');
const V = require('./validate');

// Web UI: only these files are ever served (no directory access).
const PUBLIC = path.join(__dirname, '..', 'public');
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const MAX_BODY = 100 * 1024; // NFR: limit request size

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const b = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(b && typeof b === 'object' ? b : {}); }
      catch { reject(new HttpError(400, 'Body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

function createApp(db = openDb()) {
  const repos = createRepos(db);
  const s = createServices(db, repos);
  const routes = [];
  // public routes need no login; others get ctx.user from the bearer token
  const add = (method, path, handler, { pub = false, status = 200 } = {}) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, pub, status });
  };

  // FR-01, FR-02
  add('POST', '/api/register', (c) => s.auth.register(c.body), { pub: true, status: 201 });
  add('POST', '/api/login', (c) => s.auth.login(c.body), { pub: true });
  add('POST', '/api/logout', (c) => s.auth.logout(c.token));
  // FR-03
  add('GET', '/api/students/me', (c) => s.profile.get(c.user));
  add('PUT', '/api/students/me', (c) => s.profile.update(c.user, c.body));
  // FR-04, FR-05, FR-06
  add('POST', '/api/jobs', (c) => s.jobs.create(c.user, c.body), { status: 201 });
  add('GET', '/api/jobs', (c) => s.jobs.list(c.user, c.query));
  add('GET', '/api/jobs/:id', (c) => s.jobs.get(c.user, V.id(c.params.id)));
  add('GET', '/api/jobs/:id/eligibility', (c) => s.jobs.get(c.user, V.id(c.params.id)).eligibility ?? (() => { throw new HttpError(403, 'Only students have an eligibility result'); })());
  add('PATCH', '/api/jobs/:id', (c) => s.jobs.setOpen(c.user, V.id(c.params.id), c.body));
  // FR-07, FR-08, FR-09
  add('POST', '/api/jobs/:id/apply', (c) => s.applications.apply(c.user, V.id(c.params.id)), { status: 201 });
  add('GET', '/api/applications', (c) => s.applications.list(c.user));
  add('GET', '/api/applications/:id', (c) => s.applications.get(c.user, V.id(c.params.id)));
  add('PATCH', '/api/applications/:id/status', (c) => s.applications.setStatus(c.user, V.id(c.params.id), c.body));
  // FR-10
  add('POST', '/api/applications/:id/interviews', (c) => s.interviews.schedule(c.user, V.id(c.params.id), c.body), { status: 201 });
  add('GET', '/api/applications/:id/interviews', (c) => s.interviews.list(c.user, V.id(c.params.id)));
  add('PATCH', '/api/interviews/:id', (c) => s.interviews.update(c.user, V.id(c.params.id), c.body));
  // FR-11
  add('POST', '/api/applications/:id/offer', (c) => s.offers.issue(c.user, V.id(c.params.id), c.body), { status: 201 });
  add('GET', '/api/offers', (c) => s.offers.list(c.user));
  add('POST', '/api/offers/:id/accept', (c) => s.offers.accept(c.user, V.id(c.params.id)));
  // FR-12
  add('GET', '/api/reports/placement', (c) => s.reports.placement(c.user));
  add('GET', '/api/audit', (c) => s.reports.audit(c.user));
  add('GET', '/api/health', () => ({ status: 'ok' }), { pub: true });

  const handler = async (req, res) => {
    const send = (status, body) => {
      const data = JSON.stringify(body);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data),
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
      });
      res.end(data);
    };
    const t0 = Date.now();
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-cache' });
        return res.end(fs.readFileSync(path.join(PUBLIC, file)));
      }
      const pathMatches = routes.filter((r) => r.re.test(url.pathname));
      if (!pathMatches.length) throw new HttpError(404, 'Route not found');
      const route = pathMatches.find((r) => r.method === req.method);
      if (!route) throw new HttpError(405, 'Method not allowed');
      const m = route.re.exec(url.pathname);
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
      const user = route.pub ? null : s.auth.authenticate(token);
      const data = route.handler({ user, params, query: Object.fromEntries(url.searchParams), body, token });
      send(route.status, data);
    } catch (e) {
      let status = e.status, message = e.message, details = e.details;
      if (!status) {
        // map database constraint errors to client errors; hide everything else
        if (/UNIQUE constraint failed/.test(e.message)) { status = 409; message = 'Duplicate value: ' + e.message.split(': ')[1]; }
        else if (/CHECK constraint failed|NOT NULL constraint failed|FOREIGN KEY/.test(e.message)) { status = 400; message = 'Invalid data'; }
        else { status = 500; message = 'Internal server error'; console.error(e); }
      }
      send(status, { error: message, ...(details ? { details } : {}) });
    } finally {
      if (process.env.LOG_REQUESTS) console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - t0}ms`);
    }
  };
  return { server: http.createServer(handler), db, services: s };
}
module.exports = { createApp };
