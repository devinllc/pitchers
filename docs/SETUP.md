# Local Business Scraper Setup Guide

## Prerequisites

1. **Node.js** (v16 or higher)
2. **PostgreSQL** (v12 or higher)
3. **Google Cloud Project** with Sheets API enabled

## Environment Setup

### 1. Database Setup

The application uses PostgreSQL for data storage. Make sure PostgreSQL is installed and running.

```bash
# Create database and tables
npm run create:db
npm run setup:db
```

### 2. Environment Variables

The `.env` file has been created with the following configuration:

```env
# API Keys
GEMINI_API_KEY=AIzaSyDtJBIV3gQ9yR7aMOet_gOYXZfUF-rhlxM
GOOGLE_MAPS_API_KEY=AIzaSyBZVi_pIWY-BlVCaWWxnK3F3whdMI1TCCQ

# Google Sheets
GOOGLE_SHEETS_SPREADSHEET_ID=1zbbz46lAcfhTZaSoyPPGdYIqMzoJYH8QcNs2wxnEDQ4
GOOGLE_SHEETS_CREDENTIALS_PATH=./credentials/google-sheets-oauth.json

# Database
DATABASE_URL=postgresql://localhost:5432/business_scraper
DB_HOST=localhost
DB_PORT=5432
DB_NAME=business_scraper
DB_USER=postgres
DB_PASSWORD=postgres
```

### 3. Google Sheets OAuth2 Setup

A credentials template has been created at `./credentials/google-sheets-oauth.json`.

**To complete the Google Sheets setup:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google Sheets API
4. Create OAuth2 credentials (Web application)
5. Add `http://localhost:3000/oauth/callback` to authorized redirect URIs
6. Update the credentials file with your actual values:

```json
{
  "client_id": "your_actual_client_id",
  "client_secret": "your_actual_client_secret",
  "redirect_uri": "http://localhost:3000/oauth/callback",
  "refresh_token": "your_actual_refresh_token",
  "access_token": "your_actual_access_token",
  "scope": "https://www.googleapis.com/auth/spreadsheets",
  "token_type": "Bearer",
  "expiry_date": 1234567890000
}
```

### 4. Test Connections

Run the connection test to verify all services are properly configured:

```bash
npm run test:connections
```

## Database Schema

The `businesses` table has been created with the following structure:

```sql
CREATE TABLE businesses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  website VARCHAR(500),
  rating DECIMAL(2,1),
  total_reviews INTEGER,
  opening_hours JSONB,
  place_id VARCHAR(255) UNIQUE,
  search_phrase VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Available Scripts

- `npm run create:db` - Create the PostgreSQL database
- `npm run setup:db` - Create database tables
- `npm run test:connections` - Test all service connections
- `npm start` - Start the production server
- `npm run dev` - Start development server with nodemon

## Next Steps

1. Complete Google Sheets OAuth2 configuration
2. Test all connections using `npm run test:connections`
3. Start implementing the remaining tasks from the implementation plan

## Troubleshooting

### Database Connection Issues
- Ensure PostgreSQL is running
- Check database credentials in `.env`
- Verify database exists: `psql -l`

### Google Sheets Issues
- Verify OAuth2 credentials are correct
- Check spreadsheet ID is accessible
- Ensure API quotas are not exceeded

### API Key Issues
- Verify Gemini API key is valid
- Check Google Maps API key has proper permissions
- Monitor API usage quotas