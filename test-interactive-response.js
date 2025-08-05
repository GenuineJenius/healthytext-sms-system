const ResponseHandler = require('./responseHandler');

// Create a mock send message function for testing
const mockSendMessage = async (phoneNumber, message, messageId) => {
    console.log('📱 MOCK SMS SENT:');
    console.log(`   To: ${phoneNumber}`);
    console.log(`   Message ID: ${messageId}`);
    console.log(`   Text: ${message}`);
    return { success: true };
};

// Create a mock log function
const mockLog = (level, message, phoneNumber, extra) => {
    console.log(`📋 ${level.toUpperCase()}: ${message}`);
    if (phoneNumber) console.log(`   Phone: ${phoneNumber}`);
    if (extra) console.log(`   Extra:`, extra);
};

const handler = new ResponseHandler({
    trackingDbPath: './databases/user_tracking.db',
    messagesDbPath: './databases/messages.db',
    sendMessageFunction: mockSendMessage,
    logFunction: mockLog
});

async function testInteractiveResponse() {
    console.log('🧪 Testing interactive response handling...\n');
    
    // Test with "B" response (should get message 2b)
    console.log('Testing response "B":');
    const resultB = await handler.processIncomingMessage('+13122858457', 'B');
    console.log('Result:', resultB);
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Check user state after response
    console.log('Checking user state after B response...');
    const user = await handler.getUser('+13122858457');
    console.log('User awaiting_response:', user?.awaiting_response || 'NULL');
    console.log('User awaiting_response_since:', user?.awaiting_response_since || 'NULL');
    
    handler.close();
}

testInteractiveResponse().catch(console.error);