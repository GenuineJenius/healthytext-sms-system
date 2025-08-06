// PM2 Configuration for HealthyText SMS System
module.exports = {
  apps: [{
    name: 'healthytext-sms',
    script: 'app.js',
    
    // Production settings
    env_production: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 3000
    },
    
    // Development settings  
    env_development: {
      NODE_ENV: 'development',
      PORT: process.env.PORT || 3000
    },
    
    // PM2 options
    instances: 1,                    // Single instance (shared hosting)
    exec_mode: 'fork',              // Fork mode for shared hosting
    autorestart: true,              // Auto restart on crash
    watch: false,                   // Don't watch files in production
    max_memory_restart: '1G',       // Restart if memory usage exceeds 1GB
    
    // Logging
    log_file: 'logs/combined.log',
    out_file: 'logs/out.log',
    error_file: 'logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Environment variables
    env: {
      NODE_ENV: 'production'
    },
    
    // Restart policy
    min_uptime: '10s',              // Minimum uptime before considering stable
    max_restarts: 5,                // Max restarts within 1 minute
    
    // Graceful shutdown
    kill_timeout: 5000,             // Time to wait before force kill
    
    // Health monitoring  
    health_check_grace_period: 10000, // 10 seconds
    
    // Additional settings for shared hosting
    merge_logs: true,               // Merge cluster logs
    combine_logs: true,             // Combine all log types
    
    // Ignore specific directories for performance
    ignore_watch: [
      'node_modules',
      'databases',
      'logs',
      '.git'
    ]
  }]
};