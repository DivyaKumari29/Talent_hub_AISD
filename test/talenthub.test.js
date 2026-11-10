const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.COORDINATOR_CODE = 'CODE123';
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');
const { checkEligibility } = require('../src/services/eligibility');

let server, base;
const PW = 'Password@123';
before(async () => {
  ({ server } = createApp(openDb(':memory:')));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
async function signup(payload) {
  const r = await call('POST', '/api/register', { password: PW, ...payload });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const l = await call('POST', '/api/login', { email: payload.email, password: PW });
  return l.body.token;
}

const S = {}; // shared state across ordered tests

test('FR-06 eligibility rule: inclusive boundaries, all reasons, empty branch list = all', () => {
  const job = { is_open: 1, min_cgpa: 7, max_backlogs: 2 };
  assert.equal(checkEligibility({ cgpa: 7, active_backlogs: 2, branch: 'ME' }, job, []).eligible, true);
  const r = checkEligibility({ cgpa: 6.9, active_backlogs: 3, branch: 'ME' }, job, ['CS']);
  assert.equal(r.eligible, false);
  assert.equal(r.reasons.length, 3);
  assert.equal(checkEligibility({ cgpa: 9, active_backlogs: 0, branch: 'CS' }, { ...job, is_open: 0 }, []).reasons[0], 'Job is closed');
});

test('FR-01/FR-02 register, login, bad login, logout, protected routes', async () => {
  S.company = await signup({ role: 'COMPANY', email: 'hr@abc.com', company_name: 'ABC Technologies' });
  S.rahul = await signup({ role: 'STUDENT', email: 'rahul@x.edu', usn: 'U1', full_name: 'Rahul', branch: 'cs', cgpa: 8.2, active_backlogs: 1 });
  S.asha = await signup({ role: 'STUDENT', email: 'asha@x.edu', usn: 'U2', full_name: 'Asha', branch: 'EC', cgpa: 6.5 });
  S.coord = await signup({ role: 'COORDINATOR', email: 'c@x.edu', invite_code: 'CODE123' });
  assert.equal((await call('POST', '/api/login', { email: 'rahul@x.edu', password: 'wrongpass1' })).status, 401);
  assert.equal((await call('GET', '/api/jobs')).status, 401);
  assert.equal((await call('POST', '/api/register', { role: 'STUDENT', email: 'rahul@x.edu', password: PW })).status, 409);
  assert.equal((await call('POST', '/api/register', { role: 'COORDINATOR', email: 'z@x.edu', password: PW, invite_code: 'nope' })).status, 403);
  const t = await signup({ role: 'STUDENT', email: 'tmp@x.edu', usn: 'U9', full_name: 'Tmp', branch: 'CS', cgpa: 7 });
  assert.equal((await call('POST', '/api/logout', {}, t)).status, 200);
  assert.equal((await call('GET', '/api/students/me', null, t)).status, 401);
});

test('FR-03 student profile read and update, with validation', async () => {
  assert.equal((await call('GET', '/api/students/me', null, S.rahul)).body.branch, 'CS');
  const u = await call('PUT', '/api/students/me', { cgpa: 8.4 }, S.rahul);
  assert.equal(u.body.cgpa, 8.4);
  assert.equal((await call('PUT', '/api/students/me', { cgpa: 11 }, S.rahul)).status, 400);
  assert.equal((await call('GET', '/api/students/me', null, S.company)).status, 403);
});

test('FR-04/FR-05 company posts job; students browse with eligibility; roles enforced', async () => {
  const bad = await call('POST', '/api/jobs', { role: 'Dev' }, S.company);
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', '/api/jobs', { role: 'Dev', season: 'x', min_cgpa: 7, drive_date: '2026-12-10' }, S.rahul)).status, 403);
  const j = await call('POST', '/api/jobs', { role: 'Software Developer', season: '2026-27', min_cgpa: 7, max_backlogs: 2, drive_date: '2026-12-10', allowed_branches: ['CS', 'IS'] }, S.company);
  assert.equal(j.status, 201);
  S.job = j.body.id;
  const list = await call('GET', '/api/jobs', null, S.rahul);
  assert.equal(list.body[0].eligibility.eligible, true);
  assert.equal((await call('GET', '/api/jobs', null, S.asha)).body[0].eligibility.eligible, false);
  assert.equal((await call('GET', '/api/jobs?eligible=true', null, S.asha)).body.length, 0);
});

test('FR-06/FR-07 eligible student applies; ineligible blocked with reasons; duplicate blocked', async () => {
  const no = await call('POST', `/api/jobs/${S.job}/apply`, null, S.asha);
  assert.equal(no.status, 422);
  assert.ok(no.body.details.length >= 2);
  const ok = await call('POST', `/api/jobs/${S.job}/apply`, null, S.rahul);
  assert.equal(ok.status, 201);
  S.app = ok.body.id;
  assert.equal(ok.body.status, 'APPLIED');
  assert.equal((await call('POST', `/api/jobs/${S.job}/apply`, null, S.rahul)).status, 409);
});

test('FR-08/FR-09 tracking and status management; ownership and transitions enforced', async () => {
  assert.equal((await call('GET', '/api/applications', null, S.rahul)).body.length, 1);
  assert.equal((await call('GET', '/api/applications', null, S.asha)).body.length, 0);
  assert.equal((await call('GET', `/api/applications/${S.app}`, null, S.asha)).status, 403);
  assert.equal((await call('PATCH', `/api/applications/${S.app}/status`, { status: 'SHORTLISTED' }, S.rahul)).status, 403);
  const other = await signup({ role: 'COMPANY', email: 'hr@other.com', company_name: 'Other Co' });
  assert.equal((await call('PATCH', `/api/applications/${S.app}/status`, { status: 'SHORTLISTED' }, other)).status, 403);
  assert.equal((await call('PATCH', `/api/applications/${S.app}/status`, { status: 'OFFERED' }, S.company)).status, 400);
  const r = await call('PATCH', `/api/applications/${S.app}/status`, { status: 'SHORTLISTED' }, S.company);
  assert.equal(r.body.status, 'SHORTLISTED');
});

test('FR-10 interviews: schedule, list, record result; students cannot schedule', async () => {
  const body = { scheduled_at: '2026-12-11T10:00:00Z', venue: 'Room 101' };
  assert.equal((await call('POST', `/api/applications/${S.app}/interviews`, body, S.rahul)).status, 403);
  const i = await call('POST', `/api/applications/${S.app}/interviews`, body, S.company);
  assert.equal(i.status, 201);
  assert.equal(i.body.round_no, 1);
  const r2 = await call('POST', `/api/applications/${S.app}/interviews`, body, S.coord);
  assert.equal(r2.body.round_no, 2);
  const upd = await call('PATCH', `/api/interviews/${i.body.id}`, { passed: true, notes: 'Good' }, S.company);
  assert.equal(upd.body.passed, true);
  assert.equal((await call('GET', `/api/applications/${S.app}/interviews`, null, S.rahul)).body.length, 2);
  assert.equal((await call('POST', `/api/applications/${S.app}/interviews`, { venue: 'x' }, S.company)).status, 400);
});

test('FR-11 offers: issue, student views and accepts, no duplicate offer', async () => {
  assert.equal((await call('POST', `/api/applications/${S.app}/offer`, { package_lpa: 12 }, S.rahul)).status, 403);
  const o = await call('POST', `/api/applications/${S.app}/offer`, { package_lpa: 12.5 }, S.company);
  assert.equal(o.status, 201);
  S.offer = o.body.id;
  assert.equal((await call('POST', `/api/applications/${S.app}/offer`, { package_lpa: 9 }, S.company)).status, 400); // status is OFFERED now
  assert.equal((await call('GET', '/api/offers', null, S.rahul)).body[0].package_lpa, 12.5);
  assert.equal((await call('GET', '/api/offers', null, S.asha)).body.length, 0);
  assert.equal((await call('POST', `/api/offers/${S.offer}/accept`, null, S.asha)).status, 403);
  const a = await call('POST', `/api/offers/${S.offer}/accept`, null, S.rahul);
  assert.equal(a.body.accepted, true);
  assert.equal((await call('POST', `/api/offers/${S.offer}/accept`, null, S.rahul)).status, 409);
  assert.equal((await call('GET', '/api/students/me', null, S.rahul)).body.has_accepted_offer, 1);
});

test('FR-12 placement report: coordinator only, correct numbers', async () => {
  assert.equal((await call('GET', '/api/reports/placement', null, S.company)).status, 403);
  const r = (await call('GET', '/api/reports/placement', null, S.coord)).body;
  assert.equal(r.totals.students, 3);
  assert.equal(r.totals.placed_students, 1);
  assert.equal(r.totals.offers_accepted, 1);
  assert.equal(r.totals.average_package_lpa, 12.5);
  assert.equal(r.applications_by_status[0].status, 'OFFERED');
  assert.equal(r.selection_records[0].usn, 'U1');
  assert.equal(r.application_details.length, 1);
});

test('NFR: audit trail, error hygiene, input limits, security headers', async () => {
  const audit = (await call('GET', '/api/audit', null, S.coord)).body;
  const actions = audit.map((a) => a.action);
  for (const x of ['STATUS_CHANGE', 'ISSUE_OFFER', 'ACCEPT_OFFER', 'APPLY']) assert.ok(actions.includes(x), x);
  assert.equal((await call('GET', '/api/audit', null, S.company)).status, 403);
  const res = await fetch(base + '/api/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/api/login', { method: 'POST', body: '{bad json' })).status, 400);
  assert.equal((await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(200 * 1024) }) }).catch(() => ({ status: 413 }))).status, 413);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('GET', '/api/jobs/abc', null, S.rahul)).status, 400);
});

test('Web UI is served with a strict content security policy', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await res.text(), /<title>TalentHub<\/title>/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.equal((await fetch(base + '/src/app.js')).status, 404);
});

test('NFR: login throttling after repeated failures', async () => {
  for (let i = 0; i < 5; i++) await call('POST', '/api/login', { email: 'asha@x.edu', password: 'badbadbad' });
  assert.equal((await call('POST', '/api/login', { email: 'asha@x.edu', password: PW })).status, 429);
});
