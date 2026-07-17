# Requirements Document

## Introduction

This feature enhances the existing lead generation platform to provide a complete SaaS workflow with proper job persistence, user authentication, payment integration, and seamless user experience. The system currently has 90% of the functionality but lacks proper job persistence to database, complete payment flow integration, and streamlined user onboarding.

## Requirements

### Requirement 1: Job Persistence and Recovery

**User Story:** As a platform administrator, I want all jobs to be persisted to the database so that job status and progress are maintained across server restarts.

#### Acceptance Criteria

1. WHEN a job is created THEN the system SHALL save the job details to the database immediately
2. WHEN a job status changes THEN the system SHALL update the database record in real-time
3. WHEN a job completes or fails THEN the system SHALL persist the final status and results to the database
4. WHEN the server restarts THEN the system SHALL restore active jobs from the database
5. WHEN a user queries job status THEN the system SHALL return data from the database, not just in-memory storage
6. IF a job is paused or resumed THEN the system SHALL update the database status accordingly
7. WHEN job progress updates THEN the system SHALL persist progress data including phrases processed and businesses found

### Requirement 2: Complete SaaS User Onboarding Flow

**User Story:** As a new user, I want a seamless signup process where I select a plan, authenticate with Google, complete payment, and receive my API key automatically.

#### Acceptance Criteria

1. WHEN a user visits the landing page THEN they SHALL see plan options with clear pricing
2. WHEN a user selects a plan THEN they SHALL be redirected to signup with the plan pre-selected
3. WHEN a user signs up THEN they SHALL authenticate with Google OAuth for Sheets access
4. WHEN OAuth is successful THEN the system SHALL save OAuth credentials for future use
5. WHEN OAuth is complete THEN the user SHALL be redirected to payment verification
6. WHEN payment is verified THEN the system SHALL automatically generate and store an API key
7. WHEN API key is generated THEN the user SHALL be redirected to the dashboard with their key
8. IF OAuth credentials expire THEN the system SHALL handle refresh automatically without user intervention

### Requirement 3: Persistent OAuth Management

**User Story:** As a user, I want my Google Sheets connection to persist so I don't need to re-authenticate every time I use the platform.

#### Acceptance Criteria

1. WHEN a user completes OAuth THEN the system SHALL store access and refresh tokens securely
2. WHEN tokens are near expiry THEN the system SHALL automatically refresh them using the refresh token
3. WHEN a user returns to the platform THEN they SHALL not need to re-authenticate if tokens are valid
4. WHEN tokens cannot be refreshed THEN the system SHALL prompt for re-authentication
5. WHEN a user disconnects their account THEN the system SHALL revoke and remove stored tokens
6. IF token refresh fails THEN the system SHALL handle gracefully and prompt for reconnection

### Requirement 4: Payment Integration and Plan Management

**User Story:** As a user, I want to complete payment verification seamlessly and have my plan automatically activated with appropriate API limits.

#### Acceptance Criteria

1. WHEN a user completes OAuth THEN they SHALL be redirected to payment verification
2. WHEN payment is successful THEN the system SHALL create an API key with the selected plan limits
3. WHEN an API key is created THEN it SHALL have the correct usage limits based on the selected plan
4. WHEN a user upgrades their plan THEN their API key limits SHALL be updated accordingly
5. WHEN payment fails THEN the user SHALL be notified and given options to retry
6. IF a user's plan expires THEN their API access SHALL be limited according to plan rules

### Requirement 5: Enhanced Job Management and Tracking

**User Story:** As a user, I want to track all my jobs with detailed progress information and be able to control them through the dashboard.

#### Acceptance Criteria

1. WHEN a user starts a job THEN it SHALL be associated with their user account and API key
2. WHEN a job is running THEN the user SHALL see real-time progress updates in the dashboard
3. WHEN a user pauses a job THEN the job SHALL stop processing and maintain its current state
4. WHEN a user resumes a job THEN the job SHALL continue from where it was paused
5. WHEN a user stops a job THEN the job SHALL be marked as stopped and results saved
6. WHEN a job completes THEN the user SHALL see final statistics and results
7. IF the server restarts THEN active jobs SHALL resume automatically from their last saved state

### Requirement 6: Sheet Selection and Management

**User Story:** As a user, I want to easily select existing Google Sheets or create new ones for my lead generation jobs.

#### Acceptance Criteria

1. WHEN a user starts a job THEN they SHALL be able to select from their connected Google Sheets
2. WHEN a user wants a new sheet THEN they SHALL be able to create one with a custom name
3. WHEN a sheet is created THEN it SHALL be automatically formatted with appropriate headers
4. WHEN a job saves data THEN it SHALL append to the selected sheet in the correct format
5. WHEN a user views their sheets THEN they SHALL see all connected sheets with metadata
6. IF a sheet is deleted from Google Drive THEN the system SHALL handle the error gracefully

### Requirement 7: Dashboard Enhancement and User Experience

**User Story:** As a user, I want a comprehensive dashboard that shows my jobs, usage statistics, and account information in an intuitive interface.

#### Acceptance Criteria

1. WHEN a user logs in THEN they SHALL see an overview of their account status and recent activity
2. WHEN viewing jobs THEN the user SHALL see job status, progress, and control options
3. WHEN viewing usage THEN the user SHALL see API calls used, remaining, and plan limits
4. WHEN managing sheets THEN the user SHALL see all connected sheets with quick access links
5. WHEN viewing account settings THEN the user SHALL see their plan, API key, and usage statistics
6. IF a user needs to reconnect OAuth THEN they SHALL have a clear call-to-action in the dashboard

### Requirement 8: Error Handling and Recovery

**User Story:** As a user, I want the system to handle errors gracefully and provide clear feedback when issues occur.

#### Acceptance Criteria

1. WHEN a job encounters an error THEN the system SHALL log the error and continue processing other items
2. WHEN OAuth tokens expire THEN the system SHALL attempt automatic refresh before failing
3. WHEN API limits are reached THEN the user SHALL receive clear notification with upgrade options
4. WHEN Google Sheets API fails THEN the system SHALL retry with exponential backoff
5. WHEN the database is unavailable THEN the system SHALL queue operations and retry when available
6. IF critical errors occur THEN the system SHALL notify administrators and provide recovery options