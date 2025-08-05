const sqlite3 = require('sqlite3').verbose();

class ResponseHandler {
    constructor(options) {
        this.trackingDbPath = options.trackingDbPath;
        this.messagesDbPath = options.messagesDbPath;
        this.sendMessageFunction = options.sendMessageFunction;
        this.logFunction = options.logFunction;
        
        this.trackingDb = new sqlite3.Database(this.trackingDbPath);
        this.messagesDb = new sqlite3.Database(this.messagesDbPath);
        
        console.log('📨 Response Handler initialized');
    }

    // Main function to process incoming messages
    async processIncomingMessage(phoneNumber, messageBody) {
        try {
            const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
            const cleanMessage = messageBody.trim().toUpperCase();
            
            this.logFunction('info', `Received message from ${normalizedPhone}: ${messageBody}`);

            // Check for system commands first
            const commandResult = await this.handleSystemCommands(normalizedPhone, cleanMessage);
            if (commandResult.handled) {
                return commandResult;
            }

            // Check for crisis support keywords
            const crisisResult = await this.handleCrisisKeywords(normalizedPhone, cleanMessage);
            if (crisisResult.handled) {
                return crisisResult;
            }

            // Check for interactive message responses
            const interactiveResult = await this.handleInteractiveResponse(normalizedPhone, cleanMessage);
            if (interactiveResult.handled) {
                return interactiveResult;
            }

            // Default response for unrecognized messages
            return await this.handleUnrecognizedMessage(normalizedPhone, messageBody);

        } catch (error) {
            this.logFunction('error', `Error processing message from ${phoneNumber}`, phoneNumber, error);
            return { handled: false, error: error.message };
        }
    }

    // Handle system commands (STOP, START, RESET)
    async handleSystemCommands(phoneNumber, message) {
        const user = await this.getUser(phoneNumber);
        
        switch (message) {
            case 'STOP':
                await this.stopUser(phoneNumber);
                await this.sendSystemMessage(phoneNumber, '34453cds'); // Stop confirmation
                return { 
                    handled: true, 
                    action: 'stopped',
                    message: 'User stopped successfully' 
                };

            case 'START':
                await this.startUser(phoneNumber);
                await this.sendSystemMessage(phoneNumber, '3452cds3'); // Start confirmation
                return { 
                    handled: true, 
                    action: 'started',
                    message: 'User restarted successfully' 
                };

            case 'RESET':
                if (!user || user.user_type !== 'subscriber') {
                    await this.sendMessageFunction(
                        phoneNumber, 
                        'RESET is only available for subscribers. Upgrade at healthytext.com to access this feature!',
                        'reset_denied'
                    );
                    return { 
                        handled: true, 
                        action: 'reset_denied',
                        message: 'Reset denied - trial user' 
                    };
                }
                await this.resetUser(phoneNumber);
                await this.sendMessageFunction(
                    phoneNumber,
                    `Welcome back ${user.first_name || ''}! Your Elevate sequence has been reset to message 1. Ready for a fresh start!`,
                    'reset_confirm'
                );
                return { 
                    handled: true, 
                    action: 'reset',
                    message: 'User sequence reset successfully' 
                };

            default:
                return { handled: false };
        }
    }

    // Handle crisis support keywords
    async handleCrisisKeywords(phoneNumber, message) {
        const crisisKeywords = {
            'HELP': 'help_response',
            'ANXIETY': 'anxiety_response', 
            'STRESS': 'stress_response',
            'PANIC': 'panic_response',
            'CRISIS': 'crisis_response',
            'POSITIVE': 'positive_response',
            'AFFIRM': 'positive_response',
            'BREATHE': 'breathe_response',
            'CALM': 'calm_response'
        };

        if (crisisKeywords[message]) {
            const responseMessageId = crisisKeywords[message];
            
            // Try to get specific crisis response message
            const crisisMessage = await this.getMessage(responseMessageId);
            
            if (crisisMessage) {
                const user = await this.getUser(phoneNumber);
                const personalizedMessage = this.personalizeMessage(crisisMessage.message, user?.first_name);
                await this.sendMessageFunction(phoneNumber, personalizedMessage, responseMessageId);
            } else {
                // Fallback crisis responses
                await this.sendFallbackCrisisResponse(phoneNumber, message);
            }

            // Log crisis keyword usage for monitoring
            this.logFunction('info', `Crisis keyword used: ${message}`, phoneNumber, { keyword: message });
            
            return { 
                handled: true, 
                action: 'crisis_support',
                message: `Crisis keyword "${message}" handled` 
            };
        }

        return { handled: false };
    }

    // Handle interactive message responses (A/B/C/D)
    async handleInteractiveResponse(phoneNumber, response) {
        const user = await this.getUser(phoneNumber);
        if (!user || !user.awaiting_response) {
            return { handled: false };
        }

        // Check if user is still within response window (24 hours)
        const responseWindow = new Date(user.awaiting_response_since);
        responseWindow.setHours(responseWindow.getHours() + 24);
        
        if (new Date() > responseWindow) {
            // Clear expired response state
            await this.clearAwaitingResponse(phoneNumber);
            return { handled: false };
        }

        // Get the original interactive message
        const originalMessage = await this.getMessage(user.awaiting_response);
        if (!originalMessage) {
            await this.clearAwaitingResponse(phoneNumber);
            return { handled: false };
        }

        // Extract valid options from original message
        const validOptions = this.extractResponseOptions(originalMessage.message);
        
        if (validOptions.length === 0) {
            await this.clearAwaitingResponse(phoneNumber);
            return { handled: false };
        }

        // Validate user response
        if (!validOptions.includes(response)) {
            // Send help message with valid options
            const optionsText = validOptions.join(' or ');
            await this.sendMessageFunction(
                phoneNumber,
                `Please respond with ${optionsText} only. What's your choice?`,
                'invalid_response'
            );
            return { 
                handled: true, 
                action: 'invalid_response',
                message: `Invalid response "${response}" - valid options: ${optionsText}` 
            };
        }

        // Send follow-up message
        const followUpId = user.awaiting_response + response.toLowerCase();
        const followUpMessage = await this.getMessage(followUpId);
        
        if (followUpMessage) {
            const personalizedFollowUp = this.personalizeMessage(followUpMessage.message, user.first_name);
            await this.sendMessageFunction(phoneNumber, personalizedFollowUp, followUpId);
        } else {
            // Generic positive response if no specific follow-up exists
            await this.sendMessageFunction(
                phoneNumber,
                `Thanks for your response! Your wellness journey continues.`,
                'generic_followup'
            );
        }

        // Record the interaction
        await this.recordInteractiveResponse(phoneNumber, user.awaiting_response, response);
        
        // Clear awaiting response state
        await this.clearAwaitingResponse(phoneNumber);

        return { 
            handled: true, 
            action: 'interactive_response',
            message: `Interactive response "${response}" processed` 
        };
    }

    // Handle unrecognized messages
    async handleUnrecognizedMessage(phoneNumber, originalMessage) {
        const user = await this.getUser(phoneNumber);
        
        // Send a helpful response
        const helpText = `Hi ${user?.first_name || ''}! Thanks for your message. ` +
                        `Reply HELP for support, or visit healthytext.com for more options. ` +
                        `Text STOP to unsubscribe.`;
        
        await this.sendMessageFunction(phoneNumber, helpText, 'unrecognized_response');
        
        this.logFunction('info', `Unrecognized message from ${phoneNumber}: ${originalMessage}`);
        
        return { 
            handled: true, 
            action: 'unrecognized',
            message: 'Sent help response for unrecognized message' 
        };
    }

    // Send fallback crisis responses
    async sendFallbackCrisisResponse(phoneNumber, keyword) {
        const responses = {
            'HELP': 'We\'re here to support you. If this is an emergency, please call 911. For mental health support, call 988 (Suicide & Crisis Lifeline). Visit healthytext.com for more resources.',
            'ANXIETY': 'Take a deep breath. You\'re safe right now. Try the 4-7-8 technique: breathe in for 4, hold for 7, out for 8. Repeat 3 times. You\'ve got this.',
            'STRESS': 'Stress is temporary. Take 5 slow, deep breaths. Focus on what you can control right now. You\'re stronger than you think.',
            'PANIC': 'You\'re experiencing panic, but you\'re safe. Ground yourself: name 5 things you see, 4 you hear, 3 you feel, 2 you smell, 1 you taste. This will pass.',
            'CRISIS': 'If you\'re in crisis, please reach out immediately: 911 for emergencies, 988 for suicide prevention. You matter and help is available 24/7.',
            'BREATHE': 'Let\'s breathe together. In for 4... hold for 4... out for 4... hold for 4. Repeat this pattern. Focus only on your breath.',
            'CALM': 'Finding calm in the storm. Close your eyes if you can. Take 3 deep breaths. Remember: this feeling is temporary, but your strength is permanent.'
        };

        const responseText = responses[keyword] || responses['HELP'];
        await this.sendMessageFunction(phoneNumber, responseText, `crisis_${keyword.toLowerCase()}`);
    }

    // Database helper functions
    async getUser(phoneNumber) {
        return new Promise((resolve, reject) => {
            this.trackingDb.get('SELECT * FROM users WHERE phone_number = ?', [phoneNumber], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async getMessage(messageId) {
        return new Promise((resolve, reject) => {
            this.messagesDb.get('SELECT * FROM messages WHERE id = ? AND active = 1', [messageId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async sendSystemMessage(phoneNumber, messageId) {
        const message = await this.getMessage(messageId);
        if (message) {
            const user = await this.getUser(phoneNumber);
            const personalizedMessage = this.personalizeMessage(message.message, user?.first_name);
            await this.sendMessageFunction(phoneNumber, personalizedMessage, messageId);
        }
    }

    async stopUser(phoneNumber) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            this.trackingDb.run(`
                UPDATE users 
                SET subscription_status = 'stopped', 
                    stopped_at_position = current_sequence_position,
                    date_modified = ?
                WHERE phone_number = ?
            `, [now, phoneNumber], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    async startUser(phoneNumber) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            this.trackingDb.run(`
                UPDATE users 
                SET subscription_status = CASE 
                    WHEN user_type = 'trial' THEN 'trial'
                    ELSE 'active'
                END,
                date_modified = ?
                WHERE phone_number = ?
            `, [now, phoneNumber], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    async resetUser(phoneNumber) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            this.trackingDb.run(`
                UPDATE users 
                SET current_sequence_position = 1,
                    trial_messages_sent = 0,
                    subscription_status = 'active',
                    date_modified = ?
                WHERE phone_number = ?
            `, [now, phoneNumber], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    async recordInteractiveResponse(phoneNumber, messageId, response) {
        return new Promise((resolve, reject) => {
            this.trackingDb.run(`
                UPDATE message_history 
                SET user_responded = 1, response_timestamp = ?
                WHERE phone_number = ? AND message_id = ?
                AND rowid = (
                    SELECT MAX(rowid) FROM message_history 
                    WHERE phone_number = ? AND message_id = ?
                )
            `, [new Date().toISOString(), phoneNumber, messageId, phoneNumber, messageId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    async clearAwaitingResponse(phoneNumber) {
        return new Promise((resolve, reject) => {
            this.trackingDb.run(`
                UPDATE users 
                SET awaiting_response = NULL, awaiting_response_since = NULL
                WHERE phone_number = ?
            `, [phoneNumber], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    // Utility functions
    extractResponseOptions(messageText) {
        if (!messageText) return [];
        
        // Look for A) B) C) D) pattern
        const optionsMatch = messageText.match(/[A-D]\)/g);
        if (optionsMatch) {
            return optionsMatch.map(option => option.replace(')', ''));
        }
        
        // Look for A/B/C/D pattern
        const slashPattern = messageText.match(/[A-D](?=\/|$)/g);
        if (slashPattern) {
            return slashPattern;
        }
        
        return [];
    }

    personalizeMessage(messageText, firstName) {
        if (!messageText) return '';
        
        if (firstName) {
            return messageText.replace(/\{name\}/g, firstName);
        } else {
            return messageText.replace(/\{name\}[,\s]*/g, '').replace(/\s+/g, ' ').trim();
        }
    }

    normalizePhoneNumber(phoneNumber) {
        let normalized = phoneNumber.replace(/[^\d]/g, '');
        if (!normalized.startsWith('1') && normalized.length === 10) {
            normalized = '1' + normalized;
        }
        return '+' + normalized;
    }

    // Close database connections
    close() {
        if (this.trackingDb) this.trackingDb.close();
        if (this.messagesDb) this.messagesDb.close();
    }
}

module.exports = ResponseHandler;