# Puppeteer Navigation Timeout Fix

## Problem
The system was experiencing **Navigation timeout errors** with Puppeteer when scraping Google Maps:

```
Navigation timeout of 60000 ms exceeded
TimeoutError: Navigation timeout of 60000 ms exceeded
```

**Root Cause:**
- Google Maps was taking longer than 60 seconds to load
- Search queries were timing out at 60 seconds
- This caused jobs to fail with `googleMapsSearch took 60511ms` and `60071ms`

## Solution

### 1. Increased Navigation Timeout
Updated `services/googleMapsWebService.js`:
- **Before**: `timeout: 60000` (60 seconds)
- **After**: `timeout: 120000` (120 seconds)

### 2. Updated Both Occurrences
Fixed navigation timeout in two locations:
- Line 440: `collectContacts` method
- Line 1181: `collectContactsFast` method

### 3. Existing Timeout Settings (Already Good)
- **Protocol Timeout**: `600000ms` (10 minutes) ✅
- **Page Navigation Timeout**: `180000ms` (3 minutes) ✅
- **Page Default Timeout**: `120000ms` (2 minutes) ✅

## Files Modified
- `services/googleMapsWebService.js` - Increased navigation timeout from 60s to 120s

## Benefits
- ✅ Handles slow Google Maps loading (up to 2 minutes)
- ✅ Reduces navigation timeout errors
- ✅ Improves job success rate
- ✅ Maintains existing safety timeouts

## Testing
To test the fix:
```bash
# Run a job with a complex search query
curl -X POST "http://localhost:3000/api/v1/search" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "city": "Mumbai",
    "keyword": "Restaurants in Bandra"
  }'
```

## Expected Results
- No more "Navigation timeout of 60000 ms exceeded" errors
- Jobs should complete successfully even with slow Google Maps loading
- Search times up to 120 seconds should be handled gracefully

## Monitoring
Watch for:
- ✅ Successful job completions
- ✅ No navigation timeout errors
- ✅ Reasonable search times (under 120 seconds)
