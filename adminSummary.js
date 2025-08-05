const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const moment = require('moment-timezone');

class AdminSummary {
    constructor(options) {
        this.trackingDbPath = options.trackingDbPath;
        this.logsDbPath = options.logsDbPath;
        this.sendMessageFunction = options.sendMessageFunction;
        this.logFunction = options.logFunction;
        this.adminPhone = '+13122858457'; // Admin phone number
        this.adminTimezone = 'America/Phoenix'; // Phoenix timezone
        
        this.trackingDb = new sqlite3.Database(this.trackingDbPath);
        this.logsDb = new sqlite3.Database(this.logsDbPath);
        this.cronJob = null;
        
        console.log('📊 Admin Summary initialized - daily reports at 8:30 PM Phoenix time');
    }

    // Get daily message count
    async getDailyMessageCount() {
        return new Promise((resolve, reject) => {
            const today = moment().tz(this.adminTimezone).format('YYYY-MM-DD');
            
            this.trackingDb.get(`
                SELECT COUNT(*) as total_sent
                FROM message_history 
                WHERE DATE(sent_timestamp) = ?
                AND delivery_status IN ('sent', 'delivered')
            `, [today], (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.total_sent : 0);
            });
        });
    }

    // Get new user signups today
    async getDailySignups() {
        return new Promise((resolve, reject) => {
            const today = moment().tz(this.adminTimezone).format('YYYY-MM-DD');
            
            this.trackingDb.all(`
                SELECT 
                    user_type,
                    COUNT(*) as count
                FROM users 
                WHERE DATE(date_joined) = ?
                GROUP BY user_type
            `, [today], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const signups = {
                        trial: 0,
                        subscriber: 0,
                        total: 0
                    };
                    
                    rows.forEach(row => {
                        signups[row.user_type] = row.count;
                        signups.total += row.count;
                    });
                    
                    resolve(signups);
                }
            });
        });
    }

    // Check system status
    async getSystemStatus() {
        // This will be populated from the main app
        return {
            messageScheduler: this.messageSchedulerRunning || false,
            immediateQueue: this.immediateQueueRunning || false,
            wordpressSync: this.wordpressSyncRunning || false
        };
    }

    // Get daily error count
    async getDailyErrors() {
        return new Promise((resolve, reject) => {
            const today = moment().tz(this.adminTimezone).format('YYYY-MM-DD');
            
            this.logsDb.all(`
                SELECT 
                    log_type,
                    COUNT(*) as count
                FROM system_logs 
                WHERE DATE(timestamp) = ?
                AND log_type IN ('error', 'warning')
                GROUP BY log_type
            `, [today], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const errors = {
                        error: 0,
                        warning: 0,
                        total: 0
                    };
                    
                    rows.forEach(row => {
                        errors[row.log_type] = row.count;
                        errors.total += row.count;
                    });
                    
                    resolve(errors);
                }
            });
        });
    }

    // Generate daily summary message
    async generateSummaryMessage() {
        try {
            const [messageCount, signups, systemStatus, errors] = await Promise.all([
                this.getDailyMessageCount(),
                this.getDailySignups(),
                this.getSystemStatus(),
                this.getDailyErrors()
            ]);

            const phoenixTime = moment().tz(this.adminTimezone);
            const dateStr = phoenixTime.format('MMM DD, YYYY');
            
            let message = `HealthyText Daily Summary ${dateStr}:\n`;
            
            // Daily message count
            message += `${messageCount} messages sent\n`;
            
            // New signups
            if (signups.total > 0) {
                message += `${signups.total} new signups (${signups.trial} trial, ${signups.subscriber} paid)\n`;
            } else {
                message += `0 new signups\n`;
            }
            
            // System status - only report if something is down
            const downSystems = [];
            if (!systemStatus.messageScheduler) downSystems.push('Scheduler');
            if (!systemStatus.immediateQueue) downSystems.push('Queue');
            if (!systemStatus.wordpressSync) downSystems.push('Sync');
            
            if (downSystems.length > 0) {
                message += `ALERT: ${downSystems.join(', ')} down\n`;
            } else {
                message += `All systems running\n`;
            }
            
            // Error alerts
            if (errors.total > 0) {
                message += `${errors.error} errors, ${errors.warning} warnings today`;
            } else {
                message += `No errors today`;
            }
            
            return message;
            
        } catch (error) {
            this.logFunction('error', 'Failed to generate admin summary', this.adminPhone, error);
            return `❌ HealthyText Daily Summary - ${moment().tz(this.adminTimezone).format('MMM DD, YYYY')}\n\nError generating report. Check system logs.`;
        }
    }

    // Send daily summary
    async sendDailySummary() {
        try {
            console.log('📊 Generating daily admin summary...');
            this.logFunction('info', 'Generating daily admin summary');
            
            const summaryMessage = await this.generateSummaryMessage();
            
            console.log('📤 Sending admin summary to', this.adminPhone);
            const result = await this.sendMessageFunction(this.adminPhone, summaryMessage, 'admin_daily_summary');
            
            if (result.success) {
                console.log('✅ Admin summary sent successfully');
                this.logFunction('info', 'Daily admin summary sent successfully', this.adminPhone);
            } else {
                console.error('❌ Failed to send admin summary:', result.error);
                this.logFunction('error', 'Failed to send daily admin summary', this.adminPhone, result.error);
            }
            
            return result;
            
        } catch (error) {
            console.error('❌ Admin summary error:', error);
            this.logFunction('error', 'Admin summary system error', this.adminPhone, error);
            return { success: false, error: error.message };
        }
    }

    // Start the daily summary scheduler
    start() {
        if (this.cronJob) {
            this.cronJob.destroy();
        }

        // Schedule for 8:30 PM Phoenix time daily
        // Using 'America/Phoenix' timezone in cron (cron-node supports timezones)
        this.cronJob = cron.schedule('30 20 * * *', async () => {
            await this.sendDailySummary();
        }, {
            scheduled: true,
            timezone: 'America/Phoenix'
        });

        const phoenixTime = moment().tz(this.adminTimezone);
        console.log(`📊 Admin summary scheduled for 8:30 PM daily (Phoenix time)`);
        console.log(`📅 Current Phoenix time: ${phoenixTime.format('dddd, MMM DD h:mm A z')}`);
        this.logFunction('info', 'Admin daily summary scheduler started');
    }

    // Stop the scheduler
    stop() {
        if (this.cronJob) {
            this.cronJob.destroy();
            this.cronJob = null;
            console.log('🛑 Admin summary scheduler stopped');
            this.logFunction('info', 'Admin daily summary scheduler stopped');
        }
    }

    // Update system status from main app
    updateSystemStatus(status) {
        this.messageSchedulerRunning = status.messageScheduler;
        this.immediateQueueRunning = status.immediateQueue;
        this.wordpressSyncRunning = status.wordpressSync;
    }

    // Manual trigger for testing
    async sendTestSummary() {
        console.log('🧪 Sending test admin summary...');
        return await this.sendDailySummary();
    }

    // Close database connections
    close() {
        if (this.cronJob) {
            this.cronJob.destroy();
        }
        if (this.trackingDb) {
            this.trackingDb.close();
        }
        if (this.logsDb) {
            this.logsDb.close();
        }
    }
}

module.exports = AdminSummary;