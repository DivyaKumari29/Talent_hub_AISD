// Demo data: node scripts/seed.js  (uses DB_FILE or talenthub.db)
process.env.COORDINATOR_CODE ||= 'PLACEMENT-DEMO';
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');
const { services: s } = createApp(openDb(process.env.DB_FILE || 'talenthub.db'));
const pw = 'Password@123';
try {
  s.auth.register({ role: 'COORDINATOR', email: 'coordinator@college.edu', password: pw, invite_code: process.env.COORDINATOR_CODE });
  s.auth.register({ role: 'COMPANY', email: 'hr@abc.com', password: pw, company_name: 'ABC Technologies' });
  s.auth.register({ role: 'STUDENT', email: 'rahul@college.edu', password: pw, usn: '1XX22CS001', full_name: 'Rahul', branch: 'CS', cgpa: 8.2, active_backlogs: 1 });
  s.auth.register({ role: 'STUDENT', email: 'asha@college.edu', password: pw, usn: '1XX22EC002', full_name: 'Asha Patil', branch: 'EC', cgpa: 6.5, active_backlogs: 0 });
  const co = s.auth.login({ email: 'hr@abc.com', password: pw });
  const user = s.auth.authenticate(co.token);
  s.jobs.create(user, { role: 'Software Developer', season: '2026-27', min_cgpa: 7.0, max_backlogs: 2, drive_date: '2026-12-10', allowed_branches: ['CS', 'IS'] });
  console.log('Seeded. All demo accounts use password:', pw);
  console.log('coordinator@college.edu | hr@abc.com | rahul@college.edu | asha@college.edu');
} catch (e) { console.error('Seed failed (already seeded?):', e.message); }
