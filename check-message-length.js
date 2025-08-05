const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./databases/messages.db');

console.log('📏 Checking message lengths...');

db.get('SELECT id, message FROM messages WHERE id = ?', ['2a'], (err, row) => {
    if (err) {
        console.error('❌ Error:', err);
    } else if (row) {
        console.log(`Message 2a length: ${row.message.length} characters`);
        console.log(`Message: "${row.message}"`);
        
        // SMS segments: 160 chars = 1 segment, 306 chars = 2 segments, etc.
        const segments = Math.ceil(row.message.length / 160);
        console.log(`Estimated SMS segments: ${segments}`);
        
        if (segments > 3) {
            console.log('⚠️  This message is too long! Carriers often reject 4+ segment messages.');
        }
    } else {
        console.log('❌ Message 2a not found');
    }
    
    db.close();
});