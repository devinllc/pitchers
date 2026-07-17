#### 3. Google Integration (`/google`)

| Endpoint | Method | Description | Authentication |
|----------|--------|-------------|----------------|
| `/google/sheets/connect` | GET | Connect Google Sheets account | JWT |
| `/google/sheets/status` | GET | Check connection status | JWT |
| `/google/sheets/available` | GET | Get available Google Sheets | JWT + Subscription |
| `/google/sheets/connected` | GET | Get connected Google Sheets | JWT + Subscription |
| `/google/sheets/create` | POST | Create new Google Sheet | JWT + Subscription |
| `/google/sheets/connect` | POST | Connect existing Google Sheet | JWT + Subscription |
| `/google/sheets/:sheetId` | DELETE | Disconnect Google Sheet | JWT + Subscription |
| `/google/sheets/data` | GET | Get business data from sheets | JWT + Subscription |
| `/google/sheets/data/stats` | GET | Get business data statistics | JWT + Subscription |
| `/google/sheets/data/save` | POST | Save business data to sheet | JWT + Subscription |
| `/google/sheets/disconnect` | POST | Disconnect Google account | JWT |

#### 4. Job Management (`/jobs`)

| Endpoint | Method | Description | Authentication |
|----------|--------|-------------|----------------|
| `/jobs/create` | POST | Create a new job | JWT + Subscription |
| `/jobs/:jobId` | GET | Get job status | JWT + Subscription |
| `/jobs` | GET | Get all user jobs | JWT + Subscription |
| `/jobs/:jobId/pause` | POST | Pause a job | JWT + Subscription |
| `/jobs/:jobId/resume` | POST | Resume a job | JWT + Subscription |
| `/jobs/:jobId/stop` | POST | Stop a job | JWT + Subscription |

#### 5. Usage Tracking (`/usage`)

| Endpoint | Method | Description | Authentication |
|----------|--------|-------------|----------------|
| `/usage/current` | GET | Get current usage | JWT |
| `/usage/history` | GET | Get usage history | JWT |
| `/usage/by-resource` | GET | Get usage by resource type | JWT |
| `/usage/forecast` | GET | Get usage forecast | JWT |
