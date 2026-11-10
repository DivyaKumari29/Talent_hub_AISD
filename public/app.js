// TalentHub web UI. Plain JS. All text is inserted with textContent (no HTML injection).
const $ = (s) => document.querySelector(s);
const view = $('#view');
let session = null; // { token, role, email }
try { session = JSON.parse(sessionStorage.getItem('th') || 'null'); } catch { session = null; }

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v !== undefined && v !== null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const badge = (t, cls) => el('span', { class: 'badge ' + (cls || t) }, t);
let toastTimer;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 3500);
}
async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session) { signOut(true); throw new Error('Session expired. Please log in again.'); }
  if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.details = data.details; throw e; }
  return data;
}
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message + (e.details && Array.isArray(e.details) ? ': ' + e.details.join('; ') : ''), true); } };
const formData = (f) => Object.fromEntries(new FormData(f).entries());
const num = (v) => (v === '' || v === undefined ? undefined : Number(v));
const fmt = (s) => (s ? new Date(s).toLocaleString() : '');

function field(label, name, type = 'text', extra = {}) {
  return el('div', { class: extra.full ? 'full' : '' }, el('label', { for: 'f_' + name }, label),
    el('input', { id: 'f_' + name, name, type, required: extra.required !== false, step: extra.step, min: extra.min, max: extra.max, value: extra.value, minlength: extra.minlength }));
}

// ---------- auth screen
function authScreen() {
  nav(); view.replaceChildren();
  let mode = 'login';
  const box = el('div', { class: 'card auth' });
  const draw = () => {
    const role = mode === 'login' ? null : ($('#role') ? $('#role').value : 'STUDENT');
    const form = el('form', { class: 'cols', onsubmit: run(async (e) => {
      e.preventDefault(); const d = formData(e.target);
      if (mode === 'register') {
        const body = { ...d, cgpa: num(d.cgpa), active_backlogs: num(d.active_backlogs) };
        await api('POST', '/register', body); toast('Registered. Logging you in…');
      }
      const r = await api('POST', '/login', { email: d.email, password: d.password });
      session = { token: r.token, role: r.role, email: d.email }; sessionStorage.setItem('th', JSON.stringify(session)); start();
    }) },
      mode === 'register' ? el('div', { class: 'full' }, el('label', { for: 'role' }, 'I am a'),
        el('select', { id: 'role', name: 'role', onchange: draw }, ...['STUDENT', 'COMPANY', 'COORDINATOR'].map((r) => el('option', { value: r, selected: r === role }, r[0] + r.slice(1).toLowerCase())))) : null,
      field('Email', 'email', 'email', { full: true }),
      field('Password' + (mode === 'register' ? ' (min 8 characters)' : ''), 'password', 'password', { full: true, minlength: mode === 'register' ? 8 : undefined }),
      mode === 'register' && role === 'STUDENT' ? [field('USN', 'usn'), field('Full name', 'full_name'), field('Branch (e.g. CS)', 'branch'), field('CGPA', 'cgpa', 'number', { step: '0.01', min: 0, max: 10 }), field('Active backlogs', 'active_backlogs', 'number', { min: 0, value: 0 })] : null,
      mode === 'register' && role === 'COMPANY' ? field('Company name', 'company_name', 'text', { full: true }) : null,
      mode === 'register' && role === 'COORDINATOR' ? field('Invite code', 'invite_code', 'password', { full: true }) : null,
      el('div', { class: 'full actions' }, el('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'Log in' : 'Register'),
        el('button', { class: 'btn ghost', type: 'button', onclick: () => { mode = mode === 'login' ? 'register' : 'login'; draw(); } }, mode === 'login' ? 'Create an account' : 'I have an account')));
    box.replaceChildren(el('h2', {}, mode === 'login' ? 'Log in' : 'Register'), form);
  };
  draw(); view.append(box);
}

function signOut(silent) {
  if (session && !silent) api('POST', '/logout', {}).catch(() => {});
  session = null; sessionStorage.removeItem('th'); authScreen();
}

// ---------- navigation
const MENUS = {
  STUDENT: [['jobs', 'Jobs'], ['apps', 'My applications'], ['offers', 'My offers'], ['profile', 'Profile']],
  COMPANY: [['post', 'Post a job'], ['myjobs', 'My jobs'], ['recruit', 'Applications'], ['offers', 'Offers']],
  COORDINATOR: [['report', 'Placement report'], ['audit', 'Audit log']],
};
let current = null;
function nav() {
  const n = $('#nav'), w = $('#who'); n.replaceChildren(); w.replaceChildren();
  if (!session) return;
  for (const [k, label] of MENUS[session.role]) n.append(el('button', { class: current === k ? 'on' : '', onclick: () => go(k) }, label));
  w.append(el('span', {}, session.email + ' · ' + session.role.toLowerCase()), el('button', { class: 'btn ghost sm', onclick: () => signOut() }, 'Log out'));
}
function go(k) { current = k; nav(); run(SCREENS[k])(); }
function start() { go(MENUS[session.role][0][0]); }

const table = (heads, rows) => el('div', { class: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, heads.map((h) => el('th', {}, h)))),
  el('tbody', {}, rows.length ? rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, c)))) : el('tr', {}, el('td', { colspan: heads.length, class: 'muted' }, 'Nothing to show yet')))));
const show = (...nodes) => view.replaceChildren(...nodes);

// ---------- student screens
const SCREENS = {
  async profile() {
    const s = await api('GET', '/students/me');
    const form = el('form', { class: 'cols', onsubmit: run(async (e) => {
      e.preventDefault(); const d = formData(e.target);
      await api('PUT', '/students/me', { full_name: d.full_name, branch: d.branch, cgpa: num(d.cgpa), active_backlogs: num(d.active_backlogs) });
      toast('Profile saved'); SCREENS.profile();
    }) },
      field('Full name', 'full_name', 'text', { value: s.full_name }), field('Branch', 'branch', 'text', { value: s.branch }),
      field('CGPA', 'cgpa', 'number', { step: '0.01', min: 0, max: 10, value: s.cgpa }), field('Active backlogs', 'active_backlogs', 'number', { min: 0, value: s.active_backlogs }),
      el('div', { class: 'full' }, el('p', { class: 'muted' }, `USN ${s.usn} · ${s.email} · Offer accepted: ${s.has_accepted_offer ? 'yes' : 'no'}`)),
      el('div', { class: 'full actions' }, el('button', { class: 'btn', type: 'submit' }, 'Save profile')));
    show(el('div', { class: 'card' }, el('h2', {}, 'My profile'), form));
  },

  async jobs() {
    const jobs = await api('GET', '/jobs');
    const apps = await api('GET', '/applications');
    const applied = new Set(apps.map((a) => a.job_id));
    show(el('h2', {}, 'Available jobs'), ...(jobs.length ? jobs.map((j) => el('div', { class: 'card' },
      el('div', { class: 'row' }, el('div', {}, el('b', {}, `${j.role} · ${j.company_name}`),
        el('div', { class: 'muted' }, `${j.season} · drive ${j.drive_date} · min CGPA ${j.min_cgpa} · max backlogs ${j.max_backlogs} · branches ${j.allowed_branches.length ? j.allowed_branches.join(', ') : 'all'}`)),
        el('div', {}, j.eligibility.eligible ? badge('Eligible', 'ok') : badge('Not eligible', 'no'))),
      j.eligibility.eligible ? null : el('ul', { class: 'reasons' }, j.eligibility.reasons.map((r) => el('li', {}, r))),
      el('div', { class: 'actions' }, el('button', { class: 'btn', disabled: !j.eligibility.eligible || applied.has(j.id), onclick: run(async () => { await api('POST', `/jobs/${j.id}/apply`); toast('Application submitted'); SCREENS.jobs(); }) }, applied.has(j.id) ? 'Already applied' : 'Apply')))) : [el('p', { class: 'muted' }, 'No open jobs right now.')]));
  },

  async apps() {
    const apps = await api('GET', '/applications');
    const cards = [];
    for (const a of apps) {
      const ivs = await api('GET', `/applications/${a.id}/interviews`);
      cards.push(el('div', { class: 'card' }, el('div', { class: 'row' }, el('b', {}, `${a.role} · ${a.company_name}`), badge(a.status)),
        el('div', { class: 'muted' }, 'Applied ' + fmt(a.applied_at) + ' · updated ' + fmt(a.updated_at)),
        ivs.length ? el('div', { class: 'sub' }, el('b', {}, 'Interviews'), table(['Round', 'When', 'Venue', 'Result'], ivs.map((i) => [i.round_no, fmt(i.scheduled_at), i.venue, i.passed === null ? 'Pending' : i.passed ? 'Passed' : 'Not passed']))) : null));
    }
    show(el('h2', {}, 'My applications'), ...(cards.length ? cards : [el('p', { class: 'muted' }, 'You have not applied to any job yet.')]));
  },

  // ---------- company screens
  async post() {
    const form = el('form', { class: 'cols', onsubmit: run(async (e) => {
      e.preventDefault(); const d = formData(e.target);
      await api('POST', '/jobs', { role: d.role, season: d.season, min_cgpa: num(d.min_cgpa), max_backlogs: num(d.max_backlogs), drive_date: d.drive_date,
        allowed_branches: d.branches.split(',').map((b) => b.trim()).filter(Boolean) });
      toast('Job posted'); e.target.reset(); 
    }) },
      field('Role', 'role'), field('Season (e.g. 2026-27)', 'season'), field('Minimum CGPA', 'min_cgpa', 'number', { step: '0.01', min: 0, max: 10 }),
      field('Maximum active backlogs', 'max_backlogs', 'number', { min: 0, value: 0 }), field('Drive date', 'drive_date', 'date'),
      field('Allowed branches (comma separated, blank = all)', 'branches', 'text', { required: false }),
      el('div', { class: 'full actions' }, el('button', { class: 'btn', type: 'submit' }, 'Post job')));
    show(el('div', { class: 'card' }, el('h2', {}, 'Post a job'), form));
  },

  async myjobs() {
    const jobs = await api('GET', '/jobs');
    show(el('h2', {}, 'My jobs'), el('div', { class: 'card' }, table(['Role', 'Season', 'Drive', 'Min CGPA', 'Max backlogs', 'Branches', 'Status', ''],
      jobs.map((j) => [j.role, j.season, j.drive_date, j.min_cgpa, j.max_backlogs, j.allowed_branches.join(', ') || 'all', badge(j.is_open ? 'Open' : 'Closed', j.is_open ? 'ok' : 'no'),
        el('button', { class: 'btn ghost sm', onclick: run(async () => { await api('PATCH', `/jobs/${j.id}`, { is_open: !j.is_open }); SCREENS.myjobs(); }) }, j.is_open ? 'Close' : 'Reopen')]))));
  },

  async recruit() {
    const apps = await api('GET', '/applications');
    const cards = [];
    for (const a of apps) {
      const ivs = await api('GET', `/applications/${a.id}/interviews`);
      const set = (status) => run(async () => { await api('PATCH', `/applications/${a.id}/status`, { status }); toast('Status updated'); SCREENS.recruit(); });
      const sched = el('form', { class: 'cols sub', onsubmit: run(async (e) => {
        e.preventDefault(); const d = formData(e.target);
        await api('POST', `/applications/${a.id}/interviews`, { scheduled_at: new Date(d.when).toISOString(), venue: d.venue }); toast('Interview scheduled'); SCREENS.recruit();
      }) }, field('Interview date and time', 'when', 'datetime-local'), field('Venue', 'venue'),
        el('div', { class: 'full actions' }, el('button', { class: 'btn sm', type: 'submit' }, 'Schedule interview')));
      const offer = el('form', { class: 'cols sub', onsubmit: run(async (e) => {
        e.preventDefault(); await api('POST', `/applications/${a.id}/offer`, { package_lpa: num(formData(e.target).package_lpa) }); toast('Offer issued'); SCREENS.recruit();
      }) }, field('Package (LPA)', 'package_lpa', 'number', { step: '0.01', min: 0.01 }),
        el('div', { class: 'full actions' }, el('button', { class: 'btn green sm', type: 'submit' }, 'Issue offer')));
      cards.push(el('div', { class: 'card' }, el('div', { class: 'row' }, el('div', {}, el('b', {}, `${a.student_name} (${a.usn})`), el('div', { class: 'muted' }, `${a.role} · applied ${fmt(a.applied_at)}`)), badge(a.status)),
        a.status === 'APPLIED' ? el('div', { class: 'actions' }, el('button', { class: 'btn sm', onclick: set('SHORTLISTED') }, 'Shortlist'), el('button', { class: 'btn red sm', onclick: set('REJECTED') }, 'Reject')) : null,
        a.status === 'SHORTLISTED' ? el('div', { class: 'actions' }, el('button', { class: 'btn red sm', onclick: set('REJECTED') }, 'Reject')) : null,
        ivs.length ? el('div', { class: 'sub' }, el('b', {}, 'Interviews'), table(['Round', 'When', 'Venue', 'Result', ''], ivs.map((i) => [i.round_no, fmt(i.scheduled_at), i.venue, i.passed === null ? 'Pending' : i.passed ? 'Passed' : 'Not passed',
          el('span', { class: 'actions' }, el('button', { class: 'btn green sm', onclick: run(async () => { await api('PATCH', `/interviews/${i.id}`, { passed: true }); SCREENS.recruit(); }) }, 'Pass'),
            el('button', { class: 'btn red sm', onclick: run(async () => { await api('PATCH', `/interviews/${i.id}`, { passed: false }); SCREENS.recruit(); }) }, 'Fail'))]))) : null,
        a.status === 'SHORTLISTED' ? [sched, offer] : null));
    }
    show(el('h2', {}, 'Applications to my jobs'), ...(cards.length ? cards : [el('p', { class: 'muted' }, 'No applications yet.')]));
  },

  // ---------- offers (student, company)
  async offers() {
    const offers = await api('GET', '/offers');
    const isStudent = session.role === 'STUDENT';
    show(el('h2', {}, isStudent ? 'My offers' : 'Offers issued'), el('div', { class: 'card' }, table(
      isStudent ? ['Company', 'Role', 'Package (LPA)', 'Status', ''] : ['Student', 'Role', 'Package (LPA)', 'Status'],
      offers.map((o) => isStudent
        ? [o.company_name, o.role, o.package_lpa, o.accepted ? badge('Accepted', 'ok') : badge('Pending', 'APPLIED'),
          o.accepted ? '' : el('button', { class: 'btn green sm', onclick: run(async () => { await api('POST', `/offers/${o.id}/accept`); toast('Offer accepted. Congratulations!'); SCREENS.offers(); }) }, 'Accept')]
        : [o.student_name, o.role, o.package_lpa, o.accepted ? badge('Accepted', 'ok') : badge('Pending', 'APPLIED')]))));
  },

  // ---------- coordinator screens
  async report() {
    const r = await api('GET', '/reports/placement'); const t = r.totals;
    const stat = (n, label) => el('div', { class: 'stat' }, el('b', {}, n ?? '-'), el('span', {}, label));
    show(el('h2', {}, 'Placement report'),
      el('div', { class: 'grid' }, stat(t.students, 'Students'), stat(t.placed_students, 'Placed'), stat(t.jobs, 'Jobs'), stat(t.applications, 'Applications'),
        stat(t.offers_issued, 'Offers issued'), stat(t.offers_accepted, 'Offers accepted'), stat(t.average_package_lpa, 'Avg package (LPA)')),
      el('div', { class: 'card' }, el('b', {}, 'Applications by status'), table(['Status', 'Count'], r.applications_by_status.map((s) => [badge(s.status), s.count]))),
      el('div', { class: 'card' }, el('b', {}, 'By company'), table(['Company', 'Jobs', 'Applications', 'Placed'], r.by_company.map((c) => [c.company_name, c.jobs, c.applications, c.placed]))),
      el('div', { class: 'card' }, el('b', {}, 'Application details'), table(['USN', 'Student', 'Branch', 'Company', 'Role', 'Status'], r.application_details.map((a) => [a.usn, a.full_name, a.branch, a.company_name, a.role, badge(a.status)]))),
      el('div', { class: 'card' }, el('b', {}, 'Student selection records'), table(['USN', 'Student', 'Company', 'Role', 'Package (LPA)', 'Accepted'], r.selection_records.map((s) => [s.usn, s.full_name, s.company_name, s.role, s.package_lpa, s.accepted ? 'Yes' : 'No']))),
      el('div', { class: 'actions' }, el('button', { class: 'btn ghost', onclick: () => SCREENS.report() }, 'Refresh')));
  },

  async audit() {
    const rows = await api('GET', '/audit');
    show(el('h2', {}, 'Audit log (latest 200)'), el('div', { class: 'card' }, table(['When', 'User', 'Action', 'Entity', 'Detail'], rows.map((a) => [fmt(a.created_at), a.user_id, a.action, `${a.entity} #${a.entity_id ?? ''}`, a.detail || '']))));
  },
};

session ? start() : authScreen();
