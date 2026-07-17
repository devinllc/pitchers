## System Flow

1. **User Authentication**
   - User logs in via Google OAuth
   - Backend issues JWT token
   - Frontend stores token and includes it in all requests

2. **Subscription Management**
   - User selects plan
   - Backend creates Razorpay order
   - Frontend opens Razorpay checkout
   - User completes payment
   - Razorpay sends webhook to backend
   - Backend verifies payment and activates subscription

3. **Google Sheets Integration**
   - User connects Google account
   - Backend stores OAuth credentials
   - User selects or creates Google Sheet for data storage

4. **Job Creation and Execution**
   - User creates job with location, keywords, etc.
   - Backend checks subscription status and usage limits
   - Backend executes job and tracks progress
   - Results are saved to database and Google Sheet

5. **Usage Tracking**
   - Backend tracks all API usage
   - Usage is checked against subscription limits
   - User can view usage statistics and forecast

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Human-readable error message",
  "code": "error_code"
}
```

Common error codes:

- `authentication_required`: User is not authenticated
- `token_expired`: JWT token has expired
- `invalid_token`: JWT token is invalid
- `no_subscription`: User has no active subscription
- `inactive_subscription`: User's subscription is not active
- `subscription_expired`: User's subscription has expired
- `usage_limit_exceeded`: User has exceeded usage limit
- `rate_limit_exceeded`: User has exceeded rate limit
- `job_limit_exceeded`: User has reached maximum concurrent jobs

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables (see `.env.example`)
4. Run the server: `npm start`

## Environment Variables

Create a `.env` file with the following variables:

```
# Server
PORT=3000
NODE_ENV=development

# JWT
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRY=24h
REFRESH_TOKEN_EXPIRY=30d

# Database
DATABASE_URL=postgres://user:password@localhost:5432/database

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Google APIs
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
GEMINI_API_KEY=your-gemini-api-key

# Razorpay
RAZORPAY_KEY_ID=your-razorpay-key-id
RAZORPAY_KEY_SECRET=your-razorpay-key-secret
RAZORPAY_WEBHOOK_SECRET=your-razorpay-webhook-secret
```

## Production Deployment

For production deployment, ensure:

1. Set `NODE_ENV=production`
2. Use a strong `JWT_SECRET`
3. Set up proper SSL/TLS
4. Configure database connection pooling
5. Set up monitoring and logging

## Support

For any questions or issues, please contact the development team.
