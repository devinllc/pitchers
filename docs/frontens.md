Next.js Frontend Integration Guide for Local Business Scraper
This guide explains how the current static dashboards under public/ call backend APIs and provides a Next.js-first implementation blueprint. Use this to unify your frontend with the already-completed backend docs to form a production-ready, end-to-end flow.
1) What the current public/ dashboards do
Multi-tenant sheets flows:
Connect OAuth: GET /multi-tenant-sheets/auth/connect?userEmail=...
Check auth status: GET /multi-tenant-sheets/auth/status?userEmail=...
List connected sheets: GET /multi-tenant-sheets/connected?userEmail=...
List available sheets: GET /multi-tenant-sheets/available?userEmail=...
Create sheet: POST /multi-tenant-sheets/create with { userEmail, sheetName }
Connect existing sheet: POST /multi-tenant-sheets/connect with { userEmail, sheetId }
Disconnect sheet: DELETE /multi-tenant-sheets/:sheetId?userEmail=...
Disconnect OAuth: POST /multi-tenant-sheets/auth/disconnect?userEmail=...
SaaS API (requires API key via Authorization: Bearer <key>):
Start SaaS job: POST /api/v1/search-service
SaaS job status: GET /api/v1/status/:jobId
SaaS job controls: POST /api/v1/jobs/:jobId/(pause|resume|stop)
User sheets (SaaS): GET /api/v1/user/sheets
User jobs (SaaS): GET /api/v1/user/jobs
Single-tenant (no API key):
Start job: POST /search-service
Job status: GET /status/:jobId
Active jobs: GET /status
Job controls: POST /jobs/:jobId/(pause|resume|stop)
Performance: GET /performance, GC: POST /performance/gc
User data:
Summary: GET /user-data/summary?userEmail=...
Recent: GET /user-data/recent?userEmail=...&limit=...
Export: GET /user-data/export/{csv|json}?userEmail=...
API key management:
Create key: POST /api-keys/create
Key stats: GET /api-keys/:apiKey/stats
Keys by email: GET /api-keys/user/:userEmail
Admin lists: GET /api-keys/admin/keys, GET /api-keys/admin/users
2) Next.js architecture blueprint
Routing model: App Router recommended.
Data-fetching strategy:
Server Actions / Route Handlers for server-to-server calls (no CORS/API key leakage).
Client components only for UI interaction; they call your local route handlers.
Auth strategy:
Store the SaaS API key securely (httpOnly cookie) after creation/entry.
Inject Authorization: Bearer <key> in server-side route handlers when talking to backend.
Environment:
NEXT_PUBLIC_API_BASE_URL for browser-safe references if absolutely needed.
API_BASE_URL for server-only route handlers (preferred).
Error, loading, empty states:
Centralize via a UI pattern (toast/snackbar or banners); standardize error object shape per backend docs.
3) Page-by-page mapping (Next.js app routes)
/dashboard (multi-tenant dashboard)
On load:
Requires userEmail (from session or prompt).
Call server handlers to:
GET /multi-tenant-sheets/auth/status?userEmail=...
GET /multi-tenant-sheets/connected?userEmail=...
GET /user-data/summary?userEmail=... and /user-data/recent?userEmail=...
Actions:
Connect OAuth -> 302 redirect to /multi-tenant-sheets/auth/connect
Create sheet -> POST /multi-tenant-sheets/create
Connect existing -> POST /multi-tenant-sheets/connect
Disconnect sheet -> DELETE /multi-tenant-sheets/:sheetId
Start job -> POST /search (for multi-tenant non-SaaS path currently used by public/js/multi-tenant-dashboard.js), or SaaS path if you want to unify
Poll job -> GET /status/:jobId
/saas (SaaS dashboard & API key UX)
Tabs:
OAuth & Setup:
Start OAuth redirect to /multi-tenant-sheets/auth/connect?userEmail=...&redirect_to=saas-dashboard
POST-OAuth, show connected sheets (/multi-tenant-sheets/connected) and auto-generated API key (/api-keys/user/:userEmail)
API Keys:
Create key -> POST /api-keys/create
Load key stats -> GET /api-keys/:apiKey/stats
List keys by email -> GET /api-keys/user/:userEmail
Usage & Jobs:
List user sheets/jobs -> GET /api/v1/user/sheets, GET /api/v1/user/jobs (with Bearer)
Start SaaS job -> POST /api/v1/search-service (with Bearer)
Track SaaS job -> GET /api/v1/status/:jobId
Control SaaS job -> POST /api/v1/jobs/:jobId/(pause|resume|stop)
Admin:
GET /api-keys/admin/keys, GET /api-keys/admin/users
/job-control (single-tenant job console)
Start job -> POST /search-service
Controls -> POST /jobs/:jobId/(pause|resume|stop)
Live status -> GET /status, then drill into GET /status/:jobId
Multi-tenant connect actions are available but recommend consolidating this into /dashboard
/oauth/callback (if you centralize)
Parse code and state
Optionally show success/failure and redirect back to /dashboard or /saas with query flags (?connected=true)
4) Recommended Next.js route handlers (server-only)
Sheets (proxy):
GET /api/sheets/status?userEmail=... -> backend /multi-tenant-sheets/auth/status
GET /api/sheets/connected?userEmail=... -> backend /multi-tenant-sheets/connected
GET /api/sheets/available?userEmail=... -> backend /multi-tenant-sheets/available
POST /api/sheets/create -> backend /multi-tenant-sheets/create
POST /api/sheets/connect -> backend /multi-tenant-sheets/connect
DELETE /api/sheets/:sheetId?userEmail=... -> backend /multi-tenant-sheets/:sheetId
POST /api/sheets/disconnect -> backend /multi-tenant-sheets/auth/disconnect
SaaS (proxy; inject API key):
POST /api/saas/jobs -> backend /api/v1/search-service
GET /api/saas/jobs/:jobId -> backend /api/v1/status/:jobId
POST /api/saas/jobs/:jobId/(pause|resume|stop)
GET /api/saas/user/sheets -> backend /api/v1/user/sheets
GET /api/saas/user/jobs -> backend /api/v1/user/jobs
Keys (proxy):
POST /api/keys/create -> backend /api-keys/create
GET /api/keys/:apiKey/stats -> backend /api-keys/:apiKey/stats
GET /api/keys/user/:userEmail -> backend /api-keys/user/:userEmail
GET /api/keys/admin/keys -> backend /api-keys/admin/keys
GET /api/keys/admin/users -> backend /api-keys/admin/users
Jobs (single-tenant):
POST /api/jobs -> backend /search-service
GET /api/jobs/active -> backend /status
GET /api/jobs/:jobId -> backend /status/:jobId
POST /api/jobs/:jobId/(pause|resume|stop)
User data:
GET /api/user-data/summary?userEmail=...
GET /api/user-data/recent?userEmail=...&limit=...
GET /api/user-data/export/{csv|json}?userEmail=... (stream response or redirect)
Health/Performance (optional admin pages):
GET /api/health -> backend /health
GET /api/performance -> backend /performance
POST /api/performance/gc -> backend /performance/gc
Notes:
Keep the backend base URL in API_BASE_URL (server-only).
For SaaS routes, read the API key from secure cookies and inject to Authorization header.
5) Data contracts (from current dashboards)
Start SaaS job: POST /api/v1/search-service
Body:
city: string
keyword: string
method: "api" | "web"
scraper: object or string (in saas-dashboard.html sometimes 'google_maps'; standardize to object as in server docs)
sheetId OR (createNewSheet + sheetName)
Headers:
Authorization: Bearer <apiKey>
Response:
{ jobId, status, message, user, ... }
Check SaaS status: GET /api/v1/status/:jobId
Headers: Authorization: Bearer <apiKey>
Response provides status, progress, counts, time estimates (see health/status docs)
Multi-tenant sheets:
List: GET /multi-tenant-sheets/connected?userEmail=...
Returns array with { sheet_name, sheet_id, sheet_url/web_view_link }
Connect/create: POST with { userEmail, sheetId | sheetName }
Single-tenant:
Start: POST /search-service with { city, keyword, method, scraper, phrases }
Poll: GET /status/:jobId, aggregate: GET /status
User data:
Summary: { totalRecords, uniqueCities, uniqueKeywords, recordsWithPhone, recordsWithWebsite, recordsWithEmail }
Recent list: array of business rows (name, city, rating, created_at)
API keys:
Create: { userEmail, planType } -> returns { apiKey, planType, usageLimit, rateLimit }
Stats: /api-keys/:apiKey/stats -> usage & rate information
By user: /api-keys/user/:userEmail -> list with plan and usage
6) UX/state prompts for your implementation
Use these prompts to align UI, data-fetching and state in Next.js:
Dashboard page prompts:
“On first render, if userEmail is not in session, prompt for email and store it client-side; re-fetch auth/status, connected, and user-data/summary using route handlers.”
“When user clicks Connect Google Sheets, redirect through a server route that builds the connect URL and performs a 302 to /multi-tenant-sheets/auth/connect?userEmail=...&redirect_to=dashboard.”
“After OAuth return, detect ?connected=true and show a toast; refresh auth/status and connected.”
Sheets prompts:
“Create a modal for ‘Create new sheet’. On submit, call server route proxying to /multi-tenant-sheets/create and then re-fetch connected.”
“For ‘Connect existing sheet’, fetch /multi-tenant-sheets/available and allow pick; on select, call /multi-tenant-sheets/connect and refresh.”
Job prompts:
“To start a job, require keywords, location, and a targetSheet. Call the appropriate route (/api/jobs or /api/saas/jobs) and then begin polling /api/jobs/:jobId or /api/saas/jobs/:jobId every 2s.”
“When status transitions to completed|stopped|failed, stop polling, show a toast, and refresh summary.”
SaaS prompts:
“Store API key securely (httpOnly cookie) right after creation or user paste; from that point, all SaaS server route handlers inject the Bearer token.”
“Populate lists:
Sheets: /api/saas/user/sheets
Jobs: /api/saas/user/jobs
Job controls: /api/saas/jobs/:jobId/(pause|resume|stop)”
Error/Loading prompts:
“All fetches should drive a tri-state: idle/loading/error; always render a minimal placeholder with skeleton UI when loading.”
“Normalize backend errors { error, message, details? } into a UIError { title, description, fieldErrors? }.”
7) Environment configuration (frontend)
API_BASE_URL (server-only): e.g., http://localhost:3000 or production base.
NEXT_PUBLIC_API_BASE_URL: Optional; prefer server-only calls.
Cookie names:
saas_api_key: httpOnly, secure, sameSite=strict.
user_email: non-httpOnly if needed client-side for prefill (avoid storing sensitive tokens here).
8) OAuth redirect and state handling
Start:
Frontend routes the user to backend’s /multi-tenant-sheets/auth/connect?userEmail=...&redirect_to=<destination> (saas-dashboard or dashboard).
Callback:
Backend redirects back with flags (?connected=true or ?error=oauth_failed), or via /oauth/callback.
Post-callback:
UI displays success banner, refreshes status and connected sheets.
9) Security notes
Never expose SaaS API keys in the browser network layer if avoidable; use server route handlers.
Validate all user input (city, keyword) client-side to reduce server churn; still rely on server validation.
throttle/poll with backoff; stop when final states are reached.
avoid storing tokens in localStorage; prefer secure cookies.
10) Acceptance checklist (frontend)
Authentication
[ ] API key creation and secure storage flow
[ ] Authorized SaaS calls via server route handlers
OAuth/SaaS
[ ] OAuth connect with redirect return
[ ] Connected sheets loaded/created/connected/disconnected
Jobs
[ ] Start job (single-tenant dashboard)
[ ] Start SaaS job (SaaS dashboard)
[ ] Polling & controls (pause/resume/stop)
[ ] Status and progress bars
Data
[ ] Summary, recent items, export links
Reliability
[ ] Error/loading/empty states across all data views
[ ] Toast/notifications consistent
[ ] Responsive design maintained
11) Request templates (for QA and Postman)
Start SaaS job:
}
SaaS job status:
>
Connect OAuth (browser navigation):
dashboard
Create sheet:
}
User data summary:
com
12) Minimal IA for Next.js pages
/dashboard
Sections: Connection status, Sheets management, Job control, Data summary
/saas
Tabs: OAuth & Setup, API Keys, Usage & Jobs, Admin (optional)
/job-control
Single-tenant start/monitor/controls
/oauth/callback (optional)
Handles code/state and redirects with ?connected=true
13) Team prompts (for implementation sprints)
“Create server route handlers that mirror the dashboard endpoints and inject API key from secure cookies for SaaS calls.”
“Refactor all fetch calls in client components to call our route handlers instead of backend directly.”
“Unify job polling interval and lifecycle in a reusable hook; stop on terminal states.”
“Centralize userEmail acquisition and persistence; prefer server session if your auth strategy allows.”
“Add a banner system for consistent success/error notifications across pages.”
“Write Postman collection mirroring all backend endpoints and a separate set mirroring frontend route handlers for E2E.”
This guide maps your current public/ flows to a secure, maintainable Next.js architecture and gives you operational prompts to complete a production-ready UI that cleanly fronts the backend you’ve documented.
/
/







 i reviewed how your static dashboards call the backend. Below is a clear frontend-integration guide you can drop into a Markdown file and use to align/port the current flows into a Next.js app without losing any functionality.
Frontend Integration Guide (Next.js) for Local Business Scraper
Audience
Next.js engineers integrating with the existing Node.js backend.
Goal: consolidate static dashboards into a cohesive, production-ready Next.js frontend.
1) Architecture Overview
Backend base:
Public, non-auth endpoints: /search, /status, /jobs, /pause/:jobId, /resume/:jobId, /stop/:jobId
SaaS endpoints (API key required): /api/v1/...
Multi-tenant Google Sheets + OAuth: /multi-tenant-sheets/...
User data: /user-data/...
API key management: /api-keys/...
Frontend:
Next.js app routes mapping to current HTML dashboards:
Job Control dashboard → /dashboard
SaaS dashboard (OAuth + API keys + SaaS job flow) → /saas
Multi-tenant dashboard → /multi-tenant
OAuth callback → /oauth/callback
Network strategy:
Use a single API_BASE_URL: Next dev can proxy to backend OR use absolute env NEXT_PUBLIC_API_BASE_URL.
2) Environment & Configuration
Next.js env variables (create .env.local):
NEXT_PUBLIC_API_BASE_URL = Base URL for backend, e.g. http://localhost:3000
Optional if you proxy via Next: configure rewrites() to map /api/* etc. to backend.
Headers:
SaaS endpoints require Authorization: Bearer {apiKey}.
Public endpoints require only Content-Type: application/json for POST.
3) Backend Endpoints Used by the Frontend (by module)
Job Control (public):
POST /search-service – start job
GET /status – list active jobs
GET /status/:jobId – job detail
POST /jobs/:jobId/pause – pause
POST /jobs/:jobId/resume – resume
POST /jobs/:jobId/stop – stop
Multi-tenant Google Sheets + OAuth (public):
GET /multi-tenant-sheets/auth/connect?userEmail=... – redirect to OAuth
GET /multi-tenant-sheets/auth/status?userEmail=... – OAuth connection status
POST /multi-tenant-sheets/auth/disconnect?userEmail=... – revoke OAuth
GET /multi-tenant-sheets/connected?userEmail=... – list connected sheets
POST /multi-tenant-sheets/create – create new sheet { userEmail, sheetName }
GET /multi-tenant-sheets/available?userEmail=... – list available sheets from Drive
POST /multi-tenant-sheets/connect – connect existing sheet { userEmail, sheetId }
DELETE /multi-tenant-sheets/:sheetId?userEmail=... – disconnect sheet
User Data (public):
GET /user-data/summary?userEmail=...
GET /user-data/recent?userEmail=...&limit=5
GET /user-data/export/{csv|json}?userEmail=...
SaaS (API key required: Authorization: Bearer):
POST /api/v1/search-service – start SaaS job (optionally create/select sheet)
GET /api/v1/status/:jobId – SaaS job status
POST /api/v1/jobs/:jobId/{pause|resume|stop}
GET /api/v1/user/sheets – user’s connected sheets
GET /api/v1/user/jobs – user’s job history
API Keys (public):
POST /api-keys/create – create API key { userEmail, planType }
GET /api-keys/:apiKey/stats – inspect key
GET /api-keys/user/:email – list email’s keys
Admin (if used in UI): GET /api-keys/admin/keys, GET /api-keys/admin/users
4) Page/Flow Mapping from Static Dashboards to Next.js
4.1 Job Control Dashboard → /dashboard
State:
currentJobId, jobStatus, progress bar %, time estimates, save stats.
Interactions:
Start job → POST /search-service with body:
city, keyword, method ("api" | "web"), scraper options:
maxResults, maxScrollPages, headless, wantWebsite, wantEmail, emailDeepPaths
phrases.maxPhrases (optional)
Polling:
Every 2s: GET /status to discover active job; or GET /status/:jobId to track.
Controls:
POST /jobs/:jobId/pause|resume|stop
UI Hints:
Disable controls until currentJobId set.
Show progress %, save stats (PostgreSQL, Google Sheets, bothSucceeded).
Log activity lines with timestamps (limit to last ~50).
Implementation prompt:
Build a client component with:
Inputs for city, keyword, method, scraper booleans and counts.
“Start Job” button posts to /search-service, captures jobId.
useEffect polling to /status → set currentJobId, then fine-track via /status/:jobId.
Buttons for Pause/Resume/Stop; enable based on jobStatus.
Activity log list, trimmed to last N entries.
4.2 SaaS Dashboard → /saas
Tabs: OAuth & Setup, API Keys, Usage & Jobs, Admin, Activity.
OAuth & Setup:
Email input; redirect to /multi-tenant-sheets/auth/connect?userEmail=...&redirect_to=saas-dashboard
Check connection status: GET /multi-tenant-sheets/auth/status + /connected + /api-keys/user/:email
Show connected sheets; auto-show latest API key if available
API Keys:
Create key: POST /api-keys/create with { userEmail, planType }
Load key stats: GET /api-keys/:apiKey/stats
Find keys by email: GET /api-keys/user/:email
Usage & Jobs:
Load sheets (Bearer): GET /api/v1/user/sheets
Start SaaS job (Bearer): POST /api/v1/search-service with:
city, keyword, method, either sheetId or { createNewSheet, sheetName }
Refresh status (Bearer): GET /api/v1/status/:jobId
Pause/Resume/Stop (Bearer): POST /api/v1/jobs/:jobId/{pause|resume|stop}
Admin (optional):
GET /api-keys/admin/keys, /api-keys/admin/users to display summaries.
Implementation prompt:
Build a client page with tabs; each tab uses controlled forms and calls the endpoints above.
Centralized API-key state in context or recoil/zustand; persist in localStorage.
After OAuth redirect success, pre-fill API key if /api-keys/user/:email returns keys.
4.3 Multi-tenant Dashboard → /multi-tenant
Reads userEmail from query or localStorage; prompt if missing.
Connection status:
GET /multi-tenant-sheets/auth/status?userEmail=...
GET /multi-tenant-sheets/connected?userEmail=...
Sheet management:
Create: POST /multi-tenant-sheets/create
Connect existing: GET /multi-tenant-sheets/available, then POST /multi-tenant-sheets/connect
Open Sheet: use sheet_url when available
Disconnect: DELETE /multi-tenant-sheets/:sheetId?userEmail=...
Run a job saving to a selected sheet:
POST /search with { keywords, location, maxResults, userEmail, targetSheetId }
Capture jobId, poll /status/:jobId.
Implementation prompt:
Build a client page that:
Gets userEmail from URL or prompt; stores in localStorage and updates URL.
Shows connection tile with status and “Connect Google Sheets” redirect.
Lists connected sheets; select target sheet for job start.
Job start form: keywords, location, method, maxResults; POST /search.
Poll /status/:jobId; show progress and stats; export links: /user-data/export/{csv|json}?userEmail=....
4.4 OAuth Callback → /oauth/callback
The backend handles /oauth/...; your frontend:
Reads query connected=true|false or error=...
Shows success/failure; then deep-links to /saas?userEmail=... or /multi-tenant?userEmail=....
Implementation prompt:
Build a server component route that parses query params and renders a short status card plus a redirect CTA.
5) Cross-cutting Frontend Concerns
API Base URL
Use const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
Calls like fetch(${API}/status)
Auth Header for SaaS:
Authorization: Bearer ${apiKey}
Store API key in a secure place (memory + localStorage fallback).
Polling intervals:
2s for job status to match existing behavior.
Error handling:
On non-2xx: parse json.message || json.error, show toast/log entry.
Query param behaviors:
Save userEmail to localStorage and mirror into URL.
Handle ?connected=true or ?oauth=success|error to display notifications.
Exports:
Open /user-data/export/csv?userEmail=... in new tab.
Accessibility/UX:
Disable job controls when no active jobId.
Show precise validation errors based on backend rules.
6) Route & Proxy Guidance (Next.js)
Option A: Absolute calls using NEXT_PUBLIC_API_BASE_URL
Works both locally and in production if backend is publicly reachable.
Option B: Next.js rewrites proxy
In next.config.js:
Rewrites /backend/:path* → http://localhost:3000/:path*
Then fetch via /backend/... to avoid CORS complexity in dev.
7) Data Contracts & Validation Hints
Start Job (public):
POST /search-service
Required: city, keyword
Optional: method ("api" | "web"), phrases.maxPhrases, scraper.{...}
Start SaaS Job (Bearer):
POST /api/v1/search-service
Required: city, keyword, plus one of sheetId or { createNewSheet, sheetName }
Multi-tenant:
userEmail always required for OAuth and sheet ops.
Job status responses include:
status, processed, total, startTime, method, saveStats, progress, and time estimates when available.
8) Production Checklist (Frontend)
Confirm NEXT_PUBLIC_API_BASE_URL points to production backend.
Set secure deployment for OAuth return URLs (use HTTPS).
Add API key management UX (copy, display, mask).
Handle rate-limit and usage-limit errors gracefully (429, custom messages).
Ensure CORS rules allow your Next.js domain if hitting backend directly.
Add Sentry or similar for frontend error monitoring.
9) Page-by-Page “Build Prompts” You Can Use
/dashboard build prompt:
“Create a Next.js client page with a form for city, keyword, method, and scraper options. On submit, POST to /search-service. Store returned jobId. Poll every 2 seconds to /status/:jobId, update a progress bar, show stats and a log area. Provide Pause/Resume/Stop buttons calling /jobs/:jobId/{pause|resume|stop} and handle responses. Maintain an activity log of last 50 items.”
/saas build prompt:
“Create a Next.js client page with tabs: OAuth & Setup, API Keys, Usage & Jobs, Admin, and Activity. OAuth tab: enter userEmail, redirect to /multi-tenant-sheets/auth/connect?userEmail=...&redirect_to=saas-dashboard. Check connection via /multi-tenant-sheets/auth/status, /connected, and show any keys via /api-keys/user/:email. API Keys tab: create key via POST /api-keys/create, inspect via /api-keys/:apiKey/stats, list via /api-keys/user/:email. Usage & Jobs: load user sheets via /api/v1/user/sheets (Bearer), start job via /api/v1/search-service with either sheetId or { createNewSheet, sheetName }, track job via /api/v1/status/:jobId, and pause/resume/stop with /api/v1/jobs/:jobId/{pause|resume|stop}.”
/multi-tenant build prompt:
“Create a Next.js client page that requires userEmail (from query or localStorage). Show connection status via /multi-tenant-sheets/auth/status?userEmail=... and /connected. Provide buttons to create a sheet (/multi-tenant-sheets/create) and connect an existing one (/multi-tenant-sheets/available + POST /multi-tenant-sheets/connect). Allow disconnect with DELETE /multi-tenant-sheets/:sheetId?userEmail=.... Start a job via POST /search with { keywords, location, method, maxResults, userEmail, targetSheetId }. Poll /status/:jobId and display progress. Include export buttons to /user-data/export/{csv|json}?userEmail=....”
/oauth/callback build prompt:
“Create a Next.js page that reads query params (connected, error, oauth) and displays a status message. Provide buttons to go to /saas?userEmail=... or /multi-tenant?userEmail=... with the captured email.”
10) Error UX Patterns
For 400 validation:
Show the details[] list beside the corresponding inputs.
For 401/403:
Prompt to enter/load an API key; link to API Key tab.
For 429:
Show specific rate or usage limit message and next reset time if present.
For 500:
Display a general error toast; suggest trying later; provide a “copy error” button for support.
11) Testing the Full Flow (Manual QA Script)
OAuth:
Enter email on /saas, click connect, complete Google OAuth, return with success, verify connected sheets and auto API key.
SaaS job:
Load sheets, start job, poll status, see progress and stats, pause/resume/stop.
Job control (public):
Start job from /dashboard, poll /status, stop mid-way, verify.
Multi-tenant:
Create or connect sheet, start job saving to selected sheet, verify recent data and export links.
API keys:
Create a new key, view stats, list by email, test protected endpoints with Authorization.
12) What to Keep Consistent with Public Dashboards
Polling cadence: 2 seconds.
Saved activity log lines: last ~50 items.
Notifications for OAuth redirects (connected=true, oauth=success|error).
Required parameters (e.g., userEmail for multi-tenant).
If you’d like, I can convert this guide into a FRONTEND_GUIDE.md file in your repo, or expand any of the page build prompts into step-by-step checklists for your Next.js team.
