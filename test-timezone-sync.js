require('dotenv').config();
const WordPressSync = require('./wordpressSync');
const moment = require('moment-timezone');

async function testTimezoneSync() {
    console.log('🕐 Testing Timezone Sync System...\n');
    
    try {
        const wordpressSync = new WordPressSync({
            wpHost: process.env.WP_DB_HOST,
            wpUser: process.env.WP_DB_USER,
            wpPassword: process.env.WP_DB_PASSWORD,
            wpDatabase: process.env.WP_DB_NAME,
            wpPrefix: process.env.WP_DB_PREFIX,
            trackingDbPath: './databases/user_tracking.db',
            logFunction: (type, message, phone, data) => {
                console.log(`[${type.toUpperCase()}] ${message}${phone ? ` (${phone})` : ''}`);
            }
        });

        // Test 1: Check WordPress users with timezones
        console.log('1. Checking WordPress users with timezone data...');
        const subscribers = await wordpressSync.getWordPressSubscribers();
        
        console.log(`Found ${subscribers.length} WordPress subscribers:`);
        subscribers.forEach(sub => {
            if (sub.phone_number) {
                console.log(`   - ${sub.first_name || sub.user_email}: ${sub.phone_number} (${sub.timezone || 'No timezone'})`);
            }
        });

        // Test 2: Sync users and check timezone handling
        console.log('\n2. Testing timezone sync...');
        const syncResult = await wordpressSync.syncSubscribers();
        console.log(`✅ Synced ${syncResult.syncedCount} subscribers`);

        // Test 3: Check current time in different timezones
        console.log('\n3. Current time in different US timezones:');
        const timezones = [
            'America/New_York',
            'America/Chicago', 
            'America/Denver',
            'America/Phoenix',
            'America/Los_Angeles'
        ];

        timezones.forEach(tz => {
            const time = moment().tz(tz);
            const hour = time.hour();
            const canSend = hour >= 9 && hour < 18 && time.day() !== 0;
            console.log(`   ${tz}: ${time.format('dddd, h:mm A z')} ${canSend ? '✅ Can send' : '❌ Cannot send'}`);
        });

        // Test 4: Check users in SMS system with their timezones
        console.log('\n4. Users in SMS system with timezones:');
        const sqlite3 = require('sqlite3').verbose();
        const trackingDb = new sqlite3.Database('./databases/user_tracking.db');
        
        await new Promise((resolve) => {
            trackingDb.all('SELECT phone_number, first_name, timezone, protocol FROM users LIMIT 10', [], (err, rows) => {
                if (err) {
                    console.error('Error:', err);
                } else {
                    rows.forEach(user => {
                        const userTime = moment().tz(user.timezone || 'America/Chicago');
                        console.log(`   ${user.first_name || 'Unknown'} (${user.protocol}): ${user.timezone || 'Default'} - ${userTime.format('h:mm A z')}`);
                    });
                }
                trackingDb.close();
                resolve();
            });
        });

        await wordpressSync.close();
        
        console.log('\n🎯 Timezone sync test complete!');
        console.log('Next: Restart your app to use timezone-aware scheduling');

    } catch (error) {
        console.error('❌ Timezone test failed:', error.message);
    }
}

testTimezoneSync();