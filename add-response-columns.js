const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./databases/user_tracking.db');

console.log('🔧 Adding awaiting_response columns to users table...');

// Add the columns if they don't exist
db.run('ALTER TABLE users ADD COLUMN awaiting_response TEXT', (err) => {
    if (err && !err.message.includes('duplicate column')) {
        console.error('❌ Error adding awaiting_response:', err.message);
    } else {
        console.log('✅ awaiting_response column ready');
    }
});

db.run('ALTER TABLE users ADD COLUMN awaiting_response_since TEXT', (err) => {
    if (err && !err.message.includes('duplicate column')) {
        console.error('❌ Error adding awaiting_response_since:', err.message);
    } else {
        console.log('✅ awaiting_response_since column ready');
    }
    
    // Now manually set the user as awaiting response for testing
    console.log('🧪 Setting user as awaiting response for message 2...');
    db.run(`UPDATE users SET 
             awaiting_response = '2', 
             awaiting_response_since = ? 
             WHERE phone_number = '+13122858457'`, 
           [new Date().toISOString()], 
           (err) => {
        if (err) {
            console.error('❌ Error setting awaiting response:', err);
        } else {
            console.log('✅ User marked as awaiting response for message 2');
        }
        db.close();
    });
});