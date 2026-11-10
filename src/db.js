// Database layer: SQLite schema = the normalized TalentHub schema (7 tables, 3NF/BCNF)
// plus users, sessions and audit_log for FR-01/FR-02 and the audit NFR.
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usn TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  branch TEXT NOT NULL,
  cgpa REAL NOT NULL CHECK (cgpa BETWEEN 0 AND 10),
  active_backlogs INTEGER NOT NULL DEFAULT 0 CHECK (active_backlogs >= 0),
  has_accepted_offer INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS job_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL,
  season TEXT NOT NULL,
  min_cgpa REAL NOT NULL CHECK (min_cgpa BETWEEN 0 AND 10),
  max_backlogs INTEGER NOT NULL DEFAULT 0 CHECK (max_backlogs >= 0),
  drive_date TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS job_allowed_branches (
  job_id INTEGER NOT NULL REFERENCES job_listings(id),
  branch TEXT NOT NULL,
  PRIMARY KEY (job_id, branch)
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  job_id INTEGER NOT NULL REFERENCES job_listings(id),
  status TEXT NOT NULL DEFAULT 'APPLIED'
    CHECK (status IN ('APPLIED','SHORTLISTED','REJECTED','OFFERED')),
  applied_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (student_id, job_id)
);
CREATE TABLE IF NOT EXISTS interview_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  round_no INTEGER NOT NULL,
  scheduled_at TEXT NOT NULL,
  venue TEXT NOT NULL,
  passed INTEGER,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL UNIQUE REFERENCES applications(id),
  package_lpa REAL NOT NULL CHECK (package_lpa > 0),
  offer_letter_key TEXT NOT NULL UNIQUE,
  accepted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('STUDENT','COMPANY','COORDINATOR')),
  student_id INTEGER REFERENCES students(id),
  company_id INTEGER REFERENCES companies(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_job ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_app_student ON applications(student_id);
`;

function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// Run fn inside one transaction (NFR: data integrity).
function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { openDb, tx };
