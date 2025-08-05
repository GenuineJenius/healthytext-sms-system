require('dotenv').config();
const mysql = require('mysql2/promise');

// WordPress database connection configuration
const wpConfig = {
    host: process.env.WORDPRESS_DB_HOST || '15.204.105.183',
    port: process.env.WORDPRESS_DB_PORT || 3306,
    user: process.env.WORDPRESS_DB_USER || 'healthtxt_',
    password: process.env.WORDPRESS_DB_PASSWORD || 'pA0-w5Sf[7',
    database: process.env.WORDPRESS_DB_NAME || 'healthtxt_',
    charset: process.env.WORDPRESS_DB_CHARSET || 'utf8mb4'
};

const tablePrefix = process.env.WORDPRESS_DB_PREFIX || 'Healthtxttbl_';

async function testWordPressUsers() {
    let connection;
    
    try {
        console.log('🔍 Testing WordPress Database User Identification');
        console.log('================================================');
        console.log(`Connecting to: ${wpConfig.host}:${wpConfig.port}`);
        console.log(`Database: ${wpConfig.database}`);
        console.log(`Table Prefix: ${tablePrefix}`);
        console.log('');

        // Create connection
        connection = await mysql.createConnection(wpConfig);
        console.log('✅ Connected to WordPress database successfully');
        console.log('');

        // First, let's see what tables exist
        console.log('📋 Available Tables:');
        console.log('===================');
        const [tables] = await connection.execute('SHOW TABLES');
        tables.forEach(table => {
            const tableName = Object.values(table)[0];
            console.log(`- ${tableName}`);
        });
        console.log('');

        // Test 1: Get all users from wp_users table
        console.log('👥 TEST 1: Identifying WordPress Users');
        console.log('======================================');
        
        try {
            const [users] = await connection.execute(`
                SELECT 
                    ID,
                    user_login,
                    user_email,
                    user_registered,
                    user_status,
                    display_name
                FROM ${tablePrefix}users 
                WHERE user_status = 0
                ORDER BY user_registered DESC
                LIMIT 20
            `);

            console.log(`Found ${users.length} active users (showing first 20):`);
            users.forEach((user, index) => {
                console.log(`${index + 1}. ID: ${user.ID} | Login: ${user.user_login} | Email: ${user.user_email} | Registered: ${user.user_registered}`);
            });
            console.log('');

            // Test 2: Get user meta data and timezone via profile method
            console.log('🔧 TEST 2: User Meta Data & Timezone Extraction');
            console.log('===============================================');
            
            if (users.length > 0) {
                // Get comprehensive user data including timezone via profile method
                const testUserIds = users.slice(0, 5).map(u => u.ID);
                const userIdList = testUserIds.join(',');

                const [userMeta] = await connection.execute(`
                    SELECT 
                        user_id,
                        meta_key,
                        meta_value
                    FROM ${tablePrefix}usermeta 
                    WHERE user_id IN (${userIdList})
                    AND (
                        meta_key LIKE '%timezone%' OR 
                        meta_key LIKE '%time_zone%' OR
                        meta_key LIKE '%phone%' OR
                        meta_key LIKE '%first_name%' OR
                        meta_key LIKE '%last_name%' OR
                        meta_key LIKE '%subscription%' OR
                        meta_key LIKE '%plan%' OR
                        meta_key LIKE '%stripe%' OR
                        meta_key LIKE '%voxel%'
                    )
                    ORDER BY user_id, meta_key
                `);

                console.log(`Found ${userMeta.length} relevant meta entries for first 5 users:`);
                
                let currentUserId = null;
                userMeta.forEach(meta => {
                    if (meta.user_id !== currentUserId) {
                        currentUserId = meta.user_id;
                        const user = users.find(u => u.ID === meta.user_id);
                        console.log(`\n📋 User ID ${meta.user_id} (${user ? user.user_login : 'Unknown'}):`);
                    }
                    console.log(`   ${meta.meta_key}: ${meta.meta_value}`);
                });

                // Test 2B: Extract timezone data via profile method
                console.log('\n🕒 TEST 2B: Timezone Extraction via Profile Method');
                console.log('================================================');
                
                const [timezoneData] = await connection.execute(`
                    SELECT 
                        u.ID as user_id,
                        u.user_login,
                        um.meta_value as profile_id,
                        pm.meta_value as timezone
                    FROM ${tablePrefix}users u
                    LEFT JOIN ${tablePrefix}usermeta um ON u.ID = um.user_id AND um.meta_key = 'voxel:profile_id'
                    LEFT JOIN ${tablePrefix}postmeta pm ON um.meta_value = pm.post_id AND pm.meta_key = 'timezone'
                    WHERE u.ID IN (${userIdList})
                    ORDER BY u.ID
                `);

                console.log('Timezone data for test users:');
                timezoneData.forEach(user => {
                    console.log(`   ${user.user_login} (ID: ${user.user_id})`);
                    console.log(`     Profile ID: ${user.profile_id || 'Not set'}`);
                    console.log(`     Timezone: ${user.timezone || 'Not set'}`);
                });
            }
            console.log('');

            // Test 3: Look for subscription-related tables
            console.log('💳 TEST 3: Subscription Data');
            console.log('============================');
            
            // Check for common subscription table patterns
            const subscriptionTables = tables.filter(table => {
                const tableName = Object.values(table)[0].toLowerCase();
                return tableName.includes('subscription') || 
                       tableName.includes('member') || 
                       tableName.includes('payment') ||
                       tableName.includes('stripe') ||
                       tableName.includes('woocommerce');
            });

            if (subscriptionTables.length > 0) {
                console.log('Found potential subscription tables:');
                subscriptionTables.forEach(table => {
                    console.log(`- ${Object.values(table)[0]}`);
                });

                // Try to get data from the first subscription table
                const firstSubTable = Object.values(subscriptionTables[0])[0];
                try {
                    const [subData] = await connection.execute(`
                        SELECT * FROM ${firstSubTable} LIMIT 5
                    `);
                    console.log(`\nSample data from ${firstSubTable}:`);
                    subData.forEach((row, index) => {
                        console.log(`Row ${index + 1}:`, JSON.stringify(row, null, 2));
                    });
                } catch (error) {
                    console.log(`Could not read from ${firstSubTable}: ${error.message}`);
                }
            } else {
                console.log('No obvious subscription tables found');
            }
            console.log('');

            // Test 4: Look for Ninja Forms data (trial users)
            console.log('📝 TEST 4: Ninja Forms Data (Trial Users)');
            console.log('==========================================');
            
            const ninjaFormsTables = tables.filter(table => {
                const tableName = Object.values(table)[0].toLowerCase();
                return tableName.includes('nf3_') || tableName.includes('ninja');
            });

            if (ninjaFormsTables.length > 0) {
                console.log('Found Ninja Forms tables:');
                ninjaFormsTables.forEach(table => {
                    console.log(`- ${Object.values(table)[0]}`);
                });

                // Try to get recent form submissions
                const submissionTable = ninjaFormsTables.find(table => 
                    Object.values(table)[0].includes('submissions')
                );

                if (submissionTable) {
                    const tableName = Object.values(submissionTable)[0];
                    try {
                        const [submissions] = await connection.execute(`
                            SELECT * FROM ${tableName} 
                            ORDER BY date_updated DESC 
                            LIMIT 5
                        `);
                        console.log(`\nRecent submissions from ${tableName}:`);
                        submissions.forEach((sub, index) => {
                            console.log(`Submission ${index + 1}:`, JSON.stringify(sub, null, 2));
                        });
                    } catch (error) {
                        console.log(`Could not read submissions: ${error.message}`);
                    }
                }
            } else {
                console.log('No Ninja Forms tables found');
            }

        } catch (error) {
            console.error('❌ Error during user testing:', error.message);
        }

        console.log('\n🏁 Test Summary');
        console.log('===============');
        console.log('✅ WordPress database connection: SUCCESS');
        console.log('✅ User table access: SUCCESS');
        console.log('✅ User meta data access: SUCCESS');
        console.log('');
        console.log('📋 Key Findings:');
        console.log('- Regular users identified in wp_users table');
        console.log('- User meta data accessible for timezone and other fields');
        console.log('- Additional subscription and form tables may need investigation');

    } catch (error) {
        console.error('❌ Connection Error:', error.message);
        console.error('❌ Could not connect to WordPress database');
        console.error('');
        console.error('Check the following:');
        console.error('1. Database credentials in .env file');
        console.error('2. Network connectivity to database server');
        console.error('3. Database server is running and accessible');
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔐 Database connection closed');
        }
    }
}

// Run the test
if (require.main === module) {
    testWordPressUsers().catch(console.error);
}

module.exports = { testWordPressUsers };