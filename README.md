# TalentHub (Node.js)

A small campus placement app: students apply for jobs, companies shortlist, interview and issue offers, and the placement coordinator reports on results. Web UI plus REST/JSON API. **No npm packages needed**: it uses only Node's built-in `http` and `node:sqlite` (**Node 22.5 or newer**).

## Run

```bash
npm run seed      # optional demo data (password for all demo users: Password@123)
npm start         # open http://localhost:3000 in a browser   (PORT, DB_FILE env vars optional)
npm test          # 12 end-to-end tests
```

Coordinator self-registration is off unless you set `COORDINATOR_CODE` (then pass it as `invite_code`). Example:

```bash
export COORDINATOR_CODE=PLACEMENT-2026
curl -X POST localhost:3000/api/login -H 'Content-Type: application/json' \
  -d '{"email":"rahul@college.edu","password":"Password@123"}'
# use the token:  -H 'Authorization: Bearer <token>'
```

## Web UI

Open `http://localhost:3000`. Register or log in (after `npm run seed` use `rahul@college.edu`, `hr@abc.com` or `coordinator@college.edu`, password `Password@123`). The menu depends on the role:

| Role | Screens |
|---|---|
| Student | Jobs (with eligibility reasons and Apply), My applications (with interviews), My offers (Accept), Profile |
| Company | Post a job, My jobs (open/close), Applications (shortlist, reject, schedule interview, pass/fail, issue offer), Offers |
| Coordinator | Placement report (totals, status, by company, details, selection records), Audit log |

The UI is plain HTML, CSS and JavaScript in `public/`, served by the same server under a strict Content-Security-Policy. Text is always inserted as text, never as HTML.

## Architecture (layered)

| Layer | Folder | Job |
|---|---|---|
| UI | `public/` | Browser screens that call the API |
| Router | `src/app.js` | HTTP, routing, auth token, error mapping |
| Service | `src/services/` | Business rules, role and ownership checks, eligibility |
| Repository | `src/repositories/` | All SQL |
| Database | `src/db.js` | Normalized 7-table schema + `users`, `sessions`, `audit_log` |

## Functional requirements

| ID | Requirement | Endpoint(s) |
|---|---|---|
| FR-01 | User registration | `POST /api/register` (STUDENT, COMPANY, COORDINATOR) |
| FR-02 | Authentication | `POST /api/login`, `POST /api/logout` |
| FR-03 | Student profile | `GET/PUT /api/students/me` |
| FR-04 | Job posting | `POST /api/jobs` (company), `PATCH /api/jobs/:id` (open/close) |
| FR-05 | Job browsing | `GET /api/jobs`, `GET /api/jobs/:id` |
| FR-06 | Eligibility checking | Shown on job list; `GET /api/jobs/:id/eligibility`; enforced on apply |
| FR-07 | Job applications | `POST /api/jobs/:id/apply` |
| FR-08 | Application tracking | `GET /api/applications`, `GET /api/applications/:id` |
| FR-09 | Recruitment management | `PATCH /api/applications/:id/status` (APPLIED → SHORTLISTED / REJECTED) |
| FR-10 | Interview management | `POST/GET /api/applications/:id/interviews`, `PATCH /api/interviews/:id` |
| FR-11 | Offer management | `POST /api/applications/:id/offer` (company), `GET /api/offers`, `POST /api/offers/:id/accept` (student) |
| FR-12 | Placement reports | `GET /api/reports/placement` (coordinator) |

Eligibility rule (FR-06): `cgpa >= min_cgpa`, `active_backlogs <= max_backlogs`, branch in the job's allowed branches (no branches listed = all), job open. All failing reasons are returned.

## Non-functional requirements (assumed; replace with your approved NFRs)

| NFR | How it is met |
|---|---|
| Security: authentication | scrypt-hashed passwords, random bearer tokens (stored hashed), 8-hour expiry |
| Security: authorization | Role checks plus ownership checks in the service layer (a company sees only its own jobs and applications; a student only their own) |
| Security: abuse control | Login lockout after 5 failures for 1 minute; coordinator sign-up needs an invite code; 100 KB request limit |
| Security: data exposure | Students cannot see other students; internal errors are hidden; security headers set |
| Data integrity | Foreign keys on, CHECK and UNIQUE constraints (one application per student per job), transactions on multi-step writes |
| Validation | Every write validates type, range and format; clear 400/409/422 messages |
| Auditability | `audit_log` records registrations, logins, status changes, interviews, offers (`GET /api/audit`, coordinator) |
| Maintainability | Layered code, no business rules in routes, no SQL in services |
| Testability | Eligibility is a pure function; end-to-end tests run on an in-memory database |
| Portability | Zero dependencies; single SQLite file |

## Assumptions to confirm

- Statuses: APPLIED, SHORTLISTED, REJECTED, OFFERED. Interviews and offers need a SHORTLISTED application. One offer per application.
- Placing students (accepting an offer) does not block them from other applications; no placement-policy rule was given.
- `has_accepted_offer` is kept in sync when an offer is accepted.
