const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Create databases directory if it doesn't exist
const dbDir = './databases';
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('Created databases directory');
}

// Database file paths
const messagesDbPath = path.join(dbDir, 'messages.db');
const trackingDbPath = path.join(dbDir, 'user_tracking.db');
const logsDbPath = path.join(dbDir, 'system_logs.db');

console.log('Setting up HealthyText SMS System databases...');

// 1. Messages Database Setup
console.log('\n1. Setting up Messages Database...');
const messagesDb = new sqlite3.Database(messagesDbPath);

messagesDb.serialize(() => {
    // Messages table
    messagesDb.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            number INTEGER,
            protocol TEXT,
            pillar TEXT,
            category TEXT,
            message_type TEXT,
            message TEXT,
            tags TEXT,
            link TEXT,
            notes TEXT,
            active INTEGER DEFAULT 1,
            date_created TEXT DEFAULT CURRENT_TIMESTAMP,
            date_modified TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('Error creating messages table:', err);
        else console.log('✓ Messages table created');
    });

    // Insert sample messages for testing
    const sampleMessages = [
        {
            id: '1',
            number: 1,
            protocol: 'Elevate',
            pillar: 'Mindfulness',
            category: 'Educational',
            message_type: 'standard',
            message: 'Welcome to HealthyText, {name}! Your wellness journey starts today. Take a deep breath and embrace this moment.',
            tags: 'welcome|first_message',
            link: null,
            notes: 'First welcome message'
        },
        {
            id: '2',
            number: 2,
            protocol: 'Elevate',
            pillar: 'Mindfulness',
            category: 'Interactive',
            message_type: 'interactive',
            message: 'Good morning {name}! How are you feeling today? A) Energized B) Calm C) Stressed D) Tired',
            tags: 'morning|check_in',
            link: null,
            notes: 'Daily mood check-in'
        },
        {
            id: '2a',
            number: null,
            protocol: 'Elevate',
            pillar: 'Mindfulness',
            category: 'Response',
            message_type: 'standard',
            message: 'Great energy {name}! Channel that positive feeling into your day. Remember: you have the power to make today amazing!',
            tags: 'response|energized',
            link: null,
            notes: 'Response to feeling energized'
        },
        {
            id: '34453cds',
            number: null,
            protocol: 'ALL',
            pillar: 'System',
            category: 'Command',
            message_type: 'standard',
            message: 'You have successfully stopped your HealthyText messages. Text START anytime to resume your wellness journey.',
            tags: 'stop|command',
            link: null,
            notes: 'Stop confirmation message'
        },
        {
            id: '3452cds3',
            number: null,
            protocol: 'ALL',
            pillar: 'System',
            category: 'Command',
            message_type: 'standard',
            message: 'Welcome back {name}! Your HealthyText messages have resumed. We\'re glad you\'re continuing your wellness journey.',
            tags: 'start|command',
            link: null,
            notes: 'Start confirmation message'
        }
    ];

    const insertMessage = messagesDb.prepare(`
        INSERT OR REPLACE INTO messages 
        (id, number, protocol, pillar, category, message_type, message, tags, link, notes, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    sampleMessages.forEach(msg => {
        insertMessage.run(
            msg.id, msg.number, msg.protocol, msg.pillar, 
            msg.category, msg.message_type, msg.message, 
            msg.tags, msg.link, msg.notes
        );
    });

    insertMessage.finalize();
    console.log('✓ Sample messages inserted');
});

messagesDb.close();

// 2. User Tracking Database Setup
console.log('\n2. Setting up User Tracking Database...');
const trackingDb = new sqlite3.Database(trackingDbPath);

trackingDb.serialize(() => {
    // Users table
    trackingDb.run(`
        CREATE TABLE IF NOT EXISTS users (
            phone_number TEXT PRIMARY KEY,
            protocol TEXT DEFAULT 'MindBoost',
            user_type TEXT DEFAULT 'trial',
            current_sequence_position INTEGER DEFAULT 1,
            total_messages_sent INTEGER DEFAULT 0,
            subscription_status TEXT DEFAULT 'trial',
            trial_messages_sent INTEGER DEFAULT 0,
            post_trial_phase INTEGER DEFAULT 1,
            post_trial_day INTEGER DEFAULT 0,
            milestones_achieved TEXT DEFAULT '',
            date_joined TEXT DEFAULT CURRENT_TIMESTAMP,
            last_message_sent TEXT,
            messages_sent_today INTEGER DEFAULT 0,
            last_daily_reset TEXT DEFAULT CURRENT_DATE,
            timezone TEXT DEFAULT 'America/Chicago',
            preferred_send_time TEXT DEFAULT '14:00-17:00',
            user_preferences TEXT DEFAULT '{}',
            first_name TEXT,
            awaiting_response TEXT,
            awaiting_response_since TEXT,
            stopped_at_position INTEGER,
            wordpress_user_id INTEGER,
            notes TEXT,
            post_trial_messages_sent TEXT DEFAULT '',
            date_modified TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error('Error creating users table:', err);
        else console.log('✓ Users table created');
    });

    // Message History table
    trackingDb.run(`
        CREATE TABLE IF NOT EXISTS message_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT,
            message_id TEXT,
            message_type TEXT,
            sent_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            delivery_status TEXT DEFAULT 'sent',
            twilio_message_id TEXT,
            user_responded INTEGER DEFAULT 0,
            response_timestamp TEXT,
            sequence_position INTEGER,
            is_manual_injection INTEGER DEFAULT 0,
            protocol TEXT,
            auto_cleanup_date TEXT
        )
    `, (err) => {
        if (err) console.error('Error creating message_history table:', err);
        else console.log('✓ Message history table created');
    });

    // Daily Limits table
    trackingDb.run(`
        CREATE TABLE IF NOT EXISTS daily_limits (
            phone_number TEXT,
            date TEXT,
            messages_sent INTEGER DEFAULT 0,
            last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (phone_number, date)
        )
    `, (err) => {
        if (err) console.error('Error creating daily_limits table:', err);
        else console.log('✓ Daily limits table created');
    });

    // Pending Messages table
    trackingDb.run(`
        CREATE TABLE IF NOT EXISTS pending_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT,
            message_id TEXT,
            priority INTEGER DEFAULT 1,
            scheduled_time TEXT DEFAULT CURRENT_TIMESTAMP,
            is_manual_injection INTEGER DEFAULT 0,
            created_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending'
        )
    `, (err) => {
        if (err) console.error('Error creating pending_messages table:', err);
        else console.log('✓ Pending messages table created');
    });

    // Immediate Queue table
    trackingDb.run(`
        CREATE TABLE IF NOT EXISTS immediate_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT,
            first_name TEXT,
            action TEXT,
            processed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            form_submission_id INTEGER
        )
    `, (err) => {
        if (err) console.error('Error creating immediate_queue table:', err);
        else console.log('✓ Immediate queue table created');
    });
});

trackingDb.close();

// 3. System Logs Database Setup
console.log('\n3. Setting up System Logs Database...');
const logsDb = new sqlite3.Database(logsDbPath);

logsDb.serialize(() => {
    logsDb.run(`
        CREATE TABLE IF NOT EXISTS system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            log_type TEXT,
            message TEXT,
            phone_number TEXT,
            additional_data TEXT
        )
    `, (err) => {
        if (err) console.error('Error creating system_logs table:', err);
        else console.log('✓ System logs table created');
    });
});

logsDb.close();

console.log('\n🎉 Database setup complete!');
console.log('\nNext steps:');
console.log('1. Copy .env.example to .env and fill in your Twilio Account SID');
console.log('2. Run "npm install" to install dependencies');
console.log('3. Run "npm run test" to test connections');
console.log('\nDatabases created:');
console.log(`- Messages: ${messagesDbPath}`);
console.log(`- User Tracking: ${trackingDbPath}`);
console.log(`- System Logs: ${logsDbPath}`);