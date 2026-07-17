## Frontend Product Flow (Next.js)

Base URL: `https://pitchers.ufdevs.me`

Scope: Frontend-only integration. Backend stays unchanged; use documented endpoints only (no legacy endpoints).

---

## 1) User Journey Overview

1. User signs in with Google OAuth (Sheets permission) → connection established
2. User chooses a subscription plan and completes purchase
3. System generates (or user generates) an API key
4. User selects an existing Google Sheet or creates a new one
5. User runs a lead generation job; sees progress and stats

---

## 2) Pages and Flows

### A) OAuth Login & Connect (Sheets)

- Route: `/saas` (OAuth tab)
- Actions:
  - Collect `userEmail`
  - Redirect: `GET /multi-tenant-sheets/auth/connect?userEmail={email}&redirect_to=saas-dashboard`
  - After redirect back, check:
    - `GET /multi-tenant-sheets/auth/status?userEmail={email}`
    - `GET /multi-tenant-sheets/connected?userEmail={email}`
- UI:
  - Status card showing connection state
  - List connected sheets with open/remove actions

Notes:
- Store `userEmail` in localStorage and keep it in query params for subsequent pages.

### B) Plan Purchase (Frontend)

- Route: `/pricing` (your Next.js page, integrates with your payment provider)
- Flow:
  - Show plan tiers (Free/Basic/Pro/Enterprise)
  - On purchase success, navigate back to `/saas` and proceed to API key generation
- Backend coupling:
  - No direct backend change required here; your billing system records entitlements

### C) API Key Generation & Management

- Route: `/saas` (API Keys tab)
- Create key:
  - POST `/api-keys/create` with `{ userEmail, planType }`
- Inspect key:
  - GET `/api-keys/:apiKey/stats`
- List keys by email:
  - GET `/api-keys/user/{email}`
- Storage:
  - Keep selected key in memory and localStorage

### D) Sheet Selection / Creation

- Route: `/saas` (Usage & Jobs) or `/multi-tenant`
- Required: a valid API key (Bearer) and OAuth connection
- List user sheets (Bearer):
  - GET `/api/v1/user/sheets`
- Start job requires either:
  - an existing `sheetId`, or
  - `{ createNewSheet: true, sheetName }` (backend will create and use it)

### E) Job UI (Scraping + Stats)

- Routes: `/dashboard` (public job) and `/saas` (SaaS job)
- Start SaaS Job (Bearer):
  - POST `/api/v1/search-service` with body:
    ```json
    {
      "city": "pune",
      "keyword": "restaurants",
      "method": "api",
      "sheetId": "<existing-sheet-id>"
      // or
      // "createNewSheet": true,
      // "sheetName": "New Leads"
    }
    ```
- Track Job:
  - GET `/api/v1/status/:jobId` (Bearer)
- Control:
  - POST `/api/v1/jobs/:jobId/pause|resume|stop` (Bearer)
- Show:
  - Status, progress %, phrases processed, businesses found/saved, save success rate

Public Job (optional non-SaaS UI):
- POST `/search-service` with `{ city, keyword, method, scraper, phrases? }`
- GET `/status/:jobId`
- POST `/jobs/:jobId/pause|resume|stop`

---

## 3) Integration Checklist

- Global config:
  - `NEXT_PUBLIC_API_BASE_URL=https://pitchers.ufdevs.me`
- State management:
  - Persist `userEmail` and selected `apiKey`
  - Keep `jobId` per session
- Security:
  - Use `Authorization: Bearer {apiKey}` for all `/api/v1/*` requests
  - Never store keys in cookies; prefer localStorage + memory
- Polling:
  - 2s interval for status updates
- Errors:
  - Show validation details for 400, auth prompts for 401/403, rate limit messaging for 429

---

## 4) Page Build Prompts (Copy/Paste)

### `/saas` (Tabs: OAuth, API Keys, Usage & Jobs, Activity)
```
Build a client page with tabs. OAuth tab collects email, redirects to /multi-tenant-sheets/auth/connect, then checks status (/auth/status and /connected). API Keys tab can create a key and list keys by email. Usage & Jobs tab (Bearer) loads sheets (/api/v1/user/sheets), starts a job via /api/v1/search-service with either sheetId or createNewSheet+sheetName, polls /api/v1/status/:jobId, and offers pause/resume/stop. Persist apiKey and userEmail.
```

### `/dashboard` (Public Job Control)
```
Client page with form for city/keyword/method/scraper options. POST /search-service to start a job, capture jobId. Poll /status/:jobId every 2s, show progress, stats, and allow pause/resume/stop.
```

### `/multi-tenant` (Sheets Focused)
```
Collect or read userEmail; show connection status; list connected sheets; allow create/connect/disconnect via multi-tenant routes. Start a public job saving to selected sheet by POST /search with { keywords, location, maxResults, userEmail, targetSheetId }; poll /status/:jobId.
```

### `/oauth/callback`
```
Read query params (connected/error). Display status. Provide CTA to /saas?userEmail=... so the user can proceed to API key generation and job setup.
```

---

## 5) UX Notes

- Always indicate when an API key is required for actions (SaaS tabs)
- Disable job controls when no active job
- Show last ~50 activity log entries with timestamps
- Provide copy-to-clipboard for API keys

---

This document, together with FRONTEND_GUIDE.md, provides a production-ready blueprint for adopting your existing frontend to the new, documented flow without backend changes.

