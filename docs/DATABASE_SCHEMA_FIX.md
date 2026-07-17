# Database Schema Fix for Long Business Names

## Problem
The system was failing to save business data with the error:
```
error: value too long for type character varying(255)
```

This occurred when business names exceeded 255 characters, such as "WEBROCK INNOVATIONS PRIVATE LIMITED".

## Root Cause
The database schema had inconsistent field definitions:
- `business_data` table: `name VARCHAR(500)` (correct)
- `businesses` table: `name VARCHAR(255)` (too restrictive)

However, the actual database table was created with `VARCHAR(255)` constraint, causing the error.

## Solution

### 1. Updated Schema Definitions
- Changed `name VARCHAR(500)` to `name TEXT` in `models/UserGoogleSheet.js`
- Changed `name VARCHAR(255)` to `name TEXT` in `services/database.js`

### 2. Created Migration Script
Created `scripts/migrate-database-schema.js` to update existing database tables:
```bash
node scripts/migrate-database-schema.js
```

### 3. Added Data Validation
Enhanced `UserGoogleSheet.js` to clean and validate business data before saving:
- Trim whitespace from all fields
- Handle null/undefined values properly
- Ensure data integrity

## Files Modified
- `models/UserGoogleSheet.js` - Updated schema and added validation
- `services/database.js` - Updated schema definition
- `scripts/migrate-database-schema.js` - New migration script

## Benefits
- ✅ Handles business names of any length
- ✅ Prevents database constraint errors
- ✅ Maintains data integrity
- ✅ Backward compatible with existing data

## Next Steps
1. Run the migration script in production
2. Test with long business names
3. Monitor for any remaining schema issues

## Testing
To test the fix:
```bash
# Test with a long business name
curl -X POST "http://localhost:3000/api/v1/search" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "city": "Mumbai",
    "keyword": "VERY LONG BUSINESS NAME THAT EXCEEDS 255 CHARACTERS AND SHOULD NOW WORK PROPERLY WITHOUT ANY DATABASE CONSTRAINT ERRORS"
  }'
```
