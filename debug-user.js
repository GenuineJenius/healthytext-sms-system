const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./databases/user_tracking.db');

console.log('🔍 Checking user state for +13122858457...');

db.get('SELECT * FROM users WHERE phone_number = ?', ['+13122858457'], (err, user) => {
    if (err) {
        console.error('❌ Error:', err);
    } else if (user) {
        console.log('✅ User found:');
        console.log('   Phone:', user.phone_number);
        console.log('   First Name:', user.first_name);
        console.log('   Awaiting Response:', user.awaiting_response || 'NULL');
        console.log('   Awaiting Since:', user.awaiting_response_since || 'NULL');
        console.log('   User Type:', user.user_type);
    } else {
        console.log('❌ User not found in database');
    }
    
    db.close();
});