# HealthyText SMS System

A comprehensive SMS automation system for wellness messaging using Twilio API, SQLite databases, and WordPress integration.

## 🚀 Quick Setup Guide

### Prerequisites
- Node.js (v16 or higher)
- Visual Studio Code
- Twilio account (trial is fine)

### Step 1: Create Project Folder
```bash
mkdir healthytext-sms
cd healthytext-sms
```

### Step 2: Initialize Project
```bash
npm init -y
```

### Step 3: Install Dependencies
```bash
npm install express sqlite3 mysql2 twilio node-cron dotenv moment-timezone
npm install --save-dev nodemon
```

### Step 4: Setup Environment
1. Copy the `.env.example` file to `.env`
2. Fill in your Twilio Account SID (you'll need to get this from your Twilio dashboard)
3. The other Twilio credentials are already filled in

### Step 5: Setup Databases
```bash
node scripts/setup-databases.js
```

### Step 6: Test Connections
```bash
npm run test
```

### Step 7: Start the Application
```bash
npm start
```

## 📁 Project Structure
```
healthytext-sms/
├── app.js                 # Main application
├── package.json           # Dependencies
├── .env                   # Environment variables (create from .env.example)
├── databases/             # SQLite databases (auto-created)
│   ├── messages.db
│   ├── user_tracking.db
│   └── system_logs.db
└── scripts/
    ├── setup-databases.js # Database initialization
    └── test-connection.js  # Connection testing
```

## 🧪 Testing the System

### Add a Test User
```bash
curl -X POST http://localhost:3000/test/add-user \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "3122858457", "firstName": "Your Name"}'
```

### Send a Test Message
```bash
curl -X POST http://localhost:3000/test/send-message \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "3122858457", "message": "Hello from Healthy