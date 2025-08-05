require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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
app.use(express.static('public')); // Serve static files from public folder

// Twilio client
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Database connections
let messagesDb, trackingDb, logsDb, wpConnection, scheduler, responseHandler, messageInjector, wordpressSync, adminSummary;

// Immediate queue processor
let immediateQueueInterval = null;

// WordPress sync processor
let wordpressSyncInterval = null;

// Initialize databases
function initializeDatabases() {
    console.log('Initializing databases...');
    
    messagesDb = new sqlite3.Database(process.env.MESSAGES_DB_PATH || './databases/messages.db');
    trackingDb = new sqlite3.Database(process.env.TRACKING_DB_PATH || './databases/user_tracking.db');
    logsDb = new sqlite3.Database(process.env.LOGS_DB_PATH || './databases/system_logs.db');
    
    console.log('✓ SQLite databases connected');
}

// Initialize WordPress database connection
async function initializeWordPressConnection() {
    try {
        wpConnection = await mysql.createConnection({
            host: process.env.WP_DB_HOST,
            user: process.env.WP_DB_USER,
            password: process.env.WP_DB_PASSWORD,
            database: process.env.WP_DB_NAME
        });
        
        console.log('✓ WordPress database connected');
        return true;
    } catch (error) {
        console.log('⚠ WordPress database connection failed (this is OK for local development):', error.message);
        return false;
    }
}

// Logging function
function logEvent(type, message, phoneNumber = null, additionalData = null) {
    const timestamp = new Date().toISOString();
    
    if (logsDb) {
        logsDb.run(
            'INSERT INTO system_logs (timestamp, log_type, message, phone_number, additional_data) VALUES (?, ?, ?, ?, ?)',
            [timestamp, type, message, phoneNumber, additionalData ? JSON.stringify(additionalData) : null],
            function(err) {
                if (err) console.error('Logging error:', err);
            }
        );
    }
    
    console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}${phoneNumber ? ` (${phoneNumber})` : ''}`);
}

// Test function to verify system
async function testSystem() {
    console.log('\n🔍 Testing system components...');
    
    // Test SQLite databases
    if (messagesDb) {
        messagesDb.get('SELECT COUNT(*) as count FROM messages', (err, row) => {
            if (err) {
                logEvent('error', 'Messages database test failed', null, err);
            } else {
                logEvent('info', `Messages database OK - ${row.count} messages found`);
            }
        });
    }
    
    // Test Twilio (we'll just validate credentials format for now)
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        logEvent('info', 'Twilio credentials configured');
    } else {
        logEvent('warning', 'Twilio credentials missing');
    }
    
    // Test WordPress connection
    const wpConnected = await initializeWordPressConnection();
    if (!wpConnected) {
        logEvent('warning', 'WordPress connection not available - using mock data for development');
    }
}

// Message sending function with MMS support
async function sendMessage(phoneNumber, messageText, messageId = null, mediaUrls = null) {
    try {
        // Normalize phone number to E.164 format
        let normalizedPhone = phoneNumber.replace(/[^\d]/g, '');
        if (!normalizedPhone.startsWith('1') && normalizedPhone.length === 10) {
            normalizedPhone = '1' + normalizedPhone;
        }
        normalizedPhone = '+' + normalizedPhone;
        
        // Auto-attach vCard to introduction messages
        const isIntroMessage = messageId && (
            messageId.includes('welcome') || 
            messageId.includes('intro') || 
            messageId === '1' || // Message #1 is usually intro
            messageText.toLowerCase().includes('welcome') ||
            messageText.toLowerCase().includes('introduction')
        );
        
        if (isIntroMessage && !mediaUrls) {
            const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
            mediaUrls = [
                `${baseUrl}/Elevate-Contact.vcf`, // vCard contact file
                'https://healthytexts.com/wp-content/uploads/2025/08/512.png' // Logo image
            ];
            console.log(`📇 Auto-attaching vCard to introduction message`);
        }
        
        console.log(`📱 Sending message to ${normalizedPhone}: ${messageText.substring(0, 50)}...`);
        
        // In development, we'll just log the message instead of actually sending
        if (process.env.NODE_ENV === 'development') {
            logEvent('info', `[DEV MODE] Would send SMS to ${normalizedPhone}`, normalizedPhone, { messageText, messageId });
            
            // Record in message history
            if (trackingDb) {
                trackingDb.run(
                    `INSERT INTO message_history 
                    (phone_number, message_id, message_type, sent_timestamp, delivery_status, twilio_message_id) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [normalizedPhone, messageId || 'unknown', 'standard', new Date().toISOString(), 'delivered', 'dev_mode_' + Date.now()],
                    function(err) {
                        if (err) logEvent('error', 'Failed to record message history', normalizedPhone, err);
                    }
                );
            }
            
            return { success: true, sid: 'dev_mode_' + Date.now() };
        }
        
        // Production Twilio sending
        const messageData = {
            body: messageText,
            messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
            to: normalizedPhone
        };
        
        // Add media URLs if provided (for MMS)
        if (mediaUrls && mediaUrls.length > 0) {
            messageData.mediaUrl = mediaUrls;
            console.log(`📎 Sending MMS with ${mediaUrls.length} media attachments`);
        }
        
        const message = await twilioClient.messages.create(messageData);
        
        logEvent('info', `Message sent successfully - SID: ${message.sid}`, normalizedPhone);
        
        // Record in message history
        if (trackingDb) {
            trackingDb.run(
                `INSERT INTO message_history 
                (phone_number, message_id, message_type, sent_timestamp, delivery_status, twilio_message_id) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [normalizedPhone, messageId || 'test_message', 'standard', new Date().toISOString(), 'sent', message.sid],
                function(err) {
                    if (err) logEvent('error', 'Failed to record message history', normalizedPhone, err);
                }
            );
            
            // If this is an interactive message, mark user as awaiting response
            if (messageId && (messageText.includes('A)') || messageText.includes('Reply:'))) {
                console.log(`📝 Marking user as awaiting response for interactive message: ${messageId}`);
                trackingDb.run(
                    `UPDATE users SET 
                     awaiting_response = ?, 
                     awaiting_response_since = ? 
                     WHERE phone_number = ?`,
                    [messageId, new Date().toISOString(), normalizedPhone],
                    function(err) {
                        if (err) logEvent('error', 'Failed to set awaiting response', normalizedPhone, err);
                        else console.log(`✅ User marked as awaiting response for message ${messageId}`);
                    }
                );
            }
        }
        
        return { success: true, sid: message.sid };
        
    } catch (error) {
        logEvent('error', `Failed to send message: ${error.message}`, phoneNumber, error);
        return { success: false, error: error.message };
    }
}

// Send welcome message with vCard contact
async function sendWelcomeWithVCard(phoneNumber, messageText, messageId = null) {
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
    const mediaUrls = [
        `${baseUrl}/Elevate-Contact.vcf`, // vCard contact file
        'https://healthytexts.com/wp-content/uploads/2025/08/512.png' // Logo image
    ];
    
    console.log(`📇 Sending welcome message with vCard and logo to ${phoneNumber}`);
    return await sendMessage(phoneNumber, messageText, messageId, mediaUrls);
}

// Add a test user function
function addTestUser(phoneNumber, firstName = 'Test User') {
    const normalizedPhone = phoneNumber.replace(/[^\d]/g, '');
    const formattedPhone = '+1' + normalizedPhone;
    
    if (trackingDb) {
        trackingDb.run(
            `INSERT OR REPLACE INTO users 
            (phone_number, protocol, user_type, first_name, date_joined) 
            VALUES (?, ?, ?, ?, ?)`,
            [formattedPhone, 'Elevate', 'trial', firstName, new Date().toISOString()],
            function(err) {
                if (err) {
                    logEvent('error', 'Failed to add test user', formattedPhone, err);
                } else {
                    logEvent('info', `Test user added: ${firstName} (${formattedPhone})`);
                }
            }
        );
    }
}

// WordPress sync functions
function startWordPressSyncProcessor() {
    if (wordpressSyncInterval) {
        clearInterval(wordpressSyncInterval);
    }

    console.log('🔄 Starting WordPress subscriber sync processor (runs every hour)');
    logEvent('info', 'WordPress subscriber sync processor started - hourly updates');

    // Process immediately on start
    processWordPressSync();

    // Then process every hour (3600000 ms = 1 hour)
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
        logEvent('info', 'Hourly WordPress subscriber sync started');

        if (!wordpressSync) {
            wordpressSync = new WordPressSync({
                wpHost: process.env.WP_DB_HOST,
                wpUser: process.env.WP_DB_USER,
                wpPassword: process.env.WP_DB_PASSWORD,
                wpDatabase: process.env.WP_DB_NAME,
                wpPrefix: process.env.WP_DB_PREFIX,
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                logFunction: logEvent
            });
        }

        // Sync subscribers (existing users, subscription changes, timezone updates)
        const subscriberResult = await wordpressSync.syncSubscribers();
        console.log(`📊 Subscriber sync: ${subscriberResult.syncedCount} updated, ${subscriberResult.skippedCount} skipped`);

        // Sync trial users (new Ninja Form submissions not caught by immediate queue)
        const trialResult = await wordpressSync.syncTrialUsers();
        console.log(`📊 Trial user sync: ${trialResult.syncedCount} added, ${trialResult.skippedCount} skipped`);

        const totalUpdated = subscriberResult.syncedCount + trialResult.syncedCount;
        const totalSkipped = subscriberResult.skippedCount + trialResult.skippedCount;

        logEvent('info', `Hourly WordPress sync completed: ${totalUpdated} users updated, ${totalSkipped} skipped`);
        console.log(`✅ Hourly WordPress sync completed: ${totalUpdated} users updated, ${totalSkipped} skipped`);

        return {
            subscriberResult,
            trialResult,
            totalUpdated,
            totalSkipped
        };

    } catch (error) {
        logEvent('error', 'Hourly WordPress sync failed', null, error);
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

    // Process immediately on start
    processImmediateQueue();

    // Then process every 30 seconds
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
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                logFunction: logEvent
            });
        }

        const result = await wordpressSync.processImmediateQueue(sendMessage);
        
        if (result.totalFound > 0) {
            console.log(`📱 Immediate queue check: ${result.processedCount} welcome messages sent, ${result.errorCount} errors`);
        }

        return result;

    } catch (error) {
        logEvent('error', 'Immediate queue processing failed', null, error);
    }
}

// Routes
app.get('/', (req, res) => {
    res.json({
        status: 'HealthyText SMS System',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Admin dashboard route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Test endpoint to send a message
app.post('/test/send-message', async (req, res) => {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
        return res.status(400).json({ error: 'Phone number and message required' });
    }
    
    const result = await sendMessage(phoneNumber, message, 'test_message');
    res.json(result);
});

// Test endpoint to send welcome message with vCard
app.post('/test/send-welcome-vcard', async (req, res) => {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number required' });
    }
    
    const welcomeMessage = message || 'Welcome to HealthyText! Save our contact info and start your wellness journey. 🌟';
    const result = await sendWelcomeWithVCard(phoneNumber, welcomeMessage, 'welcome_vcard');
    res.json(result);
});

// Test endpoint to add a user
app.post('/test/add-user', (req, res) => {
    const { phoneNumber, firstName } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number required' });
    }
    
    addTestUser(phoneNumber, firstName);
    res.json({ success: true, message: 'Test user added' });
});

// Webhook endpoint for incoming SMS (Twilio)
app.post('/webhook/sms', async (req, res) => {
    try {
        const { From: phoneNumber, Body: messageBody } = req.body;
        
        if (!responseHandler) {
            responseHandler = new ResponseHandler({
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                messagesDbPath: process.env.MESSAGES_DB_PATH || './databases/messages.db',
                sendMessageFunction: sendMessage,
                logFunction: logEvent
            });
        }

        const result = await responseHandler.processIncomingMessage(phoneNumber, messageBody);
        
        // Respond to Twilio (empty response means no auto-reply)
        res.type('text/xml');
        res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        
    } catch (error) {
        logEvent('error', 'SMS webhook error', req.body?.From, error);
        res.status(500).send('Error processing message');
    }
});

// Manual message injection endpoint
app.post('/admin/inject-message', async (req, res) => {
    try {
        const { message, messageId, priority = 1, protocol = 'ALL' } = req.body;
        
        if (!message || !messageId) {
            return res.status(400).json({ 
                error: 'Message content and messageId are required' 
            });
        }

        if (!messageInjector) {
            messageInjector = new MessageInjector({
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                messagesDbPath: process.env.MESSAGES_DB_PATH || './databases/messages.db',
                sendMessageFunction: sendMessage,
                logFunction: logEvent
            });
        }

        const result = await messageInjector.injectMessage({
            message,
            messageId,
            priority,
            protocol
        });

        res.json(result);
        
    } catch (error) {
        logEvent('error', 'Message injection failed', null, error);
        res.status(500).json({ error: error.message });
    }
});

// Get injection history (with optional program filter)
app.get('/admin/injection-history', async (req, res) => {
    try {
        if (!messageInjector) {
            messageInjector = new MessageInjector({
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                messagesDbPath: process.env.MESSAGES_DB_PATH || './databases/messages.db',
                sendMessageFunction: sendMessage,
                logFunction: logEvent
            });
        }

        const program = req.query.program;
        const history = await messageInjector.getInjectionHistory(10, program);
        res.json(history);
        
    } catch (error) {
        logEvent('error', 'Failed to get injection history', null, error);
        res.status(500).json({ error: error.message });
    }
});

// Get program-specific status
app.get('/admin/program-status/:program', async (req, res) => {
    try {
        const program = req.params.program;
        
        if (!messagesDb || !trackingDb) {
            return res.json({
                status: 'initializing',
                message: 'Databases not ready yet',
                timestamp: new Date().toISOString()
            });
        }

        // Get program-specific user count
        trackingDb.get('SELECT COUNT(*) as userCount FROM users WHERE protocol = ?', [program], (err, userRow) => {
            if (err) {
                return res.status(500).json({ error: 'Database error', details: err.message });
            }
            
            // Get program-specific message count
            messagesDb.get('SELECT COUNT(*) as messageCount FROM messages WHERE protocol = ? AND active = 1', [program], (err2, messageRow) => {
                if (err2) {
                    return res.status(500).json({ error: 'Database error', details: err2.message });
                }
                
                res.json({
                    status: 'running',
                    messages: messageRow ? messageRow.messageCount : 0,
                    users: userRow ? userRow.userCount : 0,
                    scheduler: scheduler ? scheduler.isRunning : false,
                    program: program,
                    timestamp: new Date().toISOString()
                });
            });
        });
        
    } catch (error) {
        logEvent('error', 'Failed to get program status', null, error);
        res.status(500).json({ error: error.message });
    }
});

// Get program overview (all programs with stats)
app.get('/admin/program-overview', async (req, res) => {
    try {
        if (!messagesDb || !trackingDb) {
            return res.json([]);
        }

        // Get stats for all programs
        trackingDb.all(`
            SELECT 
                protocol,
                COUNT(*) as user_count,
                SUM(CASE WHEN user_type = 'trial' THEN 1 ELSE 0 END) as trial_users,
                SUM(CASE WHEN user_type = 'subscriber' THEN 1 ELSE 0 END) as subscriber_users
            FROM users 
            WHERE subscription_status NOT IN ('stopped', 'expired')
            GROUP BY protocol
            ORDER BY protocol
        `, [], (err, userStats) => {
            if (err) {
                return res.status(500).json({ error: 'Database error', details: err.message });
            }
            
            // Get message counts per program
            messagesDb.all(`
                SELECT protocol, COUNT(*) as message_count 
                FROM messages 
                WHERE active = 1 
                GROUP BY protocol
                ORDER BY protocol
            `, [], (err2, messageStats) => {
                if (err2) {
                    return res.status(500).json({ error: 'Database error', details: err2.message });
                }
                
                // Merge user and message stats
                const programs = [];
                const messageMap = {};
                
                messageStats.forEach(msg => {
                    messageMap[msg.protocol] = msg.message_count;
                });
                
                userStats.forEach(user => {
                    programs.push({
                        protocol: user.protocol,
                        user_count: user.user_count,
                        trial_users: user.trial_users,
                        subscriber_users: user.subscriber_users,
                        message_count: messageMap[user.protocol] || 0
                    });
                });
                
                // Add programs that have messages but no users yet
                messageStats.forEach(msg => {
                    if (!programs.find(p => p.protocol === msg.protocol)) {
                        programs.push({
                            protocol: msg.protocol,
                            user_count: 0,
                            trial_users: 0,
                            subscriber_users: 0,
                            message_count: msg.message_count
                        });
                    }
                });
                
                res.json(programs);
            });
        });
        
    } catch (error) {
        logEvent('error', 'Failed to get program overview', null, error);
        res.status(500).json({ error: error.message });
    }
});

// Add sample messages for new programs
app.post('/admin/add-sample-program', async (req, res) => {
    try {
        const { program } = req.body;
        
        if (!program) {
            return res.status(400).json({ error: 'Program name required' });
        }

        const sampleMessages = {
            'FitFlow': [
                {
                    id: 'ff1',
                    number: 1,
                    message: 'Welcome to FitFlow, {name}! Ready to transform your fitness journey? Let\'s start strong! 💪',
                    category: 'Educational'
                },
                {
                    id: 'ff2', 
                    number: 2,
                    message: 'Morning {name}! Your body is capable of amazing things. What\'s your workout plan today? A) Cardio B) Strength C) Flexibility D) Rest Day',
                    category: 'Interactive'
                }
            ],
            'NutriWise': [
                {
                    id: 'nw1',
                    number: 1,
                    message: 'Welcome to NutriWise, {name}! Your nutrition journey starts with one healthy choice at a time. 🥗',
                    category: 'Educational'
                },
                {
                    id: 'nw2',
                    number: 2, 
                    message: 'Hi {name}! How are you feeling about your nutrition today? A) Energized B) Satisfied C) Struggling D) Motivated',
                    category: 'Interactive'
                }
            ],
            'SleepWell': [
                {
                    id: 'sw1',
                    number: 1,
                    message: 'Welcome to SleepWell, {name}! Quality sleep is the foundation of wellness. Sweet dreams await! 😴',
                    category: 'Educational'
                },
                {
                    id: 'sw2',
                    number: 2,
                    message: 'Good evening {name}! How did you sleep last night? A) Great B) Good C) Restless D) Poor',
                    category: 'Interactive'
                }
            ],
            'MindSharp': [
                {
                    id: 'ms1',
                    number: 1,
                    message: 'Welcome to MindSharp, {name}! Let\'s unlock your mental potential and sharpen your focus. 🧠',
                    category: 'Educational'
                },
                {
                    id: 'ms2',
                    number: 2,
                    message: 'Hello {name}! How\'s your focus today? A) Sharp B) Good C) Scattered D) Tired',
                    category: 'Interactive'
                }
            ]
        };

        const messages = sampleMessages[program];
        if (!messages) {
            return res.status(400).json({ error: 'Unknown program. Available: FitFlow, NutriWise, SleepWell, MindSharp' });
        }

        let addedCount = 0;
        for (const msgData of messages) {
            try {
                await new Promise((resolve, reject) => {
                    const now = new Date().toISOString();
                    messagesDb.run(`
                        INSERT OR REPLACE INTO messages 
                        (id, number, protocol, pillar, category, message_type, message, tags, link, notes, active, date_created, date_modified)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                    `, [
                        msgData.id,
                        msgData.number,
                        program,
                        program,
                        msgData.category,
                        msgData.category === 'Interactive' ? 'interactive' : 'standard',
                        msgData.message,
                        'sample|' + program.toLowerCase(),
                        null,
                        `Sample message for ${program}`,
                        now,
                        now
                    ], function(err) {
                        if (err) reject(err);
                        else {
                            addedCount++;
                            resolve();
                        }
                    });
                });
            } catch (error) {
                console.error(`Error adding message ${msgData.id}:`, error);
            }
        }

        logEvent('info', `Added ${addedCount} sample messages for ${program}`);
        
        res.json({
            success: true,
            program: program,
            messagesAdded: addedCount,
            message: `Successfully added ${addedCount} sample messages for ${program}`
        });

    } catch (error) {
        logEvent('error', 'Failed to add sample program', null, error);
        res.status(500).json({ error: error.message });
    }
});

// WordPress Integration Endpoints

// Test WordPress connection
app.get('/admin/wordpress-test', async (req, res) => {
    try {
        if (!wordpressSync) {
            wordpressSync = new WordPressSync({
                wpHost: process.env.WP_DB_HOST,
                wpUser: process.env.WP_DB_USER,
                wpPassword: process.env.WP_DB_PASSWORD,
                wpDatabase: process.env.WP_DB_NAME,
                wpPrefix: process.env.WP_DB_PREFIX,
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                logFunction: logEvent
            });
        }

        const result = await wordpressSync.testConnection();
        res.json({
            success: true,
            ...result,
            message: 'WordPress connection successful'
        });

    } catch (error) {
        logEvent('error', 'WordPress connection test failed', null, error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            message: 'WordPress connection failed'
        });
    }
});

// Sync WordPress subscribers
app.post('/admin/sync-subscribers', async (req, res) => {
    try {
        if (!wordpressSync) {
            wordpressSync = new WordPressSync({
                wpHost: process.env.WP_DB_HOST,
                wpUser: process.env.WP_DB_USER,
                wpPassword: process.env.WP_DB_PASSWORD,
                wpDatabase: process.env.WP_DB_NAME,
                wpPrefix: process.env.WP_DB_PREFIX,
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                logFunction: logEvent
            });
        }

        const result = await wordpressSync.syncSubscribers();
        res.json({
            success: true,
            ...result,
            message: `Synced ${result.syncedCount} subscribers successfully`
        });

    } catch (error) {
        logEvent('error', 'Subscriber sync failed', null, error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Sync Ninja Form trial users
app.post('/admin/sync-trial-users', async (req, res) => {
    try {
        if (!wordpressSync) {
            wordpressSync = new WordPressSync({
                wpHost: process.env.WP_DB_HOST,
                wpUser: process.env.WP_DB_USER,
                wpPassword: process.env.WP_DB_PASSWORD,
                wpDatabase: process.env.WP_DB_NAME,
                wpPrefix: process.env.WP_DB_PREFIX,
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                logFunction: logEvent
            });
        }

        const result = await wordpressSync.syncTrialUsers();
        res.json({
            success: true,
            ...result,
            message: `Synced ${result.syncedCount} trial users successfully`
        });

    } catch (error) {
        logEvent('error', 'Trial user sync failed', null, error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Check for new Ninja Form submissions
app.get('/admin/check-new-submissions', async (req, res) => {
    try {
        if (!wordpressSync) {
            wordpressSync = new WordPressSync({
                wpHost: process.env.WP_DB_HOST,
                wpUser: process.env.WP_DB_USER,
                wpPassword: process.env.WP_DB_PASSWORD,
                wpDatabase: process.env.WP_DB_NAME,
                wpPrefix: process.env.WP_DB_PREFIX,
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                logFunction: logEvent
            });
        }

        const newSubmissions = await wordpressSync.checkForNewSubmissions();
        res.json({
            success: true,
            newSubmissions: newSubmissions.length,
            submissions: newSubmissions
        });

    } catch (error) {
        logEvent('error', 'Failed to check new submissions', null, error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
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

app.post('/admin/process-immediate-queue', async (req, res) => {
    try {
        const result = await processImmediateQueue();
        res.json({
            success: true,
            ...result,
            message: `Processed ${result.processedCount} immediate welcome messages for Elevate program`
        });
    } catch (error) {
        logEvent('error', 'Manual immediate queue processing failed', null, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// WordPress sync control endpoints
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
        intervalMs: 3600000,
        nextSyncEstimate: wordpressSyncInterval ? 'Within next hour' : 'Not scheduled',
        timestamp: new Date().toISOString()
    });
});

app.post('/admin/process-wordpress-sync', async (req, res) => {
    try {
        const result = await processWordPressSync();
        res.json({
            success: true,
            ...result,
            message: `Manual WordPress sync completed: ${result.totalUpdated} users updated`
        });
    } catch (error) {
        logEvent('error', 'Manual WordPress sync failed', null, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin summary endpoints
app.post('/admin/send-test-summary', async (req, res) => {
    try {
        if (!adminSummary) {
            return res.status(500).json({ success: false, error: 'Admin summary not initialized' });
        }
        
        const result = await adminSummary.sendTestSummary();
        res.json({
            success: result.success,
            message: result.success ? 'Test admin summary sent successfully' : 'Failed to send test summary',
            error: result.error || null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/admin/summary-status', (req, res) => {
    const phoenixTime = require('moment-timezone')().tz('America/Phoenix');
    res.json({
        scheduled: adminSummary ? true : false,
        adminPhone: '+13122858457',
        scheduleTime: '8:30 PM',
        timezone: 'America/Phoenix',
        currentPhoenixTime: phoenixTime.format('dddd, MMM DD h:mm A z'),
        nextSummary: phoenixTime.clone().hour(20).minute(30).second(0).format('MMM DD, YYYY h:mm A z')
    });
});

// Test interactive message endpoint
app.post('/test/interactive-response', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;
        
        if (!phoneNumber || !message) {
            return res.status(400).json({ 
                error: 'Phone number and message required' 
            });
        }

        if (!responseHandler) {
            responseHandler = new ResponseHandler({
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                messagesDbPath: process.env.MESSAGES_DB_PATH || './databases/messages.db',
                sendMessageFunction: sendMessage,
                logFunction: logEvent
            });
        }

        const result = await responseHandler.processIncomingMessage(phoneNumber, message);
        res.json(result);
        
    } catch (error) {
        logEvent('error', 'Interactive response test failed', phoneNumber, error);
        res.status(500).json({ error: error.message });
    }
});

// Start scheduler
app.post('/scheduler/start', (req, res) => {
    try {
        if (!scheduler) {
            scheduler = new MessageScheduler({
                trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
                messagesDbPath: process.env.MESSAGES_DB_PATH || './databases/messages.db',
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

// Stop scheduler
app.post('/scheduler/stop', (req, res) => {
    if (scheduler) {
        scheduler.stop();
        res.json({ success: true, message: 'Scheduler stopped' });
    } else {
        res.json({ success: false, message: 'Scheduler not running' });
    }
});

// Get scheduler status
app.get('/scheduler/status', (req, res) => {
    res.json({
        running: scheduler ? scheduler.isRunning : false,
        timestamp: new Date().toISOString()
    });
});

// Get system status (enhanced with active programs count)
app.get('/status', (req, res) => {
    if (!messagesDb || !trackingDb) {
        return res.json({
            status: 'initializing',
            message: 'Databases not ready yet',
            timestamp: new Date().toISOString()
        });
    }

    messagesDb.get('SELECT COUNT(*) as messageCount FROM messages WHERE active = 1', (err, messageRow) => {
        if (err) {
            return res.status(500).json({ error: 'Database error', details: err.message });
        }
        
        trackingDb.get('SELECT COUNT(*) as userCount FROM users WHERE subscription_status NOT IN (\'stopped\', \'expired\')', (err2, userRow) => {
            if (err2) {
                return res.status(500).json({ error: 'Database error', details: err2.message });
            }
            
            // Get count of active programs
            trackingDb.get('SELECT COUNT(DISTINCT protocol) as programCount FROM users WHERE subscription_status NOT IN (\'stopped\', \'expired\')', (err3, programRow) => {
                if (err3) {
                    return res.status(500).json({ error: 'Database error', details: err3.message });
                }
                
                res.json({
                    status: 'running',
                    messages: messageRow ? messageRow.messageCount : 0,
                    users: userRow ? userRow.userCount : 0,
                    activePrograms: programRow ? programRow.programCount : 0,
                    scheduler: scheduler ? scheduler.isRunning : false,
                    immediateQueue: immediateQueueInterval !== null,
                    timestamp: new Date().toISOString()
                });
            });
        });
    });
});

// Start the application
async function startApp() {
    console.log('🚀 Starting HealthyText SMS System...');
    
    initializeDatabases();
    await testSystem();
    
    // Add yourself as a test user
    addTestUser('3122858457', 'Admin User');
    
    // Start immediate queue processor for new Elevate signups
    startImmediateQueueProcessor();
    
    // Start WordPress sync processor for hourly subscriber updates
    startWordPressSyncProcessor();
    
    // Start message scheduler for daily automated messages
    if (!scheduler) {
        const MessageScheduler = require('./scheduler');
        scheduler = new MessageScheduler({
            trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
            messagesDbPath: process.env.MESSAGES_DB_PATH || './databases/messages.db',
            sendMessageFunction: sendMessage,
            logFunction: logEvent
        });
    }
    scheduler.start();
    console.log('📅 Message scheduler started - daily messages will be sent automatically');
    
    // Start admin summary system
    if (!adminSummary) {
        adminSummary = new AdminSummary({
            trackingDbPath: process.env.TRACKING_DB_PATH || './databases/user_tracking.db',
            logsDbPath: process.env.LOGS_DB_PATH || './databases/system_logs.db',
            sendMessageFunction: sendMessage,
            logFunction: logEvent
        });
    }
    adminSummary.start();
    
    // Update admin summary with current system status
    adminSummary.updateSystemStatus({
        messageScheduler: true,
        immediateQueue: true,
        wordpressSync: true
    });
    
    app.listen(port, () => {
        console.log(`\n✅ Server running on port ${port}`);
        console.log(`📍 Local URL: http://localhost:${port}`);
        console.log(`🎛️ Admin Dashboard: http://localhost:${port}/admin`);
        console.log(`📱 Test SMS endpoint: POST http://localhost:${port}/test/send-message`);
        console.log(`👤 Add user endpoint: POST http://localhost:${port}/test/add-user`);
        console.log(`📊 Status endpoint: GET http://localhost:${port}/status`);
        console.log(`🚀 Start scheduler: POST http://localhost:${port}/scheduler/start`);
        console.log(`🛑 Stop scheduler: POST http://localhost:${port}/scheduler/stop`);
        console.log(`📨 SMS webhook: POST http://localhost:${port}/webhook/sms`);
        console.log(`💉 Inject message: POST http://localhost:${port}/admin/inject-message`);
        console.log(`📋 Injection history: GET http://localhost:${port}/admin/injection-history`);
        console.log(`🔄 Test response: POST http://localhost:${port}/test/interactive-response`);
        console.log(`🎯 IMMEDIATE QUEUE (Elevate Form ID 4):`);
        console.log(`   🚀 Start: POST http://localhost:${port}/admin/start-immediate-queue`);
        console.log(`   🛑 Stop: POST http://localhost:${port}/admin/stop-immediate-queue`);
        console.log(`   📊 Status: GET http://localhost:${port}/admin/immediate-queue-status`);
        console.log(`   🔄 Process: POST http://localhost:${port}/admin/process-immediate-queue`);
        console.log(`🔄 WORDPRESS SYNC (Hourly Subscriber Updates):`);
        console.log(`   🚀 Start: POST http://localhost:${port}/admin/start-wordpress-sync`);
        console.log(`   🛑 Stop: POST http://localhost:${port}/admin/stop-wordpress-sync`);
        console.log(`   📊 Status: GET http://localhost:${port}/admin/wordpress-sync-status`);
        console.log(`   🔄 Process: POST http://localhost:${port}/admin/process-wordpress-sync`);
        
        logEvent('info', 'HealthyText SMS System started with immediate queue for Elevate program');
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    
    if (scheduler) scheduler.stop();
    if (responseHandler) responseHandler.close();
    if (messageInjector) messageInjector.close();
    if (adminSummary) adminSummary.stop();
    if (immediateQueueInterval) clearInterval(immediateQueueInterval);
    if (wordpressSyncInterval) clearInterval(wordpressSyncInterval);
    if (messagesDb) messagesDb.close();
    if (trackingDb) trackingDb.close();
    if (logsDb) logsDb.close();
    if (wpConnection) wpConnection.end();
    
    logEvent('info', 'System shutdown completed');
    process.exit(0);
});

// Start the application
startApp().catch(console.error);

module.exports = app;