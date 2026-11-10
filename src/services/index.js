// Service layer: business rules, role checks and ownership checks. No SQL here.
const crypto = require('node:crypto');
const V = require('../validate');
const { tx } = require('../db');
const { checkEligibility } = require('./eligibility');
const { createAuthService } = require('./auth');
const { bad, forbidden, notFound, conflict, HttpError } = require('../errors');

const requireRole = (user, ...roles) => { if (!roles.includes(user.role)) throw forbidden(`Only ${roles.join(' or ')} can do this`); };
// Allowed manual status changes (OFFERED is set only by issuing an offer, FR-11).
const NEXT_STATUS = { APPLIED: ['SHORTLISTED', 'REJECTED'], SHORTLISTED: ['REJECTED'], REJECTED: [], OFFERED: [] };

function createServices(db, repos) {
  const auth = createAuthService(db, repos);

  const withBranches = (job) => ({ ...job, is_open: !!job.is_open, allowed_branches: repos.jobs.branches(job.id) });
  const loadJob = (id) => { const j = repos.jobs.byId(id); if (!j) throw notFound('Job not found'); return j; };
  const loadApp = (id) => { const a = repos.applications.byId(id); if (!a) throw notFound('Application not found'); return a; };
  // Company that owns the job, or a coordinator, may manage an application.
  const canManage = (user, app) => user.role === 'COORDINATOR' || (user.role === 'COMPANY' && app.company_id === user.company_id);
  const assertCanManage = (user, app) => {
    requireRole(user, 'COMPANY', 'COORDINATOR');
    if (!canManage(user, app)) throw forbidden('This application belongs to another company');
  };
  const shapeApp = (a) => a;
  const shapeInterview = (i) => ({ ...i, passed: i.passed === null ? null : !!i.passed });
  const shapeOffer = (o) => ({ ...o, accepted: !!o.accepted });

  // ---- FR-03 student profile
  const profile = {
    get(user) { requireRole(user, 'STUDENT'); return repos.students.byId(user.student_id); },
    update(user, body) {
      requireRole(user, 'STUDENT');
      const cur = repos.students.byId(user.student_id);
      repos.students.update(user.student_id, {
        full_name: V.str(body.full_name ?? cur.full_name, 'full_name'),
        branch: V.str(body.branch ?? cur.branch, 'branch', { max: 20 }).toUpperCase(),
        cgpa: V.num(body.cgpa ?? cur.cgpa, 'cgpa', { min: 0, max: 10 }),
        active_backlogs: V.int(body.active_backlogs ?? cur.active_backlogs, 'active_backlogs'),
      });
      repos.audit.log(user.id, 'UPDATE_PROFILE', 'student', user.student_id);
      return repos.students.byId(user.student_id);
    },
  };

  // ---- FR-04 post job, FR-05 browse, FR-06 eligibility
  const jobs = {
    create(user, body) {
      requireRole(user, 'COMPANY');
      const branches = body.allowed_branches ?? [];
      if (!Array.isArray(branches)) throw bad('allowed_branches must be a list (empty = all branches)');
      const job = {
        company_id: user.company_id, role: V.str(body.role, 'role'), season: V.str(body.season, 'season', { max: 50 }),
        min_cgpa: V.num(body.min_cgpa, 'min_cgpa', { min: 0, max: 10 }),
        max_backlogs: V.int(body.max_backlogs ?? 0, 'max_backlogs'),
        drive_date: V.date(body.drive_date, 'drive_date'),
        allowed_branches: [...new Set(branches.map((b) => V.str(b, 'branch', { max: 20 }).toUpperCase()))],
      };
      const id = tx(db, () => { const id = repos.jobs.create(job); repos.audit.log(user.id, 'POST_JOB', 'job', id); return id; });
      return withBranches(repos.jobs.byId(Number(id)));
    },
    list(user, query) {
      let rows;
      if (user.role === 'COMPANY') rows = repos.jobs.list({ companyId: user.company_id });
      else if (user.role === 'STUDENT') rows = repos.jobs.list({ onlyOpen: true });
      else rows = repos.jobs.list();
      rows = rows.map(withBranches);
      if (user.role !== 'STUDENT') return rows;
      const s = repos.students.byId(user.student_id);
      rows = rows.map((j) => ({ ...j, eligibility: checkEligibility(s, { ...j, is_open: j.is_open }, j.allowed_branches) }));
      return query.eligible === 'true' ? rows.filter((j) => j.eligibility.eligible) : rows;
    },
    get(user, id) {
      const j = withBranches(loadJob(id));
      if (user.role === 'COMPANY' && j.company_id !== user.company_id) throw forbidden('This job belongs to another company');
      if (user.role === 'STUDENT') {
        const s = repos.students.byId(user.student_id);
        j.eligibility = checkEligibility(s, j, j.allowed_branches);
      }
      return j;
    },
    setOpen(user, id, body) {
      requireRole(user, 'COMPANY');
      const j = loadJob(id);
      if (j.company_id !== user.company_id) throw forbidden('This job belongs to another company');
      if (typeof body.is_open !== 'boolean') throw bad('is_open must be true or false');
      repos.jobs.setOpen(id, body.is_open);
      repos.audit.log(user.id, 'SET_JOB_OPEN', 'job', id, { is_open: body.is_open });
      return withBranches(repos.jobs.byId(id));
    },
  };

  // ---- FR-07 apply, FR-08 track, FR-09 manage
  const applications = {
    apply(user, jobId) {
      requireRole(user, 'STUDENT');
      const job = withBranches(loadJob(jobId));
      const student = repos.students.byId(user.student_id);
      const result = checkEligibility(student, job, job.allowed_branches);
      if (!result.eligible) throw new HttpError(422, 'You are not eligible for this job', result.reasons);
      const id = tx(db, () => {
        const id = repos.applications.create(student.id, job.id); // UNIQUE(student_id, job_id) stops duplicates
        repos.audit.log(user.id, 'APPLY', 'application', id, { job_id: job.id });
        return id;
      });
      return repos.applications.byId(Number(id));
    },
    list(user) {
      if (user.role === 'STUDENT') return repos.applications.list({ studentId: user.student_id }).map(shapeApp);
      if (user.role === 'COMPANY') return repos.applications.list({ companyId: user.company_id }).map(shapeApp);
      return repos.applications.list().map(shapeApp);
    },
    get(user, id) {
      const a = loadApp(id);
      if (user.role === 'STUDENT' && a.student_id !== user.student_id) throw forbidden('This is not your application');
      if (user.role === 'COMPANY' && a.company_id !== user.company_id) throw forbidden('This application belongs to another company');
      return { ...a, interviews: repos.interviews.forApplication(id).map(shapeInterview) };
    },
    setStatus(user, id, body) {
      requireRole(user, 'COMPANY');
      const a = loadApp(id);
      assertCanManage(user, a);
      const to = body.status;
      if (!NEXT_STATUS[a.status].includes(to))
        throw bad(`Cannot change status from ${a.status} to ${to}`, { allowed: NEXT_STATUS[a.status] });
      tx(db, () => {
        repos.applications.setStatus(id, to);
        repos.audit.log(user.id, 'STATUS_CHANGE', 'application', id, { from: a.status, to });
      });
      return repos.applications.byId(id);
    },
  };

  // ---- FR-10 interviews
  const interviews = {
    schedule(user, appId, body) {
      const a = loadApp(appId);
      assertCanManage(user, a);
      if (a.status !== 'SHORTLISTED') throw bad('Interviews can be scheduled only for SHORTLISTED applications');
      const slot = {
        application_id: appId,
        round_no: body.round_no === undefined ? repos.interviews.nextRound(appId) : V.int(body.round_no, 'round_no', { min: 1, max: 20 }),
        scheduled_at: V.datetime(body.scheduled_at, 'scheduled_at'),
        venue: V.str(body.venue, 'venue'),
      };
      const id = tx(db, () => { const id = repos.interviews.create(slot); repos.audit.log(user.id, 'SCHEDULE_INTERVIEW', 'interview', id, { application_id: appId }); return id; });
      return shapeInterview(repos.interviews.byId(Number(id)));
    },
    list(user, appId) { applications.get(user, appId); return repos.interviews.forApplication(appId).map(shapeInterview); },
    update(user, id, body) {
      const i = repos.interviews.byId(id);
      if (!i) throw notFound('Interview not found');
      assertCanManage(user, loadApp(i.application_id));
      const passed = body.passed === undefined ? i.passed : body.passed === null ? null : typeof body.passed === 'boolean' ? (body.passed ? 1 : 0) : (() => { throw bad('passed must be true, false or null'); })();
      repos.interviews.update(id, {
        scheduled_at: body.scheduled_at === undefined ? i.scheduled_at : V.datetime(body.scheduled_at, 'scheduled_at'),
        venue: body.venue === undefined ? i.venue : V.str(body.venue, 'venue'),
        passed, notes: body.notes === undefined ? i.notes : V.str(body.notes, 'notes', { min: 0, max: 1000 }),
      });
      repos.audit.log(user.id, 'UPDATE_INTERVIEW', 'interview', id, { passed });
      return shapeInterview(repos.interviews.byId(id));
    },
  };

  // ---- FR-11 offers
  const offers = {
    issue(user, appId, body) {
      requireRole(user, 'COMPANY');
      const a = loadApp(appId);
      assertCanManage(user, a);
      if (a.status !== 'SHORTLISTED') throw bad('An offer can be issued only to a SHORTLISTED application');
      if (repos.offers.byApplication(appId)) throw conflict('An offer already exists for this application');
      const o = {
        application_id: appId, package_lpa: V.num(body.package_lpa, 'package_lpa', { min: 0.01, max: 1000 }),
        offer_letter_key: body.offer_letter_key === undefined
          ? `offers/${appId}-${crypto.randomBytes(6).toString('hex')}.pdf` : V.str(body.offer_letter_key, 'offer_letter_key', { max: 255 }),
      };
      const id = tx(db, () => {
        const id = repos.offers.create(o);
        repos.applications.setStatus(appId, 'OFFERED');
        repos.audit.log(user.id, 'ISSUE_OFFER', 'offer', id, { application_id: appId, package_lpa: o.package_lpa });
        return id;
      });
      return shapeOffer(repos.offers.byId(Number(id)));
    },
    list(user) {
      if (user.role === 'STUDENT') return repos.offers.list({ studentId: user.student_id }).map(shapeOffer);
      if (user.role === 'COMPANY') return repos.offers.list({ companyId: user.company_id }).map(shapeOffer);
      return repos.offers.list().map(shapeOffer);
    },
    accept(user, id) {
      requireRole(user, 'STUDENT');
      const o = repos.offers.byId(id);
      if (!o) throw notFound('Offer not found');
      if (o.student_id !== user.student_id) throw forbidden('This is not your offer');
      if (o.accepted) throw conflict('Offer already accepted');
      tx(db, () => {
        repos.offers.accept(id);
        repos.students.markAccepted(user.student_id);
        repos.audit.log(user.id, 'ACCEPT_OFFER', 'offer', id);
      });
      return shapeOffer(repos.offers.byId(id));
    },
  };

  // ---- FR-12 reports (coordinator only)
  const reports = {
    placement(user) {
      requireRole(user, 'COORDINATOR');
      return {
        generated_at: new Date().toISOString(),
        totals: repos.reports.totals(),
        applications_by_status: repos.reports.byStatus(),
        by_company: repos.reports.byCompany(),
        application_details: repos.reports.applicationDetails(),
        selection_records: repos.reports.selections().map((r) => ({ ...r, accepted: !!r.accepted })),
      };
    },
    audit(user) { requireRole(user, 'COORDINATOR'); return repos.audit.list(200); },
  };

  return { auth, profile, jobs, applications, interviews, offers, reports };
}
module.exports = { createServices };
