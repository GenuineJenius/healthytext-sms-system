# HealthyText SMS System

Automated SMS wellness messaging system with Twilio integration, supporting both MariaDB (production) and SQLite (development) databases.

## 🚀 Quick Start

### Local Development (SQLite)
```bash
git clone <your-repo-url>
cd healthytext-sms-system
npm install
cp .env.example .env
# Edit .env with your Twilio credentials
npm run dev
```

### Production Deployment (ChemiCloud + MariaDB)
```bash
git clone <your-repo-url>
cd healthytext-sms-system
npm install
cp .env.example .env
# Configure production environment variables
npm start
```

## 🗄️ Database Architecture

The system automatically detects and uses the appropriate database:

### **Production (MariaDB)**
- **Trigger**: `NODE_ENV=production` OR `MARIADB_HOST` is set
- **Database**: Single MariaDB database with all tables
- **Benefits**: Better performance, concurrent users, proper backups

### **Development (SQLite)**  
- **Trigger**: No MariaDB credentials OR `NODE_ENV=development`
- **Database**: Local SQLite files in `./databases/` directory
- **Benefits**: Easy local development, no server setup required

## 📋 Environment Configuration

### Required Variables
```bash
# Twilio (Required for SMS)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
ADMIN_PHONE_NUMBER=+1234567890

# Production Database (MariaDB)
MARIADB_HOST=your_host
MARIADB_USER=your_username
MARIADB_PASSWORD=your_password
MARIADB_DATABASE=healthytext_sms

# WordPress Integration (Read-only)
WORDPRESS_DB_HOST=15.204.105.183
WORDPRESS_DB_USER=healthtxt_
WORDPRESS_DB_PASSWORD=pA0-w5Sf[7
WORDPRESS_DB_NAME=healthtxt_
```

## 🛠️ Available Scripts

### Development
- `npm run dev` - Start with SQLite, auto-reload
- `npm run setup-dev` - Initialize SQLite databases
- `npm test` - Test all connections

### Production  
- `npm start` - Start with MariaDB (production mode)
- `npm run setup` - Initialize MariaDB tables
- `npm run health` - Database health check

### Testing
- `npm run test-wp` - Test WordPress connection
- `npm run test-timezone` - Test timezone sync
- `npm run test-phone` - Test phone matching
- `npm run test-interactive` - Test response handling

## 🏗️ ChemiCloud Deployment Guide

### 1. Prepare ChemiCloud Environment
```bash
# SSH into your ChemiCloud server
ssh your-username@your-server.com

# Navigate to your domain folder
cd public_html/your-domain
```

### 2. Clone and Setup
```bash
# Clone repository
git clone https://github.com/your-username/healthytext-sms-system.git
cd healthytext-sms-system

# Install dependencies
npm install
```

### 3. Configure Environment
```bash
# Copy environment template
cp .env.example .env

# Edit with your ChemiCloud/cPanel database credentials
nano .env
```

### 4. Setup MariaDB Database
In cPanel:
1. Create new MariaDB database: `healthytext_sms`
2. Create database user with full privileges
3. Note the connection details

### 5. Initialize and Start
```bash
# Setup database tables
npm run setup

# Test connections
npm test

# Start with PM2 (recommended for production)
npm run pm2:start

# Or start manually (will stop if server restarts)
npm start
```

### 6. Production Process Management
```bash
# Check app status
npm run pm2:status

# View logs
npm run pm2:logs

# Restart app
npm run pm2:restart

# Stop app
npm run pm2:stop

# Set up auto-restart on server reboot
pm2 startup
pm2 save
```

## 📊 Database Tables

### Messages Database
- **messages** - Message content and templates
- **system_logs** - Application logging and errors

### User Tracking Database  
- **users** - User profiles and progress tracking
- **message_history** - Complete message delivery history
- **daily_limits** - Daily message count limits
- **pending_messages** - Queued messages for delivery
- **immediate_queue** - Priority message queue

## 🔧 Key Features

### Database Abstraction
- **Unified API** - Same code works with both MariaDB and SQLite
- **Auto-detection** - Automatically selects database based on environment
- **Fallback Support** - Falls back to SQLite if MariaDB unavailable

### Message System
- **Interactive Messages** - A/B/C/D response handling
- **Timezone Support** - User-specific timezone message delivery
- **Trial & Subscription** - Different flows for trial vs paid users
- **Rate Limiting** - Configurable daily message limits

### WordPress Integration
- **Read-Only Sync** - Pulls user data from WordPress database
- **User Matching** - Links WordPress users to SMS system via phone number
- **Subscription Status** - Tracks trial vs subscriber status

## 🚨 Troubleshooting

### Database Connection Issues
```bash
# Check database health
npm run health

# Test specific connections
npm test
npm run test-wp
```

### Environment Detection
```bash
# Check which database is being used
node -e "console.log(process.env.NODE_ENV || 'development')"
node -e "console.log(process.env.MARIADB_HOST ? 'MariaDB' : 'SQLite')"
```

### Common Issues
1. **MariaDB Connection Failed** - Check credentials and firewall
2. **SQLite Permission Error** - Ensure `./databases/` is writable  
3. **Twilio Auth Error** - Verify Account SID and Auth Token
4. **WordPress Timeout** - Check network connectivity to WordPress server

## 📁 Project Structure
```
healthytext-sms-system/
├── scripts/
│   ├── app.js                 # Main application
│   ├── DatabaseManager.js     # Database abstraction layer
│   ├── setup-production.js    # Production setup script
│   └── ...
├── databases/                 # SQLite files (development only)
├── test-*.js                  # Various test files
├── .env.example              # Environment template
├── .gitignore               # Git ignore patterns
└── package.json             # Dependencies and scripts
```

## 🔐 Security Notes

- `.env` files are git-ignored and contain sensitive credentials
- WordPress database access is read-only
- All SMS delivery goes through Twilio's secure API
- Phone numbers are normalized and validated before storage
- Rate limiting prevents SMS abuse

## 📞 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review application logs in ChemiCloud cPanel
3. Test individual components using npm test scripts
4. Ensure all environment variables are properly configured

---

Built with ❤️ for HealthyText wellness messaging