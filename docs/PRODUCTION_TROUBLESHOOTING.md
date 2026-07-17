# Production SIGTERM and OAuth Issues - Troubleshooting Guide

## Issues Identified

### 1. **SIGTERM Error in Production Container**
```
npm error signal SIGTERM
npm error command sh -c node --expose-gc server.js
```

### 2. **Google OAuth Authentication Error**
```
Error: unauthorized_client
GaxiosError: unauthorized_client
```

## Root Causes

### SIGTERM Error
- **Memory Limits**: Container hitting memory constraints
- **Resource Constraints**: CPU/memory limits exceeded
- **Health Check Failures**: Application not responding to health checks
- **Long-running Operations**: Background jobs consuming too many resources

### OAuth Error
- **Expired Refresh Token**: OAuth credentials have expired
- **Invalid Credentials**: OAuth setup is incomplete or corrupted
- **Token Revocation**: User revoked access or credentials were invalidated

## Solutions Applied

### 1. **Container Resource Configuration**

**Updated `render.yaml`:**
```yaml
services:
  - type: web
    name: local-business-scraper
    # Resource configuration for stability
    plan: starter
    region: oregon
    envVars:
      - key: NODE_OPTIONS
        value: "--expose-gc --max-old-space-size=2048"
      - key: RENDER
        value: "true"
      - key: MAX_CONCURRENT_JOBS
        value: "1"
```

### 2. **Enhanced OAuth Error Handling**

**Added to `MultiTenantGoogleSheetsService`:**
```javascript
// Clear invalid OAuth credentials
async clearUserOAuthCredentials(userEmail) {
    const deleteQuery = `
        DELETE FROM user_google_sheets 
        WHERE user_email = $1 AND sheet_id = 'oauth_credentials';
    `;
    // ... implementation
}

// Enhanced error handling
catch (error) {
    if (error.message && error.message.includes('unauthorized_client')) {
        console.log(`OAuth credentials invalid for ${userEmail}, clearing credentials`);
        await this.clearUserOAuthCredentials(userEmail);
    }
    return []; // Return empty array instead of throwing error
}
```

## Production Configuration Recommendations

### 1. **Memory Management**
```bash
# Environment Variables
NODE_OPTIONS="--expose-gc --max-old-space-size=2048"
MAX_CONCURRENT_JOBS=1
ENABLE_MEMORY_MONITORING=true
```

### 2. **OAuth Configuration**
```bash
# Required OAuth Environment Variables
GOOGLE_OAUTH_CLIENT_ID=your_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret
GOOGLE_OAUTH_REDIRECT_URI=https://your-domain.com/oauth/google-sheets/callback
```

### 3. **Database Configuration**
```bash
# Database connection settings
DATABASE_URL=postgresql://user:password@host:port/database
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT=30000
```

## Monitoring and Debugging

### 1. **Health Check Endpoint**
```bash
curl https://your-app.onrender.com/health
```

### 2. **Memory Usage Monitoring**
```javascript
// Check memory usage
const used = process.memoryUsage();
console.log('Memory Usage:', {
    rss: Math.round(used.rss / 1024 / 1024) + ' MB',
    heapTotal: Math.round(used.heapTotal / 1024 / 1024) + ' MB',
    heapUsed: Math.round(used.heapUsed / 1024 / 1024) + ' MB',
    external: Math.round(used.external / 1024 / 1024) + ' MB'
});
```

### 3. **OAuth Status Check**
```bash
# Check OAuth credentials
curl -X GET "https://your-app.onrender.com/api/v1/user/sheets" \
  -H "X-API-Key: your-api-key"
```

## Troubleshooting Steps

### For SIGTERM Errors:
1. **Check Memory Usage**: Monitor container memory consumption
2. **Reduce Concurrency**: Set `MAX_CONCURRENT_JOBS=1`
3. **Enable Memory Monitoring**: Set `ENABLE_MEMORY_MONITORING=true`
4. **Check Health Endpoint**: Ensure `/health` responds quickly
5. **Monitor Logs**: Watch for memory leaks or long-running operations

### For OAuth Errors:
1. **Re-authenticate User**: User needs to reconnect Google account
2. **Check OAuth Setup**: Verify `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`
3. **Clear Invalid Credentials**: System now automatically clears expired tokens
4. **Check Redirect URI**: Ensure it matches Google Console configuration

## Prevention Measures

### 1. **Resource Management**
- Use `MAX_CONCURRENT_JOBS=1` for low-resource containers
- Enable garbage collection with `--expose-gc`
- Monitor memory usage regularly
- Implement graceful shutdown handling

### 2. **OAuth Management**
- Implement token refresh handling
- Clear invalid credentials automatically
- Provide user-friendly re-authentication flow
- Log OAuth errors for debugging

### 3. **Error Handling**
- Return empty arrays instead of throwing errors
- Implement fallback mechanisms
- Log errors with context
- Provide user feedback for authentication issues

## Next Steps

1. **Deploy Updated Configuration**: Deploy with new `render.yaml` settings
2. **Monitor Performance**: Watch memory usage and response times
3. **Test OAuth Flow**: Verify user re-authentication works
4. **Set Up Alerts**: Configure monitoring for SIGTERM and OAuth errors
5. **Document Issues**: Keep track of recurring problems and solutions
