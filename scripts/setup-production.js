require('dotenv').config();
const DatabaseManager = require('./DatabaseManager');

async function setupProduction() {
    console.log('🚀 HealthyText SMS Production Setup');
    console.log('==================================');
    
    const dbManager = new DatabaseManager();
    
    try {
        // Initialize database (will auto-detect MariaDB vs SQLite)
        await dbManager.initialize();
        
        // Insert sample messages for both environments
        await insertSampleMessages(dbManager);
        
        // Run health check
        const health = await dbManager.healthCheck();
        console.log(`\n🏥 Health Check: ${health.status} (${health.database})`);
        
        console.log('\n✅ Production setup complete!');
        console.log('\nNext steps:');
        console.log('1. Verify environment variables are configured');
        console.log('2. Test connections with: npm run test');
        console.log('3. Start application with: npm start');
        
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    } finally {
        await dbManager.close();
    }
}

async function insertSampleMessages(dbManager) {
    console.log('\n📝 Inserting sample messages...');
    
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
            id: '2b',
            number: null,
            protocol: 'Elevate',
            pillar: 'Mindfulness',
            category: 'Response',
            message_type: 'standard',
            message: 'Wonderful {name}! That calm energy is precious. Carry this peaceful feeling with you throughout your day.',
            tags: 'response|calm',
            link: null,
            notes: 'Response to feeling calm'
        },
        {
            id: '2c',
            number: null,
            protocol: 'Elevate',
            pillar: 'Mindfulness',
            category: 'Response',
            message_type: 'standard',
            message: 'I hear you {name}. Stress is temporary, but you are resilient. Take three deep breaths and remember: you\'ve got this! 💪',
            tags: 'response|stressed',
            link: null,
            notes: 'Response to feeling stressed'
        },
        {
            id: '2d',
            number: null,
            protocol: 'Elevate',
            pillar: 'Mindfulness',
            category: 'Response',
            message_type: 'standard',
            message: 'Rest when you need it {name}. Tiredness is your body\'s way of asking for care. Be gentle with yourself today.',
            tags: 'response|tired',
            link: null,
            notes: 'Response to feeling tired'
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
        },
        {
            id: 'unrecognized',
            number: null,
            protocol: 'ALL',
            pillar: 'System',
            category: 'System',
            message_type: 'standard',
            message: 'Thanks for your message! For support, reply HELP. To pause messages, reply STOP.',
            tags: 'unrecognized|system',
            link: null,
            notes: 'Response to unrecognized input'
        }
    ];
    
    let insertedCount = 0;
    
    for (const msg of sampleMessages) {
        try {
            if (dbManager.config.useMariaDB) {
                // MariaDB INSERT OR REPLACE equivalent
                await dbManager.query(`
                    INSERT INTO messages 
                    (id, number, protocol, pillar, category, message_type, message, tags, link, notes, active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    ON DUPLICATE KEY UPDATE
                    number = VALUES(number),
                    protocol = VALUES(protocol),
                    pillar = VALUES(pillar),
                    category = VALUES(category),
                    message_type = VALUES(message_type),
                    message = VALUES(message),
                    tags = VALUES(tags),
                    link = VALUES(link),
                    notes = VALUES(notes),
                    date_modified = NOW()
                `, [
                    msg.id, msg.number, msg.protocol, msg.pillar,
                    msg.category, msg.message_type, msg.message,
                    msg.tags, msg.link, msg.notes
                ]);
            } else {
                // SQLite INSERT OR REPLACE
                await dbManager.query(`
                    INSERT OR REPLACE INTO messages 
                    (id, number, protocol, pillar, category, message_type, message, tags, link, notes, active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                `, [
                    msg.id, msg.number, msg.protocol, msg.pillar,
                    msg.category, msg.message_type, msg.message,
                    msg.tags, msg.link, msg.notes
                ], { database: 'messages' });
            }
            
            insertedCount++;
            
        } catch (error) {
            console.warn(`⚠️  Warning: Could not insert message ${msg.id}:`, error.message);
        }
    }
    
    console.log(`✅ Inserted ${insertedCount}/${sampleMessages.length} sample messages`);
}

// Run setup if called directly
if (require.main === module) {
    setupProduction().catch(console.error);
}

module.exports = { setupProduction };