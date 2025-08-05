const sqlite3 = require('sqlite3').verbose();

class MessageInjector {
    constructor(options) {
        this.trackingDbPath = options.trackingDbPath;
        this.messagesDbPath = options.messagesDbPath;
        this.sendMessageFunction = options.sendMessageFunction;
        this.logFunction = options.logFunction;
        
        this.trackingDb = new sqlite3.Database(this.trackingDbPath);
        this.messagesDb = new sqlite3.Database(this.messagesDbPath);
        
        console.log('💉 Message Injector initialized');
    }

    // Create and send a priority message to all active users
    async injectMessage(messageData) {
        try {
            const { message, messageId, priority = 1, protocol = 'ALL' } = messageData;
            
            if (!message || !messageId) {
                throw new Error('Message content and messageId are required');
            }

            this.logFunction('info', `Starting message injection: ${messageId} (${protocol})`);

            // 1. Add message to messages database
            await this.addMessageToDatabase(messageId, message, protocol);

            // 2. Get active users (filtered by protocol if specified)
            const activeUsers = await this.getActiveUsers(protocol);
            this.logFunction('info', `Found ${activeUsers.length} active users for injection (${protocol})`);

            // 3. Queue message for all users
            const queuedCount = await this.queueMessageForUsers(activeUsers, messageId, priority);
            this.logFunction('info', `Queued message for ${queuedCount} users`);

            // 4. Process the queue immediately
            const sentResults = await this.processInjectionQueue();

            return {
                success: true,
                messageId,
                protocol,
                usersFound: activeUsers.length,
                usersQueued: queuedCount,
                messagesSent: sentResults.sent,
                messagesSkipped: sentResults.skipped,
                errors: sentResults.errors
            };

        } catch (error) {
            this.logFunction('error', `Message injection failed: ${error.message}`, null, error);
            throw error;
        }
    }

    // Add message to messages database
    async addMessageToDatabase(messageId, messageText, protocol) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            
            this.messagesDb.run(`
                INSERT OR REPLACE INTO messages 
                (id, number, protocol, pillar, category, message_type, message, tags, link, notes, active, date_created, date_modified)
                VALUES (?, NULL, ?, 'System', 'Manual', 'manual', ?, 'manual_injection|priority', NULL, 'Manually injected message', 1, ?, ?)
            `, [messageId, protocol, messageText, now, now], function(err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(`✓ Message added to database: ${messageId}`);
                    resolve({ messageId, added: true });
                }
            });
        });
    }

    // Get all active users (with optional protocol filter)
    async getActiveUsers(protocol = 'ALL') {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT phone_number, first_name, user_type, protocol, timezone 
                FROM users 
                WHERE subscription_status NOT IN ('stopped', 'expired')
            `;
            let params = [];

            if (protocol && protocol !== 'ALL') {
                query += ` AND protocol = ?`;
                params.push(protocol);
            }

            query += ` ORDER BY date_joined ASC`;

            this.trackingDb.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Queue message for all users
    async queueMessageForUsers(users, messageId, priority) {
        let queuedCount = 0;
        const now = new Date().toISOString();

        for (const user of users) {
            try {
                await new Promise((resolve, reject) => {
                    this.trackingDb.run(`
                        INSERT INTO pending_messages 
                        (phone_number, message_id, priority, scheduled_time, is_manual_injection, created_timestamp, status)
                        VALUES (?, ?, ?, ?, 1, ?, 'pending')
                    `, [user.phone_number, messageId, priority, now, now], function(err) {
                        if (err) reject(err);
                        else {
                            queuedCount++;
                            resolve();
                        }
                    });
                });
            } catch (error) {
                this.logFunction('error', `Failed to queue message for ${user.phone_number}`, user.phone_number, error);
            }
        }

        return queuedCount;
    }

    // Process the injection queue immediately
    async processInjectionQueue() {
        const results = { sent: 0, skipped: 0, errors: [] };

        try {
            // Get all pending manual injections
            const pendingMessages = await this.getPendingInjections();
            console.log(`📤 Processing ${pendingMessages.length} queued injections...`);

            for (const pendingMessage of pendingMessages) {
                try {
                    const result = await this.processSingleInjection(pendingMessage);
                    
                    if (result.sent) {
                        results.sent++;
                        console.log(`✅ Sent to ${pendingMessage.phone_number}`);
                    } else {
                        results.skipped++;
                        console.log(`⏭️ Skipped ${pendingMessage.phone_number}: ${result.reason}`);
                    }

                    // Mark as processed
                    await this.markInjectionProcessed(pendingMessage.id, result.sent ? 'sent' : 'skipped');

                } catch (error) {
                    results.errors.push({
                        phoneNumber: pendingMessage.phone_number,
                        error: error.message
                    });
                    console.error(`❌ Error sending to ${pendingMessage.phone_number}:`, error.message);
                    
                    // Mark as failed
                    await this.markInjectionProcessed(pendingMessage.id, 'failed');
                }

                // Small delay between sends
                await this.delay(500);
            }

            console.log(`📊 Injection complete: ${results.sent} sent, ${results.skipped} skipped, ${results.errors.length} errors`);

        } catch (error) {
            this.logFunction('error', 'Error processing injection queue', null, error);
            throw error;
        }

        return results;
    }

    // Get pending manual injections
    async getPendingInjections() {
        return new Promise((resolve, reject) => {
            this.trackingDb.all(`
                SELECT pm.*, u.first_name, u.timezone, u.user_type
                FROM pending_messages pm
                JOIN users u ON pm.phone_number = u.phone_number
                WHERE pm.status = 'pending' AND pm.is_manual_injection = 1
                ORDER BY pm.priority ASC, pm.created_timestamp ASC
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Process a single injection
    async processSingleInjection(pendingMessage) {
        // Check daily limit
        const dailyCheck = await this.checkDailyLimit(pendingMessage.phone_number);
        if (dailyCheck.messagesSentToday >= 4) {
            return { sent: false, reason: 'Daily limit reached (4 messages)' };
        }

        // Check time window (manual injections respect time windows but not day restrictions)
        const timeCheck = this.isInSendingWindow(pendingMessage.timezone);
        if (!timeCheck.canSend) {
            return { sent: false, reason: timeCheck.reason };
        }

        // Get the message
        const message = await this.getMessage(pendingMessage.message_id);
        if (!message) {
            return { sent: false, reason: 'Message not found in database' };
        }

        // Personalize and send
        const personalizedMessage = this.personalizeMessage(message.message, pendingMessage.first_name);
        const sendResult = await this.sendMessageFunction(pendingMessage.phone_number, personalizedMessage, pendingMessage.message_id);

        if (!sendResult.success) {
            return { sent: false, reason: `Send failed: ${sendResult.error}` };
        }

        // Update user progress (but don't advance sequence for manual injections)
        await this.updateUserAfterInjection(pendingMessage.phone_number);

        return { sent: true };
    }

    // Check daily message limit
    async checkDailyLimit(phoneNumber) {
        return new Promise((resolve, reject) => {
            const today = new Date().toISOString().split('T')[0];
            
            this.trackingDb.get(`
                SELECT messages_sent FROM daily_limits 
                WHERE phone_number = ? AND date = ?
            `, [phoneNumber, today], (err, row) => {
                if (err) reject(err);
                else resolve({ messagesSentToday: row ? row.messages_sent : 0 });
            });
        });
    }

    // Check if within sending time window
    isInSendingWindow(userTimezone = 'America/Chicago') {
        const moment = require('moment-timezone');
        const userTime = moment().tz(userTimezone);
        const hour = userTime.hour();
        
        // Manual injections respect 9 AM - 6 PM window but ignore Sunday restriction
        if (hour < 9 || hour >= 18) {
            return { canSend: false, reason: 'Outside sending hours (9 AM - 6 PM)' };
        }
        
        return { canSend: true };
    }

    // Get message from database
    async getMessage(messageId) {
        return new Promise((resolve, reject) => {
            this.messagesDb.get('SELECT * FROM messages WHERE id = ? AND active = 1', [messageId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // Update user after injection (increment total count, update daily limits)
    async updateUserAfterInjection(phoneNumber) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            const today = new Date().toISOString().split('T')[0];
            
            // Update user total count
            this.trackingDb.run(`
                UPDATE users 
                SET total_messages_sent = total_messages_sent + 1,
                    last_message_sent = ?,
                    date_modified = ?
                WHERE phone_number = ?
            `, [now, now, phoneNumber], (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Update daily limits
                this.trackingDb.run(`
                    INSERT OR REPLACE INTO daily_limits 
                    (phone_number, date, messages_sent, last_updated)
                    VALUES (?, ?, COALESCE((SELECT messages_sent FROM daily_limits WHERE phone_number = ? AND date = ?), 0) + 1, ?)
                `, [phoneNumber, today, phoneNumber, today, now], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    // Mark injection as processed
    async markInjectionProcessed(injectionId, status) {
        return new Promise((resolve, reject) => {
            this.trackingDb.run(`
                UPDATE pending_messages 
                SET status = ? 
                WHERE id = ?
            `, [status, injectionId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    // Get injection history/status (with optional program filter)
    async getInjectionHistory(limit = 10, program = null) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT 
                    pm.message_id,
                    m.protocol,
                    COUNT(*) as total_recipients,
                    SUM(CASE WHEN pm.status = 'sent' THEN 1 ELSE 0 END) as sent_count,
                    SUM(CASE WHEN pm.status = 'skipped' THEN 1 ELSE 0 END) as skipped_count,
                    SUM(CASE WHEN pm.status = 'failed' THEN 1 ELSE 0 END) as failed_count,
                    MIN(pm.created_timestamp) as injection_time
                FROM pending_messages pm
                LEFT JOIN messages m ON pm.message_id = m.id
                WHERE pm.is_manual_injection = 1
            `;
            
            let params = [];
            
            if (program && program !== 'ALL') {
                query += ` AND (m.protocol = ? OR m.protocol = 'ALL')`;
                params.push(program);
            }
            
            query += `
                GROUP BY pm.message_id, m.protocol
                ORDER BY injection_time DESC
                LIMIT ?
            `;
            params.push(limit);

            this.trackingDb.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Clean up old processed injections (older than 30 days)
    async cleanupOldInjections() {
        return new Promise((resolve, reject) => {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const cutoffDate = thirtyDaysAgo.toISOString();

            this.trackingDb.run(`
                DELETE FROM pending_messages 
                WHERE is_manual_injection = 1 
                AND status IN ('sent', 'skipped', 'failed')
                AND created_timestamp < ?
            `, [cutoffDate], function(err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(`🧹 Cleaned up ${this.changes} old injection records`);
                    resolve(this.changes);
                }
            });
        });
    }

    // Utility functions
    personalizeMessage(messageText, firstName) {
        if (!messageText) return '';
        
        if (firstName) {
            return messageText.replace(/\{name\}/g, firstName);
        } else {
            return messageText.replace(/\{name\}[,\s]*/g, '').replace(/\s+/g, ' ').trim();
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Close database connections
    close() {
        if (this.trackingDb) this.trackingDb.close();
        if (this.messagesDb) this.messagesDb.close();
    }
}

module.exports = MessageInjector;