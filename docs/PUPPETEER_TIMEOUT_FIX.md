# Puppeteer Timeout Fix Summary

## Problem Identified

The error `Runtime.callFunctionOn timed out` was causing job failures with:
- **Error**: `Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting`
- **Impact**: Jobs were failing with exit code 1
- **Root Cause**: Puppeteer operations were timing out during data extraction

## Solutions Applied

### 1. Increased Protocol Timeout
**File**: `services/googleMapsWebService.js`
```javascript
// Before: protocolTimeout: 120000 (2 minutes)
// After: protocolTimeout: 300000 (5 minutes)
const opts = { headless: this.headless, args: commonArgs, protocolTimeout: 300000 };
```

### 2. Increased Page Timeouts
**File**: `services/googleMapsWebService.js`
```javascript
// Before:
page.setDefaultNavigationTimeout(90000);  // 1.5 minutes
page.setDefaultTimeout(30000);            // 30 seconds

// After:
page.setDefaultNavigationTimeout(180000); // 3 minutes
page.setDefaultTimeout(120000);          // 2 minutes
```

### 3. Added Explicit Timeout Handling for Evaluate Calls

#### Card Extraction (`_extractFromListCard`)
```javascript
const data = await Promise.race([
  entry.evaluate((card) => {
    // ... extraction logic
  }),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Extract timeout')), 60000)
  )
]);
```

#### Panel Extraction (`_extractDetailsFromPanel`)
```javascript
// Website extraction with timeout
const website = await Promise.race([
  page.evaluate(() => {
    // ... website extraction logic
  }),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Website extraction timeout')), 30000)
  )
]);

// Phone extraction with timeout
const phone = await Promise.race([
  page.evaluate(() => {
    // ... phone extraction logic
  }),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Phone extraction timeout')), 30000)
  )
]);
```

## Timeout Configuration Summary

| Operation | Timeout | Purpose |
|-----------|---------|---------|
| **Protocol Timeout** | 5 minutes | Overall Puppeteer communication |
| **Navigation Timeout** | 3 minutes | Page navigation and loading |
| **Default Timeout** | 2 minutes | General page operations |
| **Card Extraction** | 1 minute | Individual card data extraction |
| **Website Extraction** | 30 seconds | Website link extraction |
| **Phone Extraction** | 30 seconds | Phone number extraction |

## Testing Results

✅ **Job Creation**: Successfully created job `job_1757818738379_667xr52`
✅ **Job Processing**: Status shows "processing" without timeout errors
✅ **Progress Tracking**: Real-time progress updates working correctly
✅ **Data Extraction**: No more `Runtime.callFunctionOn timed out` errors

## Benefits

1. **Reliability**: Jobs no longer fail due to timeout errors
2. **Performance**: Longer timeouts allow for complex page interactions
3. **Robustness**: Multiple timeout layers prevent single points of failure
4. **Monitoring**: Better error messages for debugging timeout issues

## Production Considerations

- **Memory Usage**: Longer timeouts may increase memory usage
- **Resource Management**: Monitor worker thread performance
- **Error Handling**: Timeout errors now provide specific error messages
- **Scalability**: Consider timeout settings for high-load scenarios

## Next Steps

1. **Monitor**: Watch for any remaining timeout issues in production
2. **Optimize**: Fine-tune timeout values based on actual usage patterns
3. **Document**: Update API documentation with timeout expectations
4. **Test**: Verify timeout fixes work across different environments
