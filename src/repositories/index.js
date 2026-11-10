// Repository layer: all SQL lives here. Services never write SQL.
const now = () => new Date().toISOString();
const flag = (v) => (v ? 1 : 0);

function createRepos(db) {
  const q = (sql) => db.prepare(sql);

  const users = {
    create: (u) => q(`INSERT INTO users (email,password_hash,salt,role,student_id,company_id,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(u.email, u.password_hash, u.salt, u.role, u.student_id ?? null, u.company_id ?? null, now()).lastInsertRowid,
    byEmail: (email) => q('SELECT * FROM users WHERE email = ?').get(email),
    byId: (id) => q('SELECT * FROM users WHERE id = ?').get(id),
  };

  const sessions = {
    create: (hash, userId, expires) => q('INSERT INTO sessions VALUES (?,?,?)').run(hash, userId, expires),
    find: (hash) => q('SELECT * FROM sessions WHERE token_hash = ?').get(hash),
    remove: (hash) => q('DELETE FROM sessions WHERE token_hash = ?').run(hash),
  };

  const students = {
    create: (s) => q(`INSERT INTO students (usn,full_name,email,branch,cgpa,active_backlogs) VALUES (?,?,?,?,?,?)`)
      .run(s.usn, s.full_name, s.email, s.branch, s.cgpa, s.active_backlogs).lastInsertRowid,
    byId: (id) => q('SELECT * FROM students WHERE id = ?').get(id),
    update: (id, s) => q('UPDATE students SET full_name=?, branch=?, cgpa=?, active_backlogs=? WHERE id=?')
      .run(s.full_name, s.branch, s.cgpa, s.active_backlogs, id),
    markAccepted: (id) => q('UPDATE students SET has_accepted_offer = 1 WHERE id = ?').run(id),
    count: () => q('SELECT COUNT(*) n FROM students').get().n,
  };

  const companies = {
    create: (name) => q('INSERT INTO companies (company_name) VALUES (?)').run(name).lastInsertRowid,
    byId: (id) => q('SELECT * FROM companies WHERE id = ?').get(id),
  };

  const jobs = {
    create: (j) => {
      const id = q(`INSERT INTO job_listings (company_id,role,season,min_cgpa,max_backlogs,drive_date,is_open)
        VALUES (?,?,?,?,?,?,1)`).run(j.company_id, j.role, j.season, j.min_cgpa, j.max_backlogs, j.drive_date).lastInsertRowid;
      for (const b of j.allowed_branches) q('INSERT INTO job_allowed_branches VALUES (?,?)').run(id, b);
      return id;
    },
    branches: (id) => q('SELECT branch FROM job_allowed_branches WHERE job_id = ? ORDER BY branch').all(id).map((r) => r.branch),
    byId: (id) => q(`SELECT j.*, c.company_name FROM job_listings j JOIN companies c ON c.id=j.company_id WHERE j.id=?`).get(id),
    list: ({ companyId, onlyOpen } = {}) => {
      let sql = `SELECT j.*, c.company_name FROM job_listings j JOIN companies c ON c.id=j.company_id WHERE 1=1`;
      const args = [];
      if (companyId) { sql += ' AND j.company_id = ?'; args.push(companyId); }
      if (onlyOpen) sql += ' AND j.is_open = 1';
      return q(sql + ' ORDER BY j.drive_date, j.id').all(...args);
    },
    setOpen: (id, open) => q('UPDATE job_listings SET is_open=? WHERE id=?').run(flag(open), id),
  };

  const APP_SELECT = `SELECT a.*, s.full_name student_name, s.usn, j.role, j.company_id, c.company_name
      FROM applications a JOIN students s ON s.id=a.student_id
      JOIN job_listings j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id`;
  const applications = {
    create: (studentId, jobId) => q('INSERT INTO applications (student_id,job_id,status,applied_at,updated_at) VALUES (?,?,?,?,?)')
      .run(studentId, jobId, 'APPLIED', now(), now()).lastInsertRowid,
    byId: (id) => q(APP_SELECT + ' WHERE a.id = ?').get(id),
    list: ({ studentId, companyId } = {}) => {
      let sql = APP_SELECT + ' WHERE 1=1';
      const args = [];
      if (studentId) { sql += ' AND a.student_id = ?'; args.push(studentId); }
      if (companyId) { sql += ' AND j.company_id = ?'; args.push(companyId); }
      return q(sql + ' ORDER BY a.id').all(...args);
    },
    setStatus: (id, status) => q('UPDATE applications SET status=?, updated_at=? WHERE id=?').run(status, now(), id),
  };

  const interviews = {
    create: (i) => q('INSERT INTO interview_slots (application_id,round_no,scheduled_at,venue) VALUES (?,?,?,?)')
      .run(i.application_id, i.round_no, i.scheduled_at, i.venue).lastInsertRowid,
    byId: (id) => q('SELECT * FROM interview_slots WHERE id = ?').get(id),
    forApplication: (appId) => q('SELECT * FROM interview_slots WHERE application_id = ? ORDER BY round_no').all(appId),
    nextRound: (appId) => q('SELECT COALESCE(MAX(round_no),0)+1 n FROM interview_slots WHERE application_id = ?').get(appId).n,
    update: (id, i) => q('UPDATE interview_slots SET scheduled_at=?, venue=?, passed=?, notes=? WHERE id=?')
      .run(i.scheduled_at, i.venue, i.passed, i.notes, id),
  };

  const OFFER_SELECT = `SELECT o.*, a.student_id, a.job_id, j.role, j.company_id, c.company_name, s.full_name student_name
      FROM offers o JOIN applications a ON a.id=o.application_id JOIN job_listings j ON j.id=a.job_id
      JOIN companies c ON c.id=j.company_id JOIN students s ON s.id=a.student_id`;
  const offers = {
    create: (o) => q('INSERT INTO offers (application_id,package_lpa,offer_letter_key,accepted) VALUES (?,?,?,0)')
      .run(o.application_id, o.package_lpa, o.offer_letter_key).lastInsertRowid,
    byId: (id) => q(OFFER_SELECT + ' WHERE o.id = ?').get(id),
    byApplication: (appId) => q('SELECT * FROM offers WHERE application_id = ?').get(appId),
    list: ({ studentId, companyId } = {}) => {
      let sql = OFFER_SELECT + ' WHERE 1=1';
      const args = [];
      if (studentId) { sql += ' AND a.student_id = ?'; args.push(studentId); }
      if (companyId) { sql += ' AND j.company_id = ?'; args.push(companyId); }
      return q(sql + ' ORDER BY o.id').all(...args);
    },
    accept: (id) => q('UPDATE offers SET accepted = 1 WHERE id = ?').run(id),
  };

  const reports = {
    totals: () => ({
      students: students.count(),
      placed_students: q(`SELECT COUNT(DISTINCT a.student_id) n FROM offers o JOIN applications a ON a.id=o.application_id WHERE o.accepted=1`).get().n,
      jobs: q('SELECT COUNT(*) n FROM job_listings').get().n,
      applications: q('SELECT COUNT(*) n FROM applications').get().n,
      offers_issued: q('SELECT COUNT(*) n FROM offers').get().n,
      offers_accepted: q('SELECT COUNT(*) n FROM offers WHERE accepted=1').get().n,
      average_package_lpa: q('SELECT ROUND(AVG(package_lpa),2) v FROM offers WHERE accepted=1').get().v,
    }),
    byStatus: () => q('SELECT status, COUNT(*) count FROM applications GROUP BY status ORDER BY status').all(),
    byCompany: () => q(`SELECT c.company_name, COUNT(DISTINCT j.id) jobs, COUNT(DISTINCT a.id) applications,
        COUNT(DISTINCT CASE WHEN o.accepted=1 THEN a.id END) placed
        FROM companies c LEFT JOIN job_listings j ON j.company_id=c.id
        LEFT JOIN applications a ON a.job_id=j.id LEFT JOIN offers o ON o.application_id=a.id
        GROUP BY c.id ORDER BY c.company_name`).all(),
    applicationDetails: () => q(`SELECT a.id application_id, s.usn, s.full_name, s.branch, c.company_name, j.role, a.status,
        a.applied_at, o.package_lpa, o.accepted FROM applications a JOIN students s ON s.id=a.student_id
        JOIN job_listings j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id
        LEFT JOIN offers o ON o.application_id=a.id ORDER BY a.id`).all(),
    selections: () => q(`SELECT s.usn, s.full_name, c.company_name, j.role, o.package_lpa, o.accepted
        FROM offers o JOIN applications a ON a.id=o.application_id JOIN students s ON s.id=a.student_id
        JOIN job_listings j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id ORDER BY o.id`).all(),
  };

  const audit = {
    log: (userId, action, entity, entityId, detail) =>
      q('INSERT INTO audit_log (user_id,action,entity,entity_id,detail,created_at) VALUES (?,?,?,?,?,?)')
        .run(userId ?? null, action, entity, entityId ?? null, detail ? JSON.stringify(detail) : null, now()),
    list: (limit = 100) => q('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit),
  };

  return { users, sessions, students, companies, jobs, applications, interviews, offers, reports, audit };
}

module.exports = { createRepos };
