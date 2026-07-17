### 3. Google Sheets Integration

```javascript
// Connect Google Sheets
async function connectGoogleSheets() {
  const response = await fetch('/google/sheets/connect', {
    headers: getAuthHeaders()
  });
  const data = await response.json();
  
  // Redirect user to Google OAuth page
  window.location.href = data.authUrl;
}

// Get connected sheets
async function getConnectedSheets() {
  const response = await fetch('/google/sheets/connected', {
    headers: getAuthHeaders()
  });
  return await response.json();
}

// Create new sheet
async function createSheet(sheetName) {
  const response = await fetch('/google/sheets/create', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ sheetName })
  });
  return await response.json();
}
```

### 4. Job Management

```javascript
// Create a job
async function createJob(keywords, location, maxResults, targetSheetId) {
  const response = await fetch('/jobs/create', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      keywords,
      location,
      maxResults,
      targetSheetId
    })
  });
  return await response.json();
}

// Get job status
async function getJobStatus(jobId) {
  const response = await fetch(`/jobs/${jobId}`, {
    headers: getAuthHeaders()
  });
  return await response.json();
}

// Get all jobs
async function getAllJobs() {
  const response = await fetch('/jobs', {
    headers: getAuthHeaders()
  });
  return await response.json();
}
```

### 5. Usage Tracking

```javascript
// Get current usage
async function getCurrentUsage() {
  const response = await fetch('/usage/current', {
    headers: getAuthHeaders()
  });
  return await response.json();
}

// Get usage history
async function getUsageHistory(startDate, endDate, groupBy = 'day') {
  const params = new URLSearchParams({
    startDate,
    endDate,
    groupBy
  });
  
  const response = await fetch(`/usage/history?${params}`, {
    headers: getAuthHeaders()
  });
  return await response.json();
}
```
