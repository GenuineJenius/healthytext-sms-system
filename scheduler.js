const cron = require('node-cron');
const moment = require('moment-timezone');
const sqlite3 = require('sqlite3').verbose();

class MessageScheduler {
    constructor(options) {
        this.trackingDbPath = options.trackingDbPath;
        this.messagesDbPath = options.messagesDbPath;
        this.sendMessageFunction = options.sendMessageFunction;
        this.logFunction = options.logFunction;
        
        this.trackingDb = new sqlite3.Database(this.trackingDbPath);
        this.messagesDb = new sqlite3.Database(this.messagesDbPath);
        
        this.isRunning = false;
        this.cronJob = null;
        
        console.log('📅 Message Scheduler initialized (Timezone-Aware)');
    }

    // Start the scheduler - checks every 30 minutes
    start() {
        if (this.isRunning) {
            console.log('⚠️ Scheduler already running');
            return;
        }

        // Run every 30 minutes during active hours (8 AM - 7 PM Central)
        this.cronJob = cron.schedule('*/30 8-19 * * *', () => {
            this.processMessageQueue();
        }, {
            scheduled: true,
            timezone: "America/Chicago"
        });

        this.isRunning = true;
        console.log('✅ Message Scheduler started - checking every 30 minutes during 8 AM - 7 PM (timezone-aware)');
        this.logFunction('info', 'Message Scheduler started with timezone awareness');

        // Run initial check after 10 seconds
        setTimeout(() => this.processMessageQueue(), 10000);
    }

    // Stop the scheduler
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
        }
        this.isRunning = false;
        console.log('🛑 Message Scheduler stopped');
        this.logFunction('info', 'Message Scheduler stopped');
    }

    // Main processing function - checks all users
    async processMessageQueue() {
        try {
            console.log('\n🔄 Checking users for scheduled messages (timezone-aware)...');
            this.logFunction('info', 'Starting timezone-aware scheduled message check');

            const users = await this.getEligibleUsers();
            console.log(`📋 Found ${users.length} users to check`);

            let messagesSent = 0;
            let usersChecked = 0;

            for (const user of users) {
                try {
                    const result = await this.checkUserForMessage(user);
                    usersChecked++;
                    
                    if (result.sent) {
                        messagesSent++;
                        console.log(`✅ Sent to ${user.first_name || 'User'} (${user.phone_number}) at ${result.userTime}: ${result.message}`);
                    } else if (result.reason !== 'Not due for message yet') {
                        console.log(`⏭️ Skipped ${user.phone_number}: ${result.reason}`);
                    }
                } catch (error) {
                    console.error(`❌ Error processing ${user.phone_number}:`, error.message);
                    this.logFunction('error', `Error processing user ${user.phone_number}`, user.phone_number, error);
                }

                // Small delay between users
                await this.delay(200);
            }

            console.log(`✅ Check complete: ${usersChecked} users checked, ${messagesSent} messages sent`);
            this.logFunction('info', `Timezone-aware check complete: ${usersChecked} users checked, ${messagesSent} messages sent`);

        } catch (error) {
            console.error('❌ Error in scheduled message check:', error);
            this.logFunction('error', 'Scheduled message check failed', null, error);
        }
    }

    // Get all users who aren't stopped
    async getEligibleUsers() {
        return new Promise((resolve, reject) => {
            this.trackingDb.all(`
                SELECT * FROM users 
                WHERE subscription_status NOT IN ('stopped', 'expired')
                ORDER BY date_joined ASC
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Check if a specific user should receive a message today (TIMEZONE-AWARE)
    async checkUserForMessage(user) {
        // 1. Get user's local time using their timezone
        const userTime = moment().tz(user.timezone || 'America/Chicago');
        const userHour = userTime.hour();
        const userDay = userTime.day(); // 0 = Sunday
        
        console.log(`🕐 Checking ${user.first_name} (${user.phone_number}): ${userTime.format('dddd, h:mm A z')}`);
        
        // 2. Check if it's Sunday (no messages on Sunday)
        if (userDay === 0) {
            return { sent: false, reason: `Sunday rest day in ${user.timezone}` };
        }

        // 3. Check if it's within sending hours (9 AM - 6 PM in user's timezone)
        if (userHour < 9 || userHour >= 18) {
            return { sent: false, reason: `Outside sending hours in ${user.timezone} (${userTime.format('h:mm A')})` };
        }

        // 4. Check daily limit (max 4 messages per day)
        const dailyCheck = await this.checkDailyLimit(user.phone_number);
        if (dailyCheck.messagesSentToday >= 4) {
            return { sent: false, reason: 'Daily limit reached (4 messages)' };
        }

        // 5. Check if user is due for their next message
        const isDue = await this.isUserDueForMessage(user);
        if (!isDue.due) {
            return { sent: false, reason: isDue.reason };
        }

        // 6. Get the appropriate message
        const message = await this.getNextMessage(user, isDue.messageType, isDue.position);
        if (!message) {
            return { sent: false, reason: 'No message found for user position' };
        }

        // 7. Send the message
        const personalizedMessage = this.personalizeMessage(message.message, user.first_name);
        const sendResult = await this.sendMessageFunction(user.phone_number, personalizedMessage, message.id);
        
        if (!sendResult.success) {
            return { sent: false, reason: `Send failed: ${sendResult.error}` };
        }

        // 8. Update user progress
        await this.updateUserProgress(user, isDue, message.id);

        return { 
            sent: true, 
            message: personalizedMessage.substring(0, 50) + '...',
            messageId: message.id,
            userTimezone: user.timezone,
            userTime: userTime.format('h:mm A z')
        };
    }

    // Check if user is due for their next message (Enhanced with timezone-aware date calculations)
    async isUserDueForMessage(user) {
        // Use user's timezone for all date calculations
        const userTimezone = user.timezone || 'America/Chicago';
        const now = moment().tz(userTimezone);
        
        const lastMessageDate = user.last_message_sent ? 
            moment(user.last_message_sent).tz(userTimezone) : 
            moment(user.date_joined).tz(userTimezone);
        
        const daysSinceLastMessage = now.diff(lastMessageDate, 'days');
        const daysSinceJoined = now.diff(moment(user.date_joined).tz(userTimezone), 'days');

        console.log(`📅 ${user.first_name}: Last message ${daysSinceLastMessage} days ago, joined ${daysSinceJoined} days ago (${userTimezone})`);

        // Trial users (7 messages total)
        if (user.user_type === 'trial') {
            if (user.trial_messages_sent >= 7) {
                // Check post-trial schedule
                return this.checkPostTrialSchedule(user, daysSinceJoined);
            }
            
            // Send trial messages roughly every 1-2 days
            if (daysSinceLastMessage >= 1) {
                return { 
                    due: true, 
                    messageType: 'trial', 
                    position: user.trial_messages_sent + 1 
                };
            }
        }
        
        // Subscriber users (30+ messages)
        else if (user.user_type === 'subscriber') {
            if (user.current_sequence_position <= 30) {
                // Send sequence messages roughly every 1-2 days
                if (daysSinceLastMessage >= 1) {
                    return { 
                        due: true, 
                        messageType: 'sequence', 
                        position: user.current_sequence_position 
                    };
                }
            } else {
                // Algorithm mode - send every 2-3 days
                if (daysSinceLastMessage >= 2) {
                    return { 
                        due: true, 
                        messageType: 'algorithm', 
                        position: null 
                    };
                }
            }
        }

        return { due: false, reason: 'Not due for message yet' };
    }

    // Check post-trial message schedule
    checkPostTrialSchedule(user, daysSinceJoined) {
        // Phase 1: Days 8, 10, 13, 17
        const phase1Days = [8, 10, 13, 17];
        if (phase1Days.includes(daysSinceJoined)) {
            const messageOrder = phase1Days.indexOf(daysSinceJoined) + 1;
            return { 
                due: true, 
                messageType: 'post-trial-phase1', 
                messageId: `ptmb${messageOrder}` 
            };
        }
        
        // Phase 2: Days 25, 33, 41
        if ([25, 33, 41].includes(daysSinceJoined)) {
            return { due: true, messageType: 'post-trial-phase2' };
        }
        
        // Phase 3: Days 71, 101, 131
        if ([71, 101, 131].includes(daysSinceJoined)) {
            return { due: true, messageType: 'post-trial-phase3' };
        }
        
        // Phase 4: Day 191 and every 60 days after
        if (daysSinceJoined >= 191 && (daysSinceJoined - 191) % 60 === 0) {
            return { due: true, messageType: 'post-trial-phase4' };
        }
        
        return { due: false, reason: 'Not scheduled for post-trial message today' };
    }

    // Get the next message for a user
    async getNextMessage(user, messageType, position) {
        return new Promise((resolve, reject) => {
            let query, params;

            switch (messageType) {
                case 'trial':
                case 'sequence':
                    query = `SELECT * FROM messages WHERE number = ? AND protocol = ? AND active = 1 LIMIT 1`;
                    params = [position, user.protocol];
                    break;
                    
                case 'algorithm':
                    query = `SELECT * FROM messages WHERE number IS NULL AND protocol = ? AND active = 1 ORDER BY RANDOM() LIMIT 1`;
                    params = [user.protocol];
                    break;
                    
                case 'post-trial-phase1':
                    query = `SELECT * FROM messages WHERE id = ? AND active = 1`;
                    params = [position.messageId];
                    break;
                    
                default:
                    query = `SELECT * FROM messages WHERE category = 'Post-Trial' AND active = 1 ORDER BY RANDOM() LIMIT 1`;
                    params = [];
            }

            this.messagesDb.get(query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // Check daily message limit (Enhanced with timezone-aware date)
    async checkDailyLimit(phoneNumber) {
        return new Promise((resolve, reject) => {
            // Get user's timezone first
            this.trackingDb.get('SELECT timezone FROM users WHERE phone_number = ?', [phoneNumber], (err, userRow) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const userTimezone = userRow?.timezone || 'America/Chicago';
                const today = moment().tz(userTimezone).format('YYYY-MM-DD');
                
                this.trackingDb.get(`
                    SELECT messages_sent FROM daily_limits 
                    WHERE phone_number = ? AND date = ?
                `, [phoneNumber, today], (err, row) => {
                    if (err) reject(err);
                    else resolve({ 
                        messagesSentToday: row ? row.messages_sent : 0,
                        userTimezone: userTimezone,
                        localDate: today
                    });
                });
            });
        });
    }

    // Update user progress after sending message (Enhanced with timezone-aware daily limits)
    async updateUserProgress(user, messageInfo, messageId) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            
            // Use user's timezone for daily limit tracking
            const userTimezone = user.timezone || 'America/Chicago';
            const today = moment().tz(userTimezone).format('YYYY-MM-DD');
            
            // Update user record
            let updateQuery = `
                UPDATE users 
                SET total_messages_sent = total_messages_sent + 1,
                    last_message_sent = ?,
                    date_modified = ?
            `;
            let updateParams = [now, now];

            // Update sequence position or trial count
            if (messageInfo.messageType === 'trial') {
                updateQuery += `, trial_messages_sent = trial_messages_sent + 1`;
            } else if (messageInfo.messageType === 'sequence') {
                updateQuery += `, current_sequence_position = current_sequence_position + 1`;
            }

            updateQuery += ` WHERE phone_number = ?`;
            updateParams.push(user.phone_number);

            this.trackingDb.run(updateQuery, updateParams, (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Update daily limits using user's timezone
                this.trackingDb.run(`
                    INSERT OR REPLACE INTO daily_limits 
                    (phone_number, date, messages_sent, last_updated)
                    VALUES (?, ?, COALESCE((SELECT messages_sent FROM daily_limits WHERE phone_number = ? AND date = ?), 0) + 1, ?)
                `, [user.phone_number, today, user.phone_number, today, now], (err) => {
                    if (err) reject(err);
                    else {
                        console.log(`✅ Updated progress for ${user.first_name} (${userTimezone} - ${today})`);
                        resolve();
                    }
                });
            });
        });
    }

    // Personalize message with user's name
    personalizeMessage(messageText, firstName) {
        if (!messageText) return '';
        
        if (firstName) {
            return messageText.replace(/\{name\}/g, firstName);
        } else {
            return messageText.replace(/\{name\}[,\s]*/g, '').replace(/\s+/g, ' ').trim();
        }
    }

    // Utility delay function
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Close database connections
    close() {
        if (this.trackingDb) this.trackingDb.close();
        if (this.messagesDb) this.messagesDb.close();
    }
}

module.exports = MessageScheduler;