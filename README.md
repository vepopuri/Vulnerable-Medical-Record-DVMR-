# DVMR — Deliberately Vulnerable Medical Record dashboard

A small, self-contained, **intentionally vulnerable** Electronic Health
Record (EHR) demo built with Node.js, Express, Socket.io, and a local
SQLite file. It exists to teach and test three specific web
vulnerabilities against realistic-looking PII/PHI data. It is **not** a
real medical system and must never be pointed at real patient data or
exposed on a public network.

## Quick start

```bash
npm install
npm start
```

Then open `http://localhost:3000`. The SQLite file `health_records.db`
is created and seeded with five fake patients automatically on first
run — no extra setup required.

## The vulnerability toggle

Everything is controlled by one flag near the top of `server.js`:

```js
const SECURE_MODE = false; // false = vulnerable, true = fixed
```

Flip it to `true` and restart the server to see the same three
features run through their secure equivalents instead.

## What's vulnerable when `SECURE_MODE = false`

### 1. SQL Injection — patient look-up (CWE-89)
`GET /api/patients/search?q=...` builds its query with raw string
concatenation (`server.js`, `/api/patients/search`). Try these in the
"Patient Profile Look-up" search box:

- `' OR '1'='1` — dumps every patient's SSN and DOB.
- `1001' UNION SELECT id,full_name,ssn,dob,diagnosis,doctors_notes,assigned_doctor FROM patients--`
  — classic UNION-based exfiltration.

In secure mode the same endpoint uses parameterized queries
(`db.prepare(...).all(param1, param2)`) and constrains the ID lookup to
digits only.

### 2. Broken Object Level Authorization / IDOR on the socket stream (CWE-639)
`join_patient_stream` accepts any `patient_id` from any connected
client and joins them to that patient's live PHI room — there is no
check that the caller is the assigned doctor. Open the "Live Vitals
Monitor" panel, leave the doctor token blank, and enter **any**
patient ID (e.g. `1002`) to start receiving another patient's live
vitals and notes.

In secure mode, the socket handshake requires a valid token from
`AUTH_TOKENS` in `server.js`, and `join_patient_stream` additionally
checks that the token's doctor is the patient's `assigned_doctor`
before allowing the join. Demo tokens: `doctor-token-1` (assigned to
Alice/Carla/Emma) and `doctor-token-2` (assigned to Bob/David).

> **Not real credentials.** `doctor-token-1` / `doctor-token-2` are
> hardcoded placeholder strings baked into `server.js` for this demo
> only — they carry no secret value, are not rotated, and are not an
> example of real auth-token handling. If a scanner flags them, that's
> a false positive; do not treat them as leaked secrets, and do not
> reuse this hardcoded-token pattern in production code.

### 3. Real-time Stored XSS — Doctor's Notes (CWE-79)
The `doctor_note` socket event stores the note with raw string
concatenation and rebroadcasts it unescaped to everyone watching that
patient, which the frontend renders with `innerHTML`. Join a patient
stream and submit a note like:

```html
<img src=x onerror="alert('XSS from a malicious nurse')">
```

It executes immediately in every browser currently watching that
patient — simulating a nurse-to-physician attack path.

In secure mode, notes are HTML-escaped and length-capped before being
written to the database or broadcast, and the write uses a
parameterized `UPDATE`.

## Project layout

```
server.js          Express app, Socket.io server, all vulnerable/secure logic
db/index.js         SQLite schema + seed data (better-sqlite3)
public/index.html   Dashboard markup
public/app.js        Frontend: search, socket join, vitals + notes feeds
public/style.css     Styling
health_records.db    Created at runtime (git-ignored)
```

## Intended use

This app is for authorized security testing, coursework, CTF-style
exercises, and secure-code-review practice only. Do not deploy it to a
public host, do not load real patient data into it, and do not use the
patterns in `SECURE_MODE = false` as a reference for production code —
use the `SECURE_MODE = true` paths for that instead.
