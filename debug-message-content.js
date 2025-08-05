const sqlite3 = require('sqlite3').verbose();
const ResponseHandler = require('./responseHandler');

// Mock send function that shows exactly what would be sent
const debugSendMessage = async (phoneNumber, messageText, messageId) => {
    console.log('🔍 EXACT MESSAGE CONTENT BEING SENT:');
    console.log(`To: ${phoneNumber}`);
    console.log(`Message ID: ${messageId}`);
    console.log(`Length: ${messageText.length} characters`);
    console.log(`Estimated segments: ${Math.ceil(messageText.length / 160)}`);
    console.log(`Message text: "${messageText}"`);
    
    // Show character breakdown
    console.log('\n📊 Character analysis:');
    console.log(`Visible chars: ${messageText.replace(/[\r\n\t]/g, '').length}`);
    console.log(`Total chars: ${messageText.length}`);
    console.log(`Has newlines: ${messageText.includes('\n')}`);
    console.log(`Has returns: ${messageText.includes('\r')}`);
    console.log(`Has tabs: ${messageText.includes('\t')}`);
    
    return { success: true, debug: true };
};

const mockLog = (level, message) => console.log(`${level}: ${message}`);

const handler = new ResponseHandler({
    trackingDbPath: './databases/user_tracking.db',
    messagesDbPath: './databases/messages.db',
    sendMessageFunction: debugSendMessage,
    logFunction: mockLog
});

async function debugMessageContent() {
    console.log('🕵️ Debugging what gets sent for "A" response...\n');
    
    // First check what's in the database
    const db = new sqlite3.Database('./databases/messages.db');
    db.get('SELECT * FROM messages WHERE id = ?', ['2a'], (err, row) => {
        if (row) {
            console.log('📄 Raw database content:');
            console.log(`ID: ${row.id}`);
            console.log(`Length: ${row.message.length}`);
            console.log(`Message: "${row.message}"`);
            console.log('');
        }
        db.close();
        
        // Now process the response to see what actually gets sent
        handler.processIncomingMessage('+13122858457', 'A').then(() => {
            handler.close();
        });
    });
}

debugMessageContent().catch(console.error);