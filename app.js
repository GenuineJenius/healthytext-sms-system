require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const twilio = require('twilio');
const cron = require('node-cron');
const moment = require('moment-timezone');
const path = require('path');
const MessageScheduler = require('./scheduler');
const ResponseHandler = require('./responseHandler');
const MessageInjector = require('./messageInjector');
const WordPressSync = require('./wordpressSync');
const AdminSummary = require('./adminSummary');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Twilio client
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Database connection pool
let dbPool;
let scheduler, responseHandler, messageInjector, wordpressSync, adminSummary;

// Processors
let immediateQueueInterval = null;
let wordpressSyncInterval = null;

// Initialize MariaDB connection pool
async function initializeDatabase() {
    console.log('🗄️  Initializing MariaDB database...');
    
    try {
        dbPool = mysql.createPool({
            host: process.env.MARIADB_HOST,
            user: process.env.MARIADB_USER,
            password: process.env.MARIADB_PASSWORD,
            database: process.env.MARIADB_DATABASE,
            port: process.env.MARIADB_PORT || 3306,
            charset: 'utf8mb4',
            connectionLimit: 10,
            queueLimit: 0,
            reconnect: true,
            acquireTimeout: 60000,
            timeout: 60000
        });

        // Test connection
        const connection = await dbPool.getConnection();
        await connection.ping();
        connection.release();

        console.log('✅ MariaDB connected successfully');
        return true;
    } catch (error) {
        console.error('❌ MariaDB connection failed:', error.message);
        throw error;
    }
}

// Database query helper function
async function query(sql, params = []) {
    try {
        const [rows] = await dbPool.execute(sql, params);
        return rows;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// Logging function
async function logEvent(type, message, phoneNumber = null, additionalData = null) {
    const timestamp = new Date().toISOString();
    
    try {
        await query(
            'INSERT INTO system_logs (timestamp, log_type, message, phone_number, additional_data) VALUES (?, ?, ?, ?, ?)',
            [timestamp, type, message, phoneNumber, additionalData ? JSON.stringify(additionalData) : null]
        );
    } catch (err) {
        console.error('Logging error:', err);
    }
    
    console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}${phoneNumber ? ` (${phoneNumber})` : ''}`);
}

// Test function to verify system
async function testSystem() {
    console.log('\n🔍 Testing system components...');
    
    try {
        // Test database
        const messages = await query('SELECT COUNT(*) as count FROM messages WHERE active = 1');
        const messageCount = messages[0]?.count || 0;
        await logEvent('info', `Messages database OK - ${messageCount} messages found`);
        
        // Test Twilio
        if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
            await logEvent('info', 'Twilio credentials configured');
        } else {
            await logEvent('warning', 'Twilio credentials missing');
        }
        
        console.log('✅ System tests completed');
    } catch (error) {
        await logEvent('error', 'System test failed', null, error);
        throw error;
    }
}

// Message sending function
async function sendMessage(phoneNumber, messageText, messageId = null, mediaUrls = null) {
    try {
        // Normalize phone number to E.164 format
        let normalizedPhone = phoneNumber.replace(/[^\d]/g, '');
        if (!normalizedPhone.startsWith('1') && normalizedPhone.length === 10) {
            normalizedPhone = '1' + normalizedPhone;
        }
        normalizedPhone = '+' + normalizedPhone;
        
        console.log(`📱 Sending message to ${normalizedPhone}: ${messageText.substring(0, 50)}...`);
        
        // In development, just log the message
        if (process.env.NODE_ENV === 'development') {
            await logEvent('info', `[DEV MODE] Would send SMS to ${normalizedPhone}`, normalizedPhone, { messageText, messageId });
            
            // Record in message history
            await query(`
                INSERT INTO message_history 
                (phone_number, message_id, message_type, sent_timestamp, delivery_status, twilio_message_id) 
                VALUES (?, ?, ?, ?, ?, ?)
            `, [normalizedPhone, messageId || 'unknown', 'standard', new Date().toISOString(), 'delivered', 'dev_mode_' + Date.now()]);
            
            return { success: true, sid: 'dev_mode_' + Date.now() };
        }
        
        // Production Twilio sending
        const messageData = {
            body: messageText,
            messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
            to: normalizedPhone
        };
        
        if (mediaUrls && mediaUrls.length > 0) {
            messageData.mediaUrl = mediaUrls;
            console.log(`📎 Sending MMS with ${mediaUrls.length} media attachments`);
        }
        
        const message = await twilioClient.messages.create(messageData);
        await logEvent('info', `Message sent successfully - SID: ${message.sid}`, normalizedPhone);
        
        // Record in message history
        await query(`
            INSERT INTO message_history 
            (phone_number, message_id, message_type, sent_timestamp, delivery_status, twilio_message_id) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, [normalizedPhone, messageId || 'test_message', 'standard', new Date().toISOString(), 'sent', message.sid]);
        
        // Mark user as awaiting response for interactive messages
        if (messageId && (messageText.includes('A)') || messageText.includes('Reply:'))) {
            console.log(`📝 Marking user as awaiting response for interactive message: ${messageId}`);
            await query(`
                UPDATE users SET 
                awaiting_response = ?, 
                awaiting_response_since = ? 
                WHERE phone_number = ?
            `, [messageId, new Date().toISOString(), normalizedPhone]);
        }
        
        return { success: true, sid: message.sid };
        
    } catch (error) {
        await logEvent('error', `Failed to send message: ${error.message}`, phoneNumber, error);
        return { success: false, error: error.message };
    }
}

// Add test user
async function addTestUser(phoneNumber, firstName = 'Test User') {
    const normalizedPhone = phoneNumber.replace(/[^\d]/g, '');
    const formattedPhone = '+1' + normalizedPhone;
    
    try {
        await query(`
            INSERT INTO users 
            (phone_number, protocol, user_type, first_name, date_joined, date_modified) 
            VALUES (?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
            first_name = VALUES(first_name),
            date_modified = NOW()
        `, [formattedPhone, 'Elevate', 'trial', firstName]);
        
        await logEvent('info', `Test user added: ${firstName} (${formattedPhone})`);
    } catch (error) {
        await logEvent('error', 'Failed to add test user', formattedPhone, error);
    }
}

// WordPress sync functions
function startWordPressSyncProcessor() {
    if (wordpressSyncInterval) {
        clearInterval(wordpressSyncInterval);
    }

    console.log('🔄 Starting WordPress subscriber sync processor (runs every hour)');
    logEvent('info', 'WordPress subscriber sync processor started - hourly updates');

    processWordPressSync();
    wordpressSyncInterval = setInterval(() => {
        processWordPressSync();
    }, 3600000);
}

function stopWordPressSyncProcessor() {
    if (wordpressSyncInterval) {
        clearInterval(wordpressSyncInterval);
        wordpressSyncInterval = null;
        console.log('🛑 WordPress sync processor stopped');
        logEvent('info', 'WordPress subscriber sync processor stopped');
    }
}

async function processWordPressSync() {
    try {
        console.log('🔄 Starting hourly WordPress subscriber sync...');
        await logEvent('info', 'Hourly WordPress subscriber sync started');

        if (!wordpressSync) {
            wordpressSync = new WordPressSync({
                wpHost: process.env.WP_DB_HOST,
                wpUser: process.env.WP_DB_USER,
                wpPassword: process.env.WP_DB_PASSWORD,
                wpDatabase: process.env.WP_DB_NAME,
                wpPrefix: process.env.WP_DB_PREFIX,
                trackingDbPath: './databases/user_tracking.db', // Still needed for WordPressSync class
                logFunction: logEvent
            });
        }

        const subscriberResult = await wordpressSync.syncSubscribers();
        const trialResult = await wordpressSync.syncTrialUsers();
        const totalUpdated = subscriberResult.syncedCount + trialResult.syncedCount;
        const totalSkipped = subscriberResult.skippedCount + trialResult.skippedCount;

        await logEvent('info', `Hourly WordPress sync completed: ${totalUpdated} users updated, ${totalSkipped} skipped`);
        console.log(`✅ Hourly WordPress sync completed: ${totalUpdated} users updated, ${totalSkipped} skipped`);

        return { subscriberResult, trialResult, totalUpdated, totalSkipped };

    } catch (error) {
        await logEvent('error', 'Hourly WordPress sync failed', null, error);
        console.error('❌ Hourly WordPress sync failed:', error.message);
        throw error;
    }
}

// Immediate queue functions  
function startImmediateQueueProcessor() {
    if (immediateQueueInterval) {
        clearInterval(immediateQueueInterval);
    }

    console.log('🚀 Starting immediate queue processor (checks every 30 seconds for new Elevate signups)');
    logEvent('info', 'Immediate queue processor started for Elevate program');

    processImmediateQueue();
    immediateQueueInterval = setInterval(() => {
        processImmediateQueue();
    }, 30000);
}

function stopImmediateQueueProcessor() {
    if (immediateQueueInterval) {
        clearInterval(immediateQueueInterval);
        immediateQueueInterval = null;
        console.log('🛑 Immediate queue processor stopped');
        logEvent('info', 'Immediate queue processor stopped');
    }
}

async function processImmediateQueue() {
    try {
        if (!wordpressSync) {
            wordpressSync = new WordPressSync({
                wpHost: process.env.WP_DB_HOST,
                wpUser: process.env.WP_DB_USER,
                wpPassword: process.env.WP_DB_PASSWORD,
                wpDatabase: process.env.WP_DB_NAME,
                wpPrefix: process.env.WP_DB_PREFIX,
                trackingDbPath: './databases/user_tracking.db',
                logFunction: logEvent
            });
        }

        const result = await wordpressSync.processImmediateQueue(sendMessage);
        
        if (result.totalFound > 0) {
            console.log(`📱 Immediate queue check: ${result.processedCount} welcome messages sent, ${result.errorCount} errors`);
        }

        return result;

    } catch (error) {
        await logEvent('error', 'Immediate queue processing failed', null, error);
    }
}

// Routes
app.get('/', (req, res) => {
    res.json({
        status: 'HealthyText SMS System',
        version: '2.0.0',
        database: 'MariaDB',
        timestamp: new Date().toISOString()
    });
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/test/send-message', async (req, res) => {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
        return res.status(400).json({ error: 'Phone number and message required' });
    }
    
    const result = await sendMessage(phoneNumber, message, 'test_message');
    res.json(result);
});

app.post('/test/add-user', async (req, res) => {
    const { phoneNumber, firstName } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number required' });
    }
    
    await addTestUser(phoneNumber, firstName);
    res.json({ success: true, message: 'Test user added' });
});

app.post('/webhook/sms', async (req, res) => {
    try {
        const { From: phoneNumber, Body: messageBody } = req.body;
        
        if (!responseHandler) {
            responseHandler = new ResponseHandler({
                trackingDbPath: './databases/user_tracking.db', // Will be updated to use MariaDB
                messagesDbPath: './databases/messages.db',
                sendMessageFunction: sendMessage,
                logFunction: logEvent
            });
        }

        const result = await responseHandler.processIncomingMessage(phoneNumber, messageBody);
        
        res.type('text/xml');
        res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        
    } catch (error) {
        await logEvent('error', 'SMS webhook error', req.body?.From, error);
        res.status(500).send('Error processing message');
    }
});

app.get('/status', async (req, res) => {
    try {
        const messageRows = await query('SELECT COUNT(*) as messageCount FROM messages WHERE active = 1');
        const userRows = await query('SELECT COUNT(*) as userCount FROM users WHERE subscription_status NOT IN (\'stopped\', \'expired\')');
        const programRows = await query('SELECT COUNT(DISTINCT protocol) as programCount FROM users WHERE subscription_status NOT IN (\'stopped\', \'expired\')');
        
        res.json({
            status: 'running',
            database: 'MariaDB',
            messages: messageRows[0] ? messageRows[0].messageCount : 0,
            users: userRows[0] ? userRows[0].userCount : 0,
            activePrograms: programRows[0] ? programRows[0].programCount : 0,
            scheduler: scheduler ? scheduler.isRunning : false,
            immediateQueue: immediateQueueInterval !== null,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Database error', details: error.message });
    }
});

// Start/stop endpoints
app.post('/scheduler/start', (req, res) => {
    try {
        if (!scheduler) {
            scheduler = new MessageScheduler({
                trackingDbPath: './databases/user_tracking.db', // Will be updated
                messagesDbPath: './databases/messages.db',
                sendMessageFunction: sendMessage,
                logFunction: logEvent
            });
        }
        
        scheduler.start();
        res.json({ success: true, message: 'Scheduler started' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/scheduler/stop', (req, res) => {
    if (scheduler) {
        scheduler.stop();
        res.json({ success: true, message: 'Scheduler stopped' });
    } else {
        res.json({ success: false, message: 'Scheduler not running' });
    }
});

app.get('/scheduler/status', (req, res) => {
    res.json({
        running: scheduler ? scheduler.isRunning : false,
        timestamp: new Date().toISOString()
    });
});

// Immediate queue endpoints
app.post('/admin/start-immediate-queue', (req, res) => {
    try {
        startImmediateQueueProcessor();
        res.json({ 
            success: true, 
            message: 'Immediate queue processor started - checking every 30 seconds for new Elevate signups' 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/admin/stop-immediate-queue', (req, res) => {
    try {
        stopImmediateQueueProcessor();
        res.json({ success: true, message: 'Immediate queue processor stopped' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/admin/immediate-queue-status', (req, res) => {
    res.json({
        running: immediateQueueInterval !== null,
        program: 'Elevate',
        formId: 4,
        checkInterval: '30 seconds',
        timestamp: new Date().toISOString()
    });
});

// WordPress sync endpoints
app.post('/admin/start-wordpress-sync', (req, res) => {
    try {
        startWordPressSyncProcessor();
        res.json({ 
            success: true, 
            message: 'WordPress subscriber sync processor started - running every hour' 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/admin/stop-wordpress-sync', (req, res) => {
    try {
        stopWordPressSyncProcessor();
        res.json({ success: true, message: 'WordPress sync processor stopped' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/admin/wordpress-sync-status', (req, res) => {
    res.json({
        running: wordpressSyncInterval !== null,
        interval: '1 hour',
        timestamp: new Date().toISOString()
    });
});

// Start the application
async function startApp() {
    console.log('🚀 Starting HealthyText SMS System v2.0...');
    
    await initializeDatabase();
    await testSystem();
    
    // Add admin user
    await addTestUser('3122858457', 'Admin User');
    
    // Start processors
    startImmediateQueueProcessor();
    startWordPressSyncProcessor();
    
    // Start message scheduler
    if (!scheduler) {
        scheduler = new MessageScheduler({
            trackingDbPath: './databases/user_tracking.db', // Will be updated
            messagesDbPath: './databases/messages.db',
            sendMessageFunction: sendMessage,
            logFunction: logEvent
        });
    }
    scheduler.start();
    console.log('📅 Message scheduler started');
    
    // Start admin summary
    if (!adminSummary) {
        adminSummary = new AdminSummary({
            trackingDbPath: './databases/user_tracking.db', // Will be updated
            logsDbPath: './databases/system_logs.db',
            sendMessageFunction: sendMessage,
            logFunction: logEvent
        });
    }
    adminSummary.start();
    
    app.listen(port, () => {
        console.log(`\n✅ Server running on port ${port}`);
        console.log(`📍 Database: MariaDB (Production-Ready)`);
        console.log(`🎛️ Admin Dashboard: http://localhost:${port}/admin`);
        console.log(`📊 Status: http://localhost:${port}/status`);
        
        logEvent('info', 'HealthyText SMS System v2.0 started - MariaDB only');
    });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    
    if (scheduler) scheduler.stop();
    if (responseHandler) responseHandler.close();
    if (messageInjector) messageInjector.close();
    if (adminSummary) adminSummary.stop();
    if (immediateQueueInterval) clearInterval(immediateQueueInterval);
    if (wordpressSyncInterval) clearInterval(wordpressSyncInterval);
    if (dbPool) await dbPool.end();
    
    await logEvent('info', 'System shutdown completed');
    process.exit(0);
});

startApp().catch(console.error);

module.exports = app;