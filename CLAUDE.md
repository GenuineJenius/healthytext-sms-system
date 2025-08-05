# HealthyText SMS System - Project Configuration

## Project Overview
This is a Node.js-based automated SMS wellness messaging system for HealthyText that sends personalized text messages to users via Twilio API. The system manages user eligibility, message sequencing, interactive responses, and subscription tracking with WordPress integration.

## Current Status
- **Development Stage**: Partially built with core infrastructure in place
- **Current Focus**: Linking server with WordPress database tables and Twilio integration
- **Environment**: Node.js with VS Code

## Project Structure
```
HEALTHYTEXT-SMS/
├── databases/           # SQLite database files
│   ├── messages.db     # Main message content database
│   ├── system_logs.db  # System logging and error tracking
│   └── user_tracking.db # User progress and message history
├── node_modules/       # Node.js dependencies
├── public/
│   └── admin.html      # Admin interface
├── scripts/            # Core application scripts
│   ├── app.js          # Main application entry point
│   ├── setup-databases.js
│   ├── test-connection.js
│   ├── messageInjector.js
│   ├── responseHandler.js
│   ├── scheduler.js
│   ├── test-timezone-sync.js
│   └── wordpressSync.js
├── package.json        # Project dependencies
├── package-lock.json
├── .env               # Environment variables (Twilio, DB credentials)
└── test-requests.http # API testing
```

## Core Technologies
- **Runtime**: Node.js
- **Databases**: SQLite (local), WordPress MySQL (remote read-only)
- **SMS Provider**: Twilio API
- **Development Environment**: VS Code

## Database Architecture

### SQLite Databases (Local - Read/Write)
1. **messages.db** - Message content and templates
2. **user_tracking.db** - User progress, message history, and tracking
3. **system_logs.db** - Error logging and system monitoring

### WordPress Database (Remote - Read Only)
- **Host**: 15.204.105.183
- **Port**: 3306
- **Database**: healthtxt_
- **Username**: healthtxt_
- **Password**: pA0-w5Sf[7
- **Charset**: utf8mb4
- **Table Prefix**: Healthtxttbl_
- **Access**: READ-ONLY for user profiles, subscription status, preferences

## Key Features & Components

### User Management
- **Trial Users**: 7-day trial from Ninja Form submissions
- **Subscribers**: Monthly/annual WordPress subscription holders
- **User Matching**: Phone number-based linking between systems

### Message Sequencing
- **Initial Sequence**: Messages 1-30 in exact order
- **Algorithm Mode**: Random selection from remaining messages (post-30)
- **Trial Logic**: Messages 1-7 + post-trial sequence
- **Subscriber Logic**: Full 30-message sequence + algorithm

### Special Message Types
- **Interactive Messages**: A/B/C/D response handling
- **Link Messages**: Immediate follow-up with URLs
- **Manual Injections**: Admin priority broadcasts
- **Milestone Messages**: Celebration messages (30, 60, 90, 180, 365 days)
- **Crisis Support**: Keyword-triggered help responses

### Business Rules
- **Daily Limits**: Max 4 messages per user per 24 hours
- **Time Windows**: 9:00 AM - 6:00 PM user's local timezone
- **Special Timing**: "a.m." tagged messages send 9:00-10:00 AM
- **Sunday Rest**: No messages on Sundays (except crisis keywords)
- **US Only**: All users must have US phone numbers

## Technical Implementation

### Environment Variables (.env)
```
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_twilio_number
WORDPRESS_DB_HOST=15.204.105.183
WORDPRESS_DB_PORT=3306
WORDPRESS_DB_USER=healthtxt_
WORDPRESS_DB_PASSWORD=pA0-w5Sf[7
WORDPRESS_DB_NAME=healthtxt_
WORDPRESS_DB_CHARSET=utf8mb4
ADMIN_PHONE=+13122858457
```

### Critical Environment Handling
- **DEV**: voxel:test_plan → **PROD**: voxel:plan
- **DEV**: voxel:test_stripe_customer_id → **PROD**: voxel:stripe_customer_id

### Phone Number Format
- **Storage**: XXX-XXX-XXXX format (e.g., 312-285-8457)
- **Twilio**: +1XXXXXXXXXX format (E.164)
- **Processing**: Add +1 prefix, remove formatting

## Current Development Priorities

### 1. WordPress Integration (Current Focus)
- Sync user data from WordPress to local SQLite tracking tables
- Handle subscription status monitoring
- Map user preferences and algorithm settings
- Process trial user data from Ninja Forms

### 2. Twilio Integration (Current Focus)
- Message sending functionality
- Delivery status tracking
- Response handling and processing
- vCard contact attachment system

### 3. Core System Components
- Message scheduler with timezone handling
- Interactive response processing
- Manual message injection system
- Error handling and logging

## Code Style & Preferences

### Naming Conventions
- Use descriptive function names: `sendMessage()`, `updateUserSequence()`
- Database fields: snake_case (e.g., `phone_number`, `last_message_sent`)
- JavaScript variables: camelCase (e.g., `messageContent`, `userPreferences`)

### Architecture Approach
- Modular design with separate files for different functions
- Keep database operations separate from business logic
- Error handling with comprehensive logging
- Async/await for database and API operations

### Key Functions to Implement
- `syncWordPressData()` - Pull user data from WordPress
- `sendMessage(phoneNumber, messageId)` - Send via Twilio
- `processUserResponse(phoneNumber, response)` - Handle incoming texts
- `checkMessageSchedule()` - Main scheduler function
- `handleInteractiveMessage()` - Process A/B/C responses
- `injectManualMessage()` - Admin broadcast system

## Testing & Development

### Test Files Available
- `test-connection.js` - Database connectivity
- `test-timezone-sync.js` - Timezone handling
- `test-requests.http` - API endpoint testing

### Development Workflow
1. Local development with SQLite databases
2. WordPress connection testing with read-only access
3. Twilio integration testing with test numbers
4. Deploy to ChemiCloud server for production

## Future Development Areas
- AI response system integration
- Advanced algorithm preferences
- Reporting and analytics dashboard
- Crisis support keyword system
- A/B testing capabilities

## Important Notes
- System designed for 24/7 operation on ChemiCloud server
- All message content editable via DB Browser for SQLite
- WordPress data never modified by SMS system
- Comprehensive duplicate prevention and engagement tracking
- Built-in rate limiting and error recovery