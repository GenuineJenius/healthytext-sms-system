const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

class DatabaseManager {
    constructor(config = {}) {
        this.config = {
            // Default to SQLite for local development
            useMariaDB: process.env.NODE_ENV === 'production' || process.env.MARIADB_HOST,
            
            // MariaDB settings (production)
            mariadb: {
                host: process.env.MARIADB_HOST,
                user: process.env.MARIADB_USER,
                password: process.env.MARIADB_PASSWORD,
                database: process.env.MARIADB_DATABASE || 'healthytext_sms',
                port: process.env.MARIADB_PORT || 3306,
                charset: 'utf8mb4',
                acquireTimeout: 60000,
                timeout: 60000
            },
            
            // SQLite settings (local development)
            sqlite: {
                messagesDb: './databases/messages.db',
                trackingDb: './databases/user_tracking.db',
                logsDb: './databases/system_logs.db'
            },
            
            ...config
        };
        
        this.connections = {};
        this.isReady = false;
        
        // Log which database system we're using
        console.log(`🗄️  Database System: ${this.config.useMariaDB ? 'MariaDB' : 'SQLite'}`);
    }

    async initialize() {
        try {
            if (this.config.useMariaDB) {
                await this.initializeMariaDB();
            } else {
                await this.initializeSQLite();
            }
            this.isReady = true;
            console.log('✅ Database manager initialized successfully');
        } catch (error) {
            console.error('❌ Database initialization failed:', error);
            // Fallback to SQLite if MariaDB fails
            if (this.config.useMariaDB) {
                console.log('🔄 Falling back to SQLite...');
                this.config.useMariaDB = false;
                await this.initializeSQLite();
                this.isReady = true;
            } else {
                throw error;
            }
        }
    }

    async initializeMariaDB() {
        console.log('🔧 Initializing MariaDB connection...');
        
        // Test connection first
        const testConnection = await mysql.createConnection(this.config.mariadb);
        await testConnection.ping();
        await testConnection.end();
        
        // Create connection pool for better performance
        this.connections.pool = mysql.createPool({
            ...this.config.mariadb,
            connectionLimit: 10,
            queueLimit: 0,
            reconnect: true,
            acquireTimeout: 60000,
            timeout: 60000
        });
        
        // Initialize tables
        await this.createMariaDBTables();
        
        console.log('✅ MariaDB initialized with connection pool');
    }

    async initializeSQLite() {
        console.log('🔧 Initializing SQLite databases...');
        
        // Create databases directory if it doesn't exist
        const dbDir = './databases';
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        // Initialize SQLite databases
        this.connections.messages = new sqlite3.Database(this.config.sqlite.messagesDb);
        this.connections.tracking = new sqlite3.Database(this.config.sqlite.trackingDb);
        this.connections.logs = new sqlite3.Database(this.config.sqlite.logsDb);
        
        // Initialize tables
        await this.createSQLiteTables();
        
        console.log('✅ SQLite databases initialized');
    }

    async createMariaDBTables() {
        const connection = await this.connections.pool.getConnection();
        
        try {
            // Messages table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS messages (
                    id VARCHAR(255) PRIMARY KEY,
                    number INT,
                    protocol VARCHAR(100),
                    pillar VARCHAR(100),
                    category VARCHAR(100),
                    message_type VARCHAR(50),
                    message TEXT,
                    tags TEXT,
                    link TEXT,
                    notes TEXT,
                    active TINYINT(1) DEFAULT 1,
                    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    date_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_number (number),
                    INDEX idx_protocol (protocol),
                    INDEX idx_message_type (message_type)
                )
            `);

            // Users table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS users (
                    phone_number VARCHAR(20) PRIMARY KEY,
                    protocol VARCHAR(100) DEFAULT 'MindBoost',
                    user_type VARCHAR(50) DEFAULT 'trial',
                    current_sequence_position INT DEFAULT 1,
                    total_messages_sent INT DEFAULT 0,
                    subscription_status VARCHAR(50) DEFAULT 'trial',
                    trial_messages_sent INT DEFAULT 0,
                    post_trial_phase INT DEFAULT 1,
                    post_trial_day INT DEFAULT 0,
                    milestones_achieved TEXT DEFAULT '',
                    date_joined TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_message_sent TIMESTAMP NULL,
                    messages_sent_today INT DEFAULT 0,
                    last_daily_reset DATE DEFAULT (CURRENT_DATE),
                    timezone VARCHAR(100) DEFAULT 'America/Chicago',
                    preferred_send_time VARCHAR(50) DEFAULT '14:00-17:00',
                    user_preferences JSON,
                    first_name VARCHAR(100),
                    awaiting_response VARCHAR(50),
                    awaiting_response_since TIMESTAMP NULL,
                    stopped_at_position INT,
                    wordpress_user_id INT,
                    notes TEXT,
                    post_trial_messages_sent JSON,
                    date_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_user_type (user_type),
                    INDEX idx_subscription_status (subscription_status),
                    INDEX idx_awaiting_response (awaiting_response)
                )
            `);

            // Message History table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS message_history (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    phone_number VARCHAR(20),
                    message_id VARCHAR(255),
                    message_type VARCHAR(50),
                    sent_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    delivery_status VARCHAR(50) DEFAULT 'sent',
                    twilio_message_id VARCHAR(100),
                    user_responded TINYINT(1) DEFAULT 0,
                    response_timestamp TIMESTAMP NULL,
                    sequence_position INT,
                    is_manual_injection TINYINT(1) DEFAULT 0,
                    protocol VARCHAR(100),
                    auto_cleanup_date DATE NULL,
                    INDEX idx_phone_number (phone_number),
                    INDEX idx_message_id (message_id),
                    INDEX idx_sent_timestamp (sent_timestamp),
                    FOREIGN KEY (phone_number) REFERENCES users(phone_number) ON DELETE CASCADE
                )
            `);

            // Daily Limits table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS daily_limits (
                    phone_number VARCHAR(20),
                    date DATE,
                    messages_sent INT DEFAULT 0,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (phone_number, date),
                    FOREIGN KEY (phone_number) REFERENCES users(phone_number) ON DELETE CASCADE
                )
            `);

            // Pending Messages table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS pending_messages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    phone_number VARCHAR(20),
                    message_id VARCHAR(255),
                    priority INT DEFAULT 1,
                    scheduled_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_manual_injection TINYINT(1) DEFAULT 0,
                    created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status VARCHAR(50) DEFAULT 'pending',
                    INDEX idx_phone_number (phone_number),
                    INDEX idx_scheduled_time (scheduled_time),
                    INDEX idx_status (status)
                )
            `);

            // Immediate Queue table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS immediate_queue (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    phone_number VARCHAR(20),
                    first_name VARCHAR(100),
                    action VARCHAR(100),
                    processed TINYINT(1) DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    form_submission_id INT,
                    INDEX idx_processed (processed),
                    INDEX idx_phone_number (phone_number)
                )
            `);

            // System Logs table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS system_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    log_type VARCHAR(50),
                    message TEXT,
                    phone_number VARCHAR(20),
                    additional_data JSON,
                    INDEX idx_timestamp (timestamp),
                    INDEX idx_log_type (log_type),
                    INDEX idx_phone_number (phone_number)
                )
            `);

            console.log('✅ MariaDB tables created successfully');
            
        } finally {
            connection.release();
        }
    }

    async createSQLiteTables() {
        // Use your existing SQLite table creation logic
        const { createSQLiteTable } = this;
        
        // Messages table
        await createSQLiteTable(this.connections.messages, `
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                number INTEGER,
                protocol TEXT,
                pillar TEXT,
                category TEXT,
                message_type TEXT,
                message TEXT,
                tags TEXT,
                link TEXT,
                notes TEXT,
                active INTEGER DEFAULT 1,
                date_created TEXT DEFAULT CURRENT_TIMESTAMP,
                date_modified TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Users table
        await createSQLiteTable(this.connections.tracking, `
            CREATE TABLE IF NOT EXISTS users (
                phone_number TEXT PRIMARY KEY,
                protocol TEXT DEFAULT 'MindBoost',
                user_type TEXT DEFAULT 'trial',
                current_sequence_position INTEGER DEFAULT 1,
                total_messages_sent INTEGER DEFAULT 0,
                subscription_status TEXT DEFAULT 'trial',
                trial_messages_sent INTEGER DEFAULT 0,
                post_trial_phase INTEGER DEFAULT 1,
                post_trial_day INTEGER DEFAULT 0,
                milestones_achieved TEXT DEFAULT '',
                date_joined TEXT DEFAULT CURRENT_TIMESTAMP,
                last_message_sent TEXT,
                messages_sent_today INTEGER DEFAULT 0,
                last_daily_reset TEXT DEFAULT CURRENT_DATE,
                timezone TEXT DEFAULT 'America/Chicago',
                preferred_send_time TEXT DEFAULT '14:00-17:00',
                user_preferences TEXT DEFAULT '{}',
                first_name TEXT,
                awaiting_response TEXT,
                awaiting_response_since TEXT,
                stopped_at_position INTEGER,
                wordpress_user_id INTEGER,
                notes TEXT,
                post_trial_messages_sent TEXT DEFAULT '',
                date_modified TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Other tables (message_history, daily_limits, etc.)
        const tables = [
            { name: 'message_history', sql: `CREATE TABLE IF NOT EXISTS message_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT,
                message_id TEXT,
                message_type TEXT,
                sent_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                delivery_status TEXT DEFAULT 'sent',
                twilio_message_id TEXT,
                user_responded INTEGER DEFAULT 0,
                response_timestamp TEXT,
                sequence_position INTEGER,
                is_manual_injection INTEGER DEFAULT 0,
                protocol TEXT,
                auto_cleanup_date TEXT
            )` },
            { name: 'daily_limits', sql: `CREATE TABLE IF NOT EXISTS daily_limits (
                phone_number TEXT,
                date TEXT,
                messages_sent INTEGER DEFAULT 0,
                last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (phone_number, date)
            )` },
            { name: 'pending_messages', sql: `CREATE TABLE IF NOT EXISTS pending_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT,
                message_id TEXT,
                priority INTEGER DEFAULT 1,
                scheduled_time TEXT DEFAULT CURRENT_TIMESTAMP,
                is_manual_injection INTEGER DEFAULT 0,
                created_timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending'
            )` },
            { name: 'immediate_queue', sql: `CREATE TABLE IF NOT EXISTS immediate_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT,
                first_name TEXT,
                action TEXT,
                processed INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                form_submission_id INTEGER
            )` }
        ];

        for (const table of tables) {
            await createSQLiteTable(this.connections.tracking, table.sql);
        }

        // System logs table
        await createSQLiteTable(this.connections.logs, `
            CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                log_type TEXT,
                message TEXT,
                phone_number TEXT,
                additional_data TEXT
            )
        `);
    }

    createSQLiteTable(db, sql) {
        return new Promise((resolve, reject) => {
            db.run(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Unified query interface
    async query(sql, params = [], options = {}) {
        if (!this.isReady) {
            throw new Error('Database not initialized. Call initialize() first.');
        }

        if (this.config.useMariaDB) {
            return await this.mariadbQuery(sql, params, options);
        } else {
            return await this.sqliteQuery(sql, params, options);
        }
    }

    async mariadbQuery(sql, params = [], options = {}) {
        const connection = await this.connections.pool.getConnection();
        
        try {
            // Convert SQLite-style queries to MariaDB
            const mariadbSql = this.convertToMariaDBSql(sql);
            const [rows, fields] = await connection.execute(mariadbSql, params);
            return rows;
        } finally {
            connection.release();
        }
    }

    async sqliteQuery(sql, params = [], options = {}) {
        const dbType = options.database || 'tracking';
        const db = this.connections[dbType] || this.connections.tracking;
        
        return new Promise((resolve, reject) => {
            if (sql.trim().toUpperCase().startsWith('SELECT')) {
                db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            } else {
                db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve({ insertId: this.lastID, changes: this.changes });
                });
            }
        });
    }

    convertToMariaDBSql(sql) {
        // Convert common SQLite syntax to MariaDB
        return sql
            .replace(/CURRENT_TIMESTAMP/g, 'NOW()')
            .replace(/CURRENT_DATE/g, 'CURDATE()')
            .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'INT AUTO_INCREMENT PRIMARY KEY')
            .replace(/INTEGER/g, 'INT')
            .replace(/TEXT/g, 'VARCHAR(500)')
            .replace(/TINYINT\(1\)/g, 'BOOLEAN');
    }

    // Helper methods for common operations
    async getUser(phoneNumber) {
        const users = await this.query(
            'SELECT * FROM users WHERE phone_number = ?', 
            [phoneNumber]
        );
        return users[0] || null;
    }

    async getMessage(messageId) {
        const messages = await this.query(
            'SELECT * FROM messages WHERE id = ?', 
            [messageId],
            { database: 'messages' }
        );
        return messages[0] || null;
    }

    async logMessage(type, message, phoneNumber = null, additionalData = null) {
        const logData = this.config.useMariaDB && additionalData 
            ? JSON.stringify(additionalData) 
            : (additionalData ? JSON.stringify(additionalData) : null);
            
        return await this.query(
            'INSERT INTO system_logs (log_type, message, phone_number, additional_data) VALUES (?, ?, ?, ?)',
            [type, message, phoneNumber, logData],
            { database: 'logs' }
        );
    }

    // Close connections
    async close() {
        if (this.config.useMariaDB && this.connections.pool) {
            await this.connections.pool.end();
        } else {
            for (const [name, db] of Object.entries(this.connections)) {
                if (db && typeof db.close === 'function') {
                    db.close();
                }
            }
        }
        console.log('🔒 Database connections closed');
    }

    // Health check
    async healthCheck() {
        try {
            if (this.config.useMariaDB) {
                await this.query('SELECT 1');
            } else {
                await this.query('SELECT 1');
            }
            return { status: 'healthy', database: this.config.useMariaDB ? 'MariaDB' : 'SQLite' };
        } catch (error) {
            return { status: 'unhealthy', error: error.message };
        }
    }
}

module.exports = DatabaseManager;