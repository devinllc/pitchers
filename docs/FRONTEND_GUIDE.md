## Frontend Integration Guide (Next.js) for Local Business Scraper

### Audience
- Next.js engineers integrating with the existing Node.js backend.
- Goal: consolidate static dashboards into a cohesive, production-ready Next.js frontend.

---

## 1) Architecture Overview

- Backend base:
  - Public, non-auth endpoints: `/search`, `/status`, `/jobs`, `/pause/:jobId`, `/resume/:jobId`, `/stop/:jobId`
  - SaaS endpoints (API key required): `/api/v1/...`
  - Multi-tenant Google Sheets + OAuth: `/multi-tenant-sheets/...`
  - User data: `/user-data/...`
  - API key management: `/api-keys/...`
- Frontend:
  - Next.js app routes mapping to current HTML dashboards:
    - Job Control dashboard → `/dashboard`
    - SaaS dashboard (OAuth + API keys + SaaS job flow) → `/saas`
    - Multi-tenant dashboard → `/multi-tenant`
    - OAuth callback → `/oauth/callback`
- Network strategy:
  - Use a single env `NEXT_PUBLIC_API_BASE_URL`. In dev, optionally set Next.js rewrites to proxy to backend.

---

## 2) Environment & Configuration

- `.env.local`:
  - `NEXT_PUBLIC_API_BASE_URL` = `https://pitchers.ufdevs.me`
- Optional rewrites in `next.config.js` to proxy to backend and avoid CORS in dev.
- Headers for SaaS endpoints: `Authorization: Bearer {apiKey}`.

---

## 3) Backend Endpoints Used by the Frontend (by module)

### Job Control (public)
- POST `/search-service` – start job
- GET `/status/:jobId` – job detail
- POST `/jobs/:jobId/pause` – pause
- POST `/jobs/:jobId/resume` – resume
- POST `/jobs/:jobId/stop` – stop

### Multi-tenant Google Sheets + OAuth (public)
- GET `/multi-tenant-sheets/auth/connect?userEmail=...` – redirect to OAuth
- GET `/multi-tenant-sheets/auth/status?userEmail=...` – OAuth connection status
- POST `/multi-tenant-sheets/auth/disconnect?userEmail=...` – revoke OAuth
- GET `/multi-tenant-sheets/connected?userEmail=...` – list connected sheets
- POST `/multi-tenant-sheets/create` – create new sheet { userEmail, sheetName }
- GET `/multi-tenant-sheets/available?userEmail=...` – list available sheets
- POST `/multi-tenant-sheets/connect` – connect existing sheet { userEmail, sheetId }
- DELETE `/multi-tenant-sheets/:sheetId?userEmail=...` – disconnect sheet

### User Data (public)
- GET `/user-data/summary?userEmail=...`
- GET `/user-data/recent?userEmail=...&limit=5`
- GET `/user-data/export/{csv|json}?userEmail=...`

### SaaS (API key required: Authorization: Bearer)
- POST `/api/v1/search-service` – start SaaS job (optionally create/select sheet)
- GET `/api/v1/status/:jobId` – SaaS job status
- POST `/api/v1/jobs/:jobId/{pause|resume|stop}`
- GET `/api/v1/user/sheets` – user’s connected sheets
- GET `/api/v1/user/jobs` – user’s job history

### API Keys (public)
- POST `/api-keys/create` – create API key { userEmail, planType }
- GET `/api-keys/:apiKey/stats` – inspect key
- GET `/api-keys/user/:email` – list email’s keys

---

## 4) Page/Flow Mapping from Static Dashboards to Next.js

### 4.1 Job Control Dashboard → `/dashboard`
- State: `currentJobId`, job status, progress %, time estimates, save stats.
- Start job → POST `/search-service` with body: `{ city, keyword, method, scraper: { maxResults, maxScrollPages, headless, wantWebsite, wantEmail, emailDeepPaths }, phrases: { maxPhrases? } }`
- Poll every 2s: `/status/:jobId` for detail after start.
- Controls: POST `/jobs/:jobId/{pause|resume|stop}`.
- Activity log: keep last ~50 entries.

Build prompt:
```
Create a Next.js client page with a form for city, keyword, method, and scraper options. On submit, POST to /search-service. Store jobId. Poll every 2s to /status/:jobId, update a progress bar, show stats and a log area. Provide Pause/Resume/Stop buttons calling /jobs/:jobId/{pause|resume|stop}. Maintain a last-50 activity log.
```

### 4.2 SaaS Dashboard → `/saas`
- Tabs: OAuth & Setup, API Keys, Usage & Jobs, Admin, Activity.
- OAuth & Setup:
  - Redirect to `/multi-tenant-sheets/auth/connect?userEmail=...&redirect_to=saas-dashboard`
  - Check: `/multi-tenant-sheets/auth/status`, `/connected`, and `/api-keys/user/:email`
  - Show connected sheets and latest API key
- API Keys:
  - Create: POST `/api-keys/create`
  - Stats: GET `/api-keys/:apiKey/stats`
  - By email: GET `/api-keys/user/:email`
- Usage & Jobs (Bearer):
  - Sheets: GET `/api/v1/user/sheets`
  - Start job: POST `/api/v1/search-service` (with `sheetId` or `{ createNewSheet, sheetName }`)
  - Status: GET `/api/v1/status/:jobId`
  - Control: POST `/api/v1/jobs/:jobId/{pause|resume|stop}`
- Admin (optional): list keys/users via admin endpoints.

Build prompt:
```
Create a Next.js client page with tabs. OAuth tab asks for email, redirects to connect, and checks status via /multi-tenant-sheets/auth/status + /connected + /api-keys/user/:email. API Keys tab lets users create a key and inspect stats. Usage & Jobs tab (Bearer) loads sheets, starts a job with either an existing sheet or by creating one, polls status, and allows pause/resume/stop.
```

### 4.3 Multi-tenant Dashboard → `/multi-tenant`
- Read `userEmail` from query/localStorage; prompt if missing.
- Connection status: GET `/multi-tenant-sheets/auth/status` + `/connected`.
- Sheets: create, list available, connect, open, disconnect.
- Start job saving to selected sheet:
  - POST `/search` with `{ keywords, location, method, maxResults, userEmail, targetSheetId }`
  - Poll `/status/:jobId` for progress.
- Export: open `/user-data/export/{csv|json}?userEmail=...` in new tab.

Build prompt:
```
Create a Next.js client page that captures userEmail (URL or localStorage). Show connect status and buttons to connect/disconnect Google Sheets. List connected sheets and allow selecting one as target. Start a job using POST /search and poll /status/:jobId for progress. Provide export buttons for CSV/JSON.
```

### 4.4 OAuth Callback → `/oauth/callback`
- Read query (`connected`, `error`, `oauth`).
- Show status and deep link to `/saas?userEmail=...` or `/multi-tenant?userEmail=...`.

Build prompt:
```
Create a route that reads query params, shows success/failure, and provides CTA buttons to continue to /saas or /multi-tenant prefilled with userEmail.
```

---

## 5) Cross-cutting Frontend Concerns

- API base URL: `const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''`
- SaaS auth header: `Authorization: Bearer ${apiKey}`
- Polling interval: 2s
- Error handling: parse `json.message || json.error`, show toast/log
- Query params: persist `userEmail` in localStorage and URL
- Accessibility: disable controls unless `jobId` present

---

## 6) Route & Proxy Guidance (Next.js)

- Absolute calls using `NEXT_PUBLIC_API_BASE_URL` for simplicity.
- Optional rewrites to proxy in dev to avoid CORS.

---

## 7) Data Contracts & Validation Hints

- Start Job (public): POST `/search-service` requires `city`, `keyword`; optional `method`, `phrases.maxPhrases`, `scraper.*`.
- Start SaaS Job (Bearer): POST `/api/v1/search-service` requires `city`, `keyword` and either `sheetId` or `{ createNewSheet, sheetName }`.
- Multi-tenant ops require `userEmail`.
- Status responses include `status`, `processed`, `total`, `startTime`, `method`, `saveStats`, `progress`, and time estimates when available.

---

## 8) Production Checklist (Frontend)

- `NEXT_PUBLIC_API_BASE_URL` points to prod backend
- OAuth return URLs use HTTPS
- API key UX (copy/mask) and local persistence
- Graceful handling for 429 (rate/usage limits)
- CORS configured if calling backend directly
- Add monitoring (e.g., Sentry)

---

## 9) Page-by-Page Build Prompts (Copy/Paste)

- `/dashboard`:
```
Client page with form → POST /search-service; poll /status/:jobId; progress bar; stats; activity log; Pause/Resume/Stop.
```

- `/saas`:
```
Tabbed client page. OAuth flow, API key create/inspect/list, sheets list (Bearer), start SaaS job (existing/new sheet), status and controls.
```

- `/multi-tenant`:
```
Client page with userEmail capture, connect/disconnect, sheets list and selection, start job via /search, poll status, export CSV/JSON.
```

- `/oauth/callback`:
```
Server/client route reading query; show success/error; CTA to /saas or /multi-tenant with userEmail.
```

---

## 10) Error UX Patterns

- 400: show validation `details[]` by field
- 401/403: prompt for API key, link to API Key tab
- 429: display rate/usage limit and reset
- 500: generic error toast; copy error for support

---

## 11) Manual QA Script

- OAuth connect → verify sheets + key appear
- SaaS job: start, poll, pause/resume/stop
- Public job: start from `/dashboard`, poll and stop
- Multi-tenant: create/connect sheet, start job with selected sheet, export
- API keys: create, stats, list by email, auth-protected calls work

---

This guide maps your static dashboards and public JS to a clean Next.js structure with explicit endpoint usage and build prompts so you can ship a unified production frontend quickly.

