const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3').verbose();

class WordPressSync {
    constructor(options) {
        this.wpConfig = {
            host: options.wpHost,
            user: options.wpUser,
            password: options.wpPassword,
            database: options.wpDatabase,
            prefix: options.wpPrefix || 'Healthtxttbl_'  // Fixed: Use correct prefix
        };
        
        this.trackingDbPath = options.trackingDbPath;
        this.logFunction = options.logFunction;
        
        this.trackingDb = new sqlite3.Database(this.trackingDbPath);
        this.wpConnection = null;
        
        console.log('🔗 WordPress Sync initialized (Timezone-Aware)');
    }

    // Connect to WordPress database
    async connectToWordPress() {
        try {
            this.wpConnection = await mysql.createConnection({
                host: this.wpConfig.host,
                user: this.wpConfig.user,
                password: this.wpConfig.password,
                database: this.wpConfig.database,
                connectTimeout: 20000,  // Increased timeout
                acquireTimeout: 20000
            });
            
            this.logFunction('info', 'WordPress database connected successfully');
            return true;
        } catch (error) {
            this.logFunction('error', 'WordPress database connection failed', null, error);
            throw error;
        }
    }

    // Test WordPress connection and verify tables
    async testConnection() {
        try {
            if (!this.wpConnection) {
                await this.connectToWordPress();
            }

            // Test basic user table
            const [users] = await this.wpConnection.execute(`
                SELECT COUNT(*) as count FROM \`${this.wpConfig.prefix}users\`
            `);

            // Test postmeta table (for Ninja Forms)
            const [postmeta] = await this.wpConnection.execute(`
                SELECT COUNT(*) as count FROM \`${this.wpConfig.prefix}postmeta\` 
                WHERE meta_key IN ('_field_11', '_field_12')
            `);

            // Test usermeta table
            const [usermeta] = await this.wpConnection.execute(`
                SELECT COUNT(*) as count FROM \`${this.wpConfig.prefix}usermeta\`
            `);

            this.logFunction('info', `WordPress test: ${users[0].count} users, ${usermeta[0].count} user meta entries, ${postmeta[0].count} form entries found`);

            return {
                success: true,
                users: users[0].count,
                userMeta: usermeta[0].count,
                formEntries: postmeta[0].count
            };

        } catch (error) {
            this.logFunction('error', 'WordPress connection test failed', null, error);
            throw error;
        }
    }

    // Get WordPress subscribers
    async getWordPressSubscribers() {
        try {
            if (!this.wpConnection) {
                await this.connectToWordPress();
            }

            // Updated query to handle environment differences (dev vs prod field names)
            const subscriptionField = process.env.NODE_ENV === 'production' ? 'voxel:plan' : 'voxel:test_plan';
            const customerIdField = process.env.NODE_ENV === 'production' ? 'voxel:stripe_customer_id' : 'voxel:test_stripe_customer_id';

            const [subscribers] = await this.wpConnection.execute(`
                SELECT 
                    u.ID as wordpress_user_id,
                    u.user_email,
                    um_name.meta_value as first_name,
                    um_profile.meta_value as voxel_profile_id,
                    um_subscription.meta_value as subscription_data,
                    um_customer.meta_value as stripe_customer_id,
                    pm_phone.meta_value as phone_number,
                    pm_timezone.meta_value as timezone,
                    pm_switcher.meta_value as mindboost_enabled,
                    pm_pillar1.meta_value as pillar1_enabled,
                    pm_pillar2.meta_value as pillar2_enabled,
                    pm_pillar3.meta_value as pillar3_enabled,
                    pm_pillar4.meta_value as pillar4_enabled,
                    pm_pillar5.meta_value as pillar5_enabled
                FROM \`${this.wpConfig.prefix}users\` u
                LEFT JOIN \`${this.wpConfig.prefix}usermeta\` um_name ON u.ID = um_name.user_id AND um_name.meta_key = 'first_name'
                LEFT JOIN \`${this.wpConfig.prefix}usermeta\` um_profile ON u.ID = um_profile.user_id AND um_profile.meta_key = 'voxel:profile_id'
                LEFT JOIN \`${this.wpConfig.prefix}usermeta\` um_subscription ON u.ID = um_subscription.user_id AND um_subscription.meta_key = ?
                LEFT JOIN \`${this.wpConfig.prefix}usermeta\` um_customer ON u.ID = um_customer.user_id AND um_customer.meta_key = ?
                LEFT JOIN \`${this.wpConfig.prefix}postmeta\` pm_phone ON um_profile.meta_value = pm_phone.post_id AND pm_phone.meta_key = 'phone'
                LEFT JOIN \`${this.wpConfig.prefix}postmeta\` pm_timezone ON um_profile.meta_value = pm_timezone.post_id AND pm_timezone.meta_key = 'timezone'
                LEFT JOIN \`${this.wpConfig.prefix}postmeta\` pm_switcher ON um_profile.meta_value = pm_switcher.post_id AND pm_switcher.meta_key = 'switcher'
                LEFT JOIN \`${this.wpConfig.prefix}postmeta\` pm_pillar1 ON um_profile.meta_value = pm_pillar1.post_id AND pm_pillar1.meta_key = 'pillar-1'
                LEFT JOIN \`${this.wpConfig.prefix}postmeta\` pm_pillar2 ON um_profile.meta_value = pm_pillar2.post_id AND pm_pillar2.meta_key = 'pillar-2'
                LEFT JOIN \`${this.wpConfig.prefix}postmeta\` pm_pillar3 ON um_profile.meta_value = pm_pillar3.post_id AND pm_pillar3.meta_key = 'pillar-3'
                LEFT JOIN \`${this.wpConfig.prefix}postmeta\` pm_pillar4 ON um_profile.meta_value = pm_pillar4.post_id AND pm_pillar4.meta_key = 'pillar-4'
                LEFT JOIN \`${this.wpConfig.prefix}postmeta\` pm_pillar5 ON um_profile.meta_value = pm_pillar5.post_id AND pm_pillar5.meta_key = 'pillar-5'
                WHERE pm_phone.meta_value IS NOT NULL 
                AND pm_phone.meta_value != ''
                AND pm_phone.meta_value REGEXP '^[0-9+()-. ]+$'
            `, [subscriptionField, customerIdField]);

            this.logFunction('info', `Retrieved ${subscribers.length} WordPress subscribers`);
            return subscribers;

        } catch (error) {
            this.logFunction('error', 'Failed to get WordPress subscribers', null, error);
            throw error;
        }
    }

    // Get Ninja Form trial users
    async getNinjaFormTrialUsers() {
        try {
            if (!this.wpConnection) {
                await this.connectToWordPress();
            }

            const [trialUsers] = await this.wpConnection.execute(`
                SELECT 
                    pm_name.post_id as form_submission_id,
                    pm_name.meta_value as first_name,
                    pm_phone.meta_value as phone_number,
                    p.post_date as submission_date
                FROM \`${this.wpConfig.prefix}postmeta\` pm_name
                JOIN \`${this.wpConfig.prefix}postmeta\` pm_phone ON pm_name.post_id = pm_phone.post_id
                JOIN \`${this.wpConfig.prefix}posts\` p ON pm_name.post_id = p.ID
                WHERE pm_name.meta_key = '_field_11'
                AND pm_phone.meta_key = '_field_12'
                AND pm_phone.meta_value IS NOT NULL
                AND pm_phone.meta_value != ''
                AND pm_phone.meta_value REGEXP '^[0-9+()-. ]+$'
                AND p.post_status = 'publish'
                ORDER BY p.post_date DESC
            `);

            this.logFunction('info', `Retrieved ${trialUsers.length} Ninja Form trial users`);
            return trialUsers;

        } catch (error) {
            this.logFunction('error', 'Failed to get Ninja Form trial users', null, error);
            throw error;
        }
    }

    // Sync WordPress subscribers to SMS system
    async syncSubscribers() {
        try {
            const subscribers = await this.getWordPressSubscribers();
            let syncedCount = 0;
            let skippedCount = 0;

            console.log(`📋 Processing ${subscribers.length} WordPress subscribers...`);

            for (const subscriber of subscribers) {
                try {
                    // Parse subscription data
                    const subscriptionData = this.parseSubscriptionData(subscriber.subscription_data);
                    const userType = subscriptionData.status === 'active' ? 'subscriber' : 'trial';
                    const subscriptionStatus = subscriptionData.status || 'inactive';

                    // Skip inactive subscriptions
                    if (subscriptionStatus === 'inactive') {
                        skippedCount++;
                        continue;
                    }

                    // Normalize phone number
                    const phoneNumber = this.normalizePhoneNumber(subscriber.phone_number);
                    if (!phoneNumber) {
                        console.log(`⚠️ Skipping ${subscriber.user_email}: Invalid phone number (${subscriber.phone_number})`);
                        skippedCount++;
                        continue;
                    }

                    // Parse user preferences
                    const userPreferences = this.parseUserPreferences(subscriber);

                    // Determine protocol based on enabled features
                    const protocol = subscriber.mindboost_enabled === '1' ? 'MindBoost' : 'Elevate';

                    // Sync to SMS system
                    await this.syncUserToSMS({
                        phoneNumber,
                        firstName: subscriber.first_name,
                        userType,
                        subscriptionStatus,
                        wordpressUserId: subscriber.wordpress_user_id,
                        timezone: subscriber.timezone || 'America/Chicago',
                        protocol,
                        preferences: userPreferences
                    });

                    console.log(`✅ Synced: ${subscriber.first_name || subscriber.user_email} (${phoneNumber}) - Timezone: ${subscriber.timezone || 'Default'}`);
                    syncedCount++;

                } catch (error) {
                    this.logFunction('error', `Failed to sync subscriber ${subscriber.wordpress_user_id}: ${error.message}`, null, error);
                    skippedCount++;
                }
            }

            this.logFunction('info', `Subscriber sync complete: ${syncedCount} synced, ${skippedCount} skipped`);
            return { syncedCount, skippedCount, totalFound: subscribers.length };

        } catch (error) {
            this.logFunction('error', 'Subscriber sync failed', null, error);
            throw error;
        }
    }

    // Sync trial users from Ninja Forms
    async syncTrialUsers() {
        try {
            const trialUsers = await this.getNinjaFormTrialUsers();
            let syncedCount = 0;
            let skippedCount = 0;

            console.log(`📋 Processing ${trialUsers.length} Ninja Form trial users...`);

            for (const trialUser of trialUsers) {
                try {
                    const phoneNumber = this.normalizePhoneNumber(trialUser.phone_number);
                    if (!phoneNumber) {
                        console.log(`⚠️ Skipping submission ${trialUser.form_submission_id}: Invalid phone number (${trialUser.phone_number})`);
                        skippedCount++;
                        continue;
                    }

                    // Check if user already exists in SMS system
                    const existingUser = await this.getUserFromSMS(phoneNumber);
                    if (existingUser) {
                        console.log(`⚠️ Skipping ${trialUser.first_name}: Already exists (${phoneNumber})`);
                        skippedCount++;
                        continue;
                    }

                    // Add to SMS system as trial user
                    await this.syncUserToSMS({
                        phoneNumber,
                        firstName: trialUser.first_name,
                        userType: 'trial',
                        subscriptionStatus: 'trial',
                        wordpressUserId: null,
                        timezone: 'America/Chicago', // Default for trial users
                        protocol: 'Elevate',
                        preferences: {},
                        formSubmissionId: trialUser.form_submission_id
                    });

                    console.log(`✅ Synced trial user: ${trialUser.first_name} (${phoneNumber})`);
                    syncedCount++;

                } catch (error) {
                    this.logFunction('error', `Failed to sync trial user ${trialUser.form_submission_id}: ${error.message}`, null, error);
                    skippedCount++;
                }
            }

            this.logFunction('info', `Trial user sync complete: ${syncedCount} synced, ${skippedCount} skipped`);
            return { syncedCount, skippedCount, totalFound: trialUsers.length };

        } catch (error) {
            this.logFunction('error', 'Trial user sync failed', null, error);
            throw error;
        }
    }

    // Check for new Ninja Form submissions (for immediate welcome messages)
    async checkForNewSubmissions() {
        try {
            if (!this.wpConnection) {
                await this.connectToWordPress();
            }

            // Get submissions from the last 5 minutes
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

            const [newSubmissions] = await this.wpConnection.execute(`
                SELECT 
                    pm_name.post_id as form_submission_id,
                    pm_name.meta_value as first_name,
                    pm_phone.meta_value as phone_number,
                    p.post_date as submission_date
                FROM \`${this.wpConfig.prefix}postmeta\` pm_name
                JOIN \`${this.wpConfig.prefix}postmeta\` pm_phone ON pm_name.post_id = pm_phone.post_id
                JOIN \`${this.wpConfig.prefix}posts\` p ON pm_name.post_id = p.ID
                WHERE pm_name.meta_key = '_field_11'
                AND pm_phone.meta_key = '_field_12'
                AND p.post_date > ?
                AND p.post_status = 'publish'
                ORDER BY p.post_date DESC
            `, [fiveMinutesAgo]);

            return newSubmissions;

        } catch (error) {
            this.logFunction('error', 'Failed to check for new submissions', null, error);
            return [];
        }
    }

    // Check for immediate queue entries (new Elevate form submissions)
    async checkImmediateQueue() {
        try {
            if (!this.wpConnection) {
                await this.connectToWordPress();
            }

            // Get unprocessed entries from immediate queue
            const [queueEntries] = await this.wpConnection.execute(`
                SELECT id, phone_number, first_name, action, program, form_id, form_submission_id, created_at
                FROM \`${this.wpConfig.prefix}sms_immediate_queue\`
                WHERE processed = 0 
                ORDER BY created_at ASC
                LIMIT 10
            `);

            if (queueEntries.length > 0) {
                this.logFunction('info', `Found ${queueEntries.length} immediate queue entries to process`);
            }
            
            return queueEntries;

        } catch (error) {
            this.logFunction('error', 'Failed to check immediate queue', null, error);
            return [];
        }
    }

    // Process immediate queue entries (send welcome messages) - TIMEZONE-AWARE
    async processImmediateQueue(sendMessageFunction) {
        try {
            const queueEntries = await this.checkImmediateQueue();
            let processedCount = 0;
            let errorCount = 0;
            let delayedCount = 0;

            for (const entry of queueEntries) {
                try {
                    console.log(`📱 Processing immediate welcome: ${entry.first_name} (${entry.phone_number}) - ${entry.program}`);

                    // Validate phone number using existing method
                    const phoneNumber = this.normalizePhoneNumber(entry.phone_number);
                    if (!phoneNumber) {
                        await this.markQueueEntryProcessed(entry.id, 'invalid_phone');
                        errorCount++;
                        continue;
                    }

                    // Check if user already exists using existing method
                    const existingUser = await this.getUserFromSMS(phoneNumber);
                    if (existingUser) {
                        this.logFunction('info', `User ${phoneNumber} already exists, skipping welcome message`);
                        await this.markQueueEntryProcessed(entry.id, 'user_exists');
                        continue;
                    }

                    // Add user to SMS system using existing method (with proper timezone)
                    await this.syncUserToSMS({
                        phoneNumber: phoneNumber,
                        firstName: entry.first_name,
                        userType: 'trial',
                        subscriptionStatus: 'trial',
                        wordpressUserId: null,
                        timezone: 'America/Chicago', // Default for new users, will be updated from WordPress
                        protocol: entry.program || 'Elevate',
                        preferences: {},
                        formSubmissionId: entry.form_submission_id
                    });

                    // Send immediate welcome message (timezone-aware)
                    const welcomeResult = await this.sendWelcomeMessage(
                        phoneNumber, 
                        entry.first_name, 
                        entry.program || 'Elevate',
                        sendMessageFunction
                    );

                    if (welcomeResult.success) {
                        this.logFunction('info', `✅ Welcome message sent to ${entry.first_name} (${phoneNumber}) at ${welcomeResult.sentAt || 'current time'}`);
                        await this.markQueueEntryProcessed(entry.id, 'sent');
                        processedCount++;
                    } else if (welcomeResult.error.includes('Sunday') || welcomeResult.error.includes('hours')) {
                        this.logFunction('info', `⏰ Welcome message delayed for ${entry.first_name}: ${welcomeResult.error}`);
                        await this.markQueueEntryProcessed(entry.id, 'delayed');
                        delayedCount++;
                    } else {
                        this.logFunction('error', `❌ Failed to send welcome message to ${phoneNumber}: ${welcomeResult.error}`, phoneNumber);
                        await this.markQueueEntryProcessed(entry.id, 'send_failed');
                        errorCount++;
                    }

                } catch (error) {
                    this.logFunction('error', `Error processing queue entry ${entry.id}`, entry.phone_number, error);
                    await this.markQueueEntryProcessed(entry.id, 'error');
                    errorCount++;
                }

                // Small delay between sends
                await this.delay(1000);
            }

            if (processedCount > 0 || errorCount > 0 || delayedCount > 0) {
                console.log(`📊 Immediate queue processed: ${processedCount} sent, ${delayedCount} delayed, ${errorCount} errors`);
            }

            return { processedCount, errorCount, delayedCount, totalFound: queueEntries.length };

        } catch (error) {
            this.logFunction('error', 'Failed to process immediate queue', null, error);
            throw error;
        }
    }

    // Send welcome message to new user (TIMEZONE-AWARE)
    async sendWelcomeMessage(phoneNumber, firstName, program, sendMessageFunction) {
        try {
            // Get user's timezone from the tracking database
            const user = await this.getUserFromSMS(phoneNumber);
            const userTimezone = user?.timezone || 'America/Chicago';
            
            // Check if it's a good time to send in user's timezone
            const moment = require('moment-timezone');
            const userTime = moment().tz(userTimezone);
            const hour = userTime.hour();
            const day = userTime.day(); // 0 = Sunday
            
            console.log(`🕐 Welcome message timing check for ${firstName}: ${userTime.format('dddd, h:mm A z')}`);
            
            // For immediate welcome messages, we're more flexible with timing
            // But still respect basic rules: no Sunday, and reasonable hours
            if (day === 0) {
                console.log(`⏰ Delaying welcome message for ${firstName} - Sunday rest day in ${userTimezone}`);
                // Could implement a delay queue here, for now we'll skip
                return { success: false, error: 'Sunday rest day - welcome message delayed' };
            }
            
            // Allow welcome messages during extended hours (8 AM - 8 PM)
            if (hour < 8 || hour >= 20) {
                console.log(`⏰ Delaying welcome message for ${firstName} - outside hours in ${userTimezone} (${userTime.format('h:mm A')})`);
                return { success: false, error: `Outside welcome hours in ${userTimezone}` };
            }

            // Get the welcome message for this program
            const welcomeMessage = await this.getWelcomeMessage(program);
            
            if (!welcomeMessage) {
                throw new Error(`Welcome message not found for program: ${program}`);
            }

            // Personalize the message
            let personalizedMessage = welcomeMessage.message;
            if (firstName) {
                personalizedMessage = personalizedMessage.replace(/\{name\}/g, firstName);
            } else {
                personalizedMessage = personalizedMessage.replace(/\{name\}[,\s]*/g, '').replace(/\s+/g, ' ').trim();
            }

            console.log(`📤 Sending welcome message to ${firstName} at ${userTime.format('h:mm A z')}: "${personalizedMessage.substring(0, 50)}..."`);

            // Send the message
            const result = await sendMessageFunction(phoneNumber, personalizedMessage, welcomeMessage.id);
            
            if (result.success) {
                // Update user progress in SMS system
                await this.updateUserAfterWelcome(phoneNumber, userTimezone);
                return { success: true, sentAt: userTime.format('h:mm A z') };
            } else {
                return { success: false, error: result.error };
            }

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Get welcome message for program (first message in sequence)
    async getWelcomeMessage(program = 'Elevate') {
        return new Promise((resolve, reject) => {
            const sqlite3 = require('sqlite3').verbose();
            const messagesDb = new sqlite3.Database('./databases/messages.db');
            
            messagesDb.get(
                'SELECT * FROM messages WHERE number = 1 AND protocol = ? AND active = 1 LIMIT 1', 
                [program], 
                (err, row) => {
                    messagesDb.close();
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    // Update user after sending welcome message (TIMEZONE-AWARE)
    async updateUserAfterWelcome(phoneNumber, userTimezone = 'America/Chicago') {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            const moment = require('moment-timezone');
            const today = moment().tz(userTimezone).format('YYYY-MM-DD');
            
            this.trackingDb.run(`
                UPDATE users 
                SET trial_messages_sent = 1,
                    total_messages_sent = 1,
                    current_sequence_position = 2,
                    last_message_sent = ?,
                    date_modified = ?
                WHERE phone_number = ?
            `, [now, now, phoneNumber], (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Update daily limits using user's timezone
                this.trackingDb.run(`
                    INSERT OR REPLACE INTO daily_limits 
                    (phone_number, date, messages_sent, last_updated)
                    VALUES (?, ?, 1, ?)
                `, [phoneNumber, today, now], (err) => {
                    if (err) reject(err);
                    else {
                        console.log(`✅ Updated user progress for ${phoneNumber} (${userTimezone} - ${today})`);
                        resolve();
                    }
                });
            });
        });
    }

    // Mark queue entry as processed
    async markQueueEntryProcessed(entryId, status = 'processed') {
        try {
            if (!this.wpConnection) {
                await this.connectToWordPress();
            }

            await this.wpConnection.execute(`
                UPDATE \`${this.wpConfig.prefix}sms_immediate_queue\`
                SET processed = 1, 
                    processed_status = ?,
                    processed_at = NOW()
                WHERE id = ?
            `, [status, entryId]);

        } catch (error) {
            this.logFunction('error', `Failed to mark queue entry ${entryId} as processed`, null, error);
        }
    }

    // Helper functions
    parseSubscriptionData(subscriptionDataString) {
        try {
            if (!subscriptionDataString) return { status: 'inactive' };
            
            const data = JSON.parse(subscriptionDataString);
            return {
                status: data.status || 'inactive',
                plan: data.plan || null,
                type: data.type || null
            };
        } catch (error) {
            return { status: 'inactive' };
        }
    }

    parseUserPreferences(subscriber) {
        return {
            mindboost_enabled: subscriber.mindboost_enabled === '1',
            pillar1_enabled: subscriber.pillar1_enabled === '1',
            pillar2_enabled: subscriber.pillar2_enabled === '1',
            pillar3_enabled: subscriber.pillar3_enabled === '1',
            pillar4_enabled: subscriber.pillar4_enabled === '1',
            pillar5_enabled: subscriber.pillar5_enabled === '1'
        };
    }

    normalizePhoneNumber(phoneNumber) {
        if (!phoneNumber) return null;
        
        // Remove all non-digits
        let normalized = phoneNumber.replace(/[^\d]/g, '');
        
        // Add country code if missing
        if (normalized.length === 10) {
            normalized = '1' + normalized;
        }
        
        // Validate US phone number
        if (normalized.length !== 11 || !normalized.startsWith('1')) {
            return null;
        }
        
        return '+' + normalized;
    }

    // Validate and normalize timezones
    validateTimezone(timezone) {
        // List of valid US timezones for HealthyText
        const validTimezones = [
            'America/New_York',      // Eastern
            'America/Chicago',       // Central  
            'America/Denver',        // Mountain
            'America/Phoenix',       // Arizona (no DST)
            'America/Los_Angeles',   // Pacific
            'America/Anchorage',     // Alaska
            'Pacific/Honolulu'       // Hawaii
        ];
        
        // If timezone is provided and valid, use it
        if (timezone && validTimezones.includes(timezone)) {
            return timezone;
        }
        
        // Try to map common timezone names
        const timezoneMap = {
            'Eastern': 'America/New_York',
            'Central': 'America/Chicago', 
            'Mountain': 'America/Denver',
            'Pacific': 'America/Los_Angeles',
            'EST': 'America/New_York',
            'CST': 'America/Chicago',
            'MST': 'America/Denver', 
            'PST': 'America/Los_Angeles',
            'EDT': 'America/New_York',
            'CDT': 'America/Chicago',
            'MDT': 'America/Denver',
            'PDT': 'America/Los_Angeles'
        };
        
        if (timezone && timezoneMap[timezone]) {
            return timezoneMap[timezone];
        }
        
        // Default to Central if no valid timezone found
        console.log(`⚠️ Invalid timezone "${timezone}", defaulting to America/Chicago`);
        return 'America/Chicago';
    }

    // Sync user to SMS system (Enhanced with better timezone handling)
    async syncUserToSMS(userData) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            
            // Validate and normalize timezone
            const userTimezone = this.validateTimezone(userData.timezone);
            
            this.trackingDb.run(`
                INSERT OR REPLACE INTO users 
                (phone_number, protocol, user_type, first_name, subscription_status, 
                 wordpress_user_id, timezone, user_preferences, date_joined, date_modified,
                 current_sequence_position, total_messages_sent, trial_messages_sent,
                 post_trial_phase, post_trial_day, milestones_achieved, last_message_sent,
                 messages_sent_today, last_daily_reset, preferred_send_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 
                    COALESCE((SELECT date_joined FROM users WHERE phone_number = ?), ?),
                    ?,
                    COALESCE((SELECT current_sequence_position FROM users WHERE phone_number = ?), 1),
                    COALESCE((SELECT total_messages_sent FROM users WHERE phone_number = ?), 0),
                    COALESCE((SELECT trial_messages_sent FROM users WHERE phone_number = ?), 0),
                    COALESCE((SELECT post_trial_phase FROM users WHERE phone_number = ?), 1),
                    COALESCE((SELECT post_trial_day FROM users WHERE phone_number = ?), 0),
                    COALESCE((SELECT milestones_achieved FROM users WHERE phone_number = ?), ''),
                    (SELECT last_message_sent FROM users WHERE phone_number = ?),
                    COALESCE((SELECT messages_sent_today FROM users WHERE phone_number = ?), 0),
                    COALESCE((SELECT last_daily_reset FROM users WHERE phone_number = ?), CURRENT_DATE),
                    COALESCE((SELECT preferred_send_time FROM users WHERE phone_number = ?), '14:00-17:00'))
            `, [
                userData.phoneNumber,
                userData.protocol,
                userData.userType,
                userData.firstName,
                userData.subscriptionStatus,
                userData.wordpressUserId,
                userTimezone, // Use validated timezone
                JSON.stringify(userData.preferences),
                userData.phoneNumber, now,  // date_joined
                now,  // date_modified
                userData.phoneNumber,  // current_sequence_position
                userData.phoneNumber,  // total_messages_sent
                userData.phoneNumber,  // trial_messages_sent
                userData.phoneNumber,  // post_trial_phase
                userData.phoneNumber,  // post_trial_day
                userData.phoneNumber,  // milestones_achieved
                userData.phoneNumber,  // last_message_sent
                userData.phoneNumber,  // messages_sent_today
                userData.phoneNumber,  // last_daily_reset
                userData.phoneNumber   // preferred_send_time
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(`✅ Synced user ${userData.firstName} with timezone: ${userTimezone}`);
                    resolve({ phoneNumber: userData.phoneNumber, synced: true, timezone: userTimezone });
                }
            });
        });
    }

    // Get user from SMS system
    async getUserFromSMS(phoneNumber) {
        return new Promise((resolve, reject) => {
            this.trackingDb.get('SELECT * FROM users WHERE phone_number = ?', [phoneNumber], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // Utility delay function
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Close connections
    async close() {
        if (this.wpConnection) {
            await this.wpConnection.end();
        }
        if (this.trackingDb) {
            this.trackingDb.close();
        }
    }
}

module.exports = WordPressSync;