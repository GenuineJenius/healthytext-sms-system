require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');

console.log('🧪 Testing HealthyText System Connections...\n');

// Test SQLite databases
console.log('1. Testing SQLite Databases...');

const messagesDb = new sqlite3.Database('./databases/messages.db');
const trackingDb = new sqlite3.Database('./databases/user_tracking.db');

messagesDb.get('SELECT COUNT(*) as count FROM messages', (err, row) => {
    if (err) {
        console.log('❌ Messages database error:', err);
    } else {
        console.log(`✅ Messages database: ${row.count} messages available`);
    }
    messagesDb.close();
});

trackingDb.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err) {
        console.log('❌ Users database error:', err);
    } else {
        console.log(`✅ Users database: ${row.count} users registered`);
    }
    trackingDb.close();
});

// Test WordPress connection
console.log('\n2. Testing WordPress Database Connection...');

async function testWordPress() {
    try {
        const wpConnection = await mysql.createConnection({
            host: process.env.WP_DB_HOST,
            user: process.env.WP_DB_USER,
            password: process.env.WP_DB_PASSWORD,
            database: process.env.WP_DB_NAME
        });
        
        // Test query to get user count
        const [rows] = await wpConnection.execute('SELECT COUNT(*) as count FROM Healthtxttbl_users');
        console.log(`✅ WordPress database connected: ${rows[0].count} WordPress users found`);
        
        // Test getting a sample user
        const [sampleUsers] = await wpConnection.execute(`
            SELECT u.ID, u.user_email, 
                   um_name.meta_value as first_name
            FROM Healthtxttbl_users u
            LEFT JOIN Healthtxttbl_usermeta um_name ON u.ID = um_name.user_id AND um_name.meta_key = 'first_name'
            LIMIT 3
        `);
        
        console.log('📋 Sample WordPress users:');
        sampleUsers.forEach(user => {
            console.log(`   - ID: ${user.ID}, Email: ${user.user_email}, Name: ${user.first_name || 'N/A'}`);
        });
        
        await wpConnection.end();
        
    } catch (error) {
        console.log('❌ WordPress database connection failed:', error.message);
        console.log('💡 This is normal for local development - we\'ll use mock data');
    }
}

// Test Twilio configuration
console.log('\n3. Testing Twilio Configuration...');

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    console.log('✅ Twilio Account SID configured');
    console.log('✅ Twilio Auth Token configured');
    console.log(`✅ Twilio Phone Number: ${process.env.TWILIO_PHONE_NUMBER}`);
    console.log(`✅ Admin Phone Number: ${process.env.ADMIN_PHONE_NUMBER}`);
    
    // Test Twilio client creation (don't make actual API call)
    try {
        const twilio = require('twilio');
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        console.log('✅ Twilio client initialized successfully');
    } catch (error) {
        console.log('❌ Twilio client initialization failed:', error.message);
    }
} else {
    console.log('❌ Twilio credentials missing in .env file');
}

console.log('\n4. Environment Check...');
console.log(`Node Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Default Timezone: ${process.env.DEFAULT_TIMEZONE || 'America/Chicago'}`);

// Run WordPress test
testWordPress();

console.log('\n🎯 Test Summary:');
console.log('- If all SQLite tests pass: ✅ Local development ready');
console.log('- If WordPress fails: ⚠️  Normal for local dev, will use mock data');
console.log('- If Twilio configured: ✅ SMS sending ready (dev mode)');
console.log('\nNext: Run "npm start" to launch the application!');