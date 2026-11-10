// FR-01 registration, FR-02 login/logout. NFR: hashed passwords, expiring tokens, login throttling.
const crypto = require('node:crypto');
const V = require('../validate');
const { tx } = require('../db');
const { bad, unauthorized, forbidden, conflict, HttpError } = require('../errors');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const SESSION_HOURS = 8;
const MAX_FAILS = 5, LOCK_MS = 60_000;

function createAuthService(db, repos) {
  const fails = new Map(); // email -> { count, until }

  function register(body) {
    const role = body.role;
    if (!['STUDENT', 'COMPANY', 'COORDINATOR'].includes(role)) throw bad('role must be STUDENT, COMPANY or COORDINATOR');
    const email = V.email(body.email);
    const password = V.str(body.password, 'password', { min: 8, max: 100 });
    if (repos.users.byEmail(email)) throw conflict('Email is already registered');

    if (role === 'COORDINATOR') {
      // Coordinators see every record, so self-registration needs a shared invite code.
      const code = process.env.COORDINATOR_CODE;
      if (!code) throw forbidden('Coordinator registration is disabled (COORDINATOR_CODE not set)');
      if (body.invite_code !== code) throw forbidden('Invalid invite code');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    return tx(db, () => {
      const user = { email, role, salt, password_hash: hashPw(password, salt) };
      if (role === 'STUDENT') {
        user.student_id = repos.students.create({
          usn: V.str(body.usn, 'usn', { max: 20 }), full_name: V.str(body.full_name, 'full_name'), email,
          branch: V.str(body.branch, 'branch', { max: 20 }).toUpperCase(),
          cgpa: V.num(body.cgpa, 'cgpa', { min: 0, max: 10 }),
          active_backlogs: V.int(body.active_backlogs ?? 0, 'active_backlogs'),
        });
      }
      if (role === 'COMPANY') user.company_id = repos.companies.create(V.str(body.company_name, 'company_name'));
      const id = repos.users.create(user);
      repos.audit.log(id, 'REGISTER', 'user', id, { role });
      return { id: Number(id), email, role };
    });
  }

  function login(body) {
    const email = V.email(body.email);
    const f = fails.get(email);
    if (f && f.count >= MAX_FAILS && Date.now() < f.until) throw new HttpError(429, 'Too many failed logins. Try again in a minute.');
    const u = repos.users.byEmail(email);
    const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(body.password ?? ''), u.salt), 'hex'), Buffer.from(u.password_hash, 'hex'));
    if (!ok) {
      fails.set(email, { count: (f && Date.now() < f.until ? f.count : 0) + 1, until: Date.now() + LOCK_MS });
      throw unauthorized('Wrong email or password');
    }
    fails.delete(email);
    const token = crypto.randomBytes(32).toString('hex');
    repos.sessions.create(sha(token), u.id, new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString());
    repos.audit.log(u.id, 'LOGIN', 'user', u.id);
    return { token, role: u.role, expires_in_hours: SESSION_HOURS };
  }

  function logout(token) { if (token) repos.sessions.remove(sha(token)); return { message: 'Logged out' }; }

  function authenticate(token) {
    if (!token) throw unauthorized();
    const s = repos.sessions.find(sha(token));
    if (!s || new Date(s.expires_at) < new Date()) throw unauthorized('Session expired or invalid');
    const u = repos.users.byId(s.user_id);
    return { id: u.id, email: u.email, role: u.role, student_id: u.student_id, company_id: u.company_id };
  }

  return { register, login, logout, authenticate };
}
module.exports = { createAuthService };
