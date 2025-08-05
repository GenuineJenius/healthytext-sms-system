const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./databases/messages.db');

const messages = [
  {
    id: '2',
    number: 2,
    protocol: 'Elevate',
    pillar: 'mental_wellbeing',
    category: 'emotional_awareness',
    message_type: 'interactive',
    message: '{name}, what describes your mental state today? Reply: A) Clear and focused B) Foggy but functional C) Scattered and overwhelmed. We\'ll send you exactly what you need! 💭',
    active: 1
  },
  {
    id: '2a',
    number: null,
    protocol: 'Elevate',
    pillar: 'mental_wellbeing',
    category: 'emotional_awareness',
    message_type: 'interactive',
    message: 'I love that clarity! Since you\'re in a focused headspace, here\'s a challenge: Set one meaningful intention for tomorrow. When your mind is clear, it\'s the perfect time to plant seeds for future growth. 🌱',
    active: 1
  },
  {
    id: '2b',
    number: null,
    protocol: 'Elevate',
    pillar: 'mental_wellbeing',
    category: 'emotional_awareness',
    message_type: 'interactive',
    message: 'Foggy days are totally normal! Try this: Step outside for 2 minutes and take 5 deep breaths of fresh air. Sometimes our brain just needs a gentle reset. You\'re doing better than you think. 🌤️',
    active: 1
  },
  {
    id: '2c',
    number: null,
    protocol: 'Elevate',
    pillar: 'mental_wellbeing',
    category: 'emotional_awareness',
    message_type: 'interactive',
    message: 'When everything feels chaotic, start simple. Right now: Name 3 things you can see around you. This grounds you in the present moment and gives your mind an anchor. You\'ve got this. ⚓',
    active: 1
  }
];

const now = new Date().toISOString();

console.log('📝 Adding interactive messages to database...');

let completed = 0;
messages.forEach(msg => {
  db.run(`
    INSERT OR REPLACE INTO messages 
    (id, number, protocol, pillar, category, message_type, message, tags, link, notes, active, date_created, date_modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    msg.id, msg.number, msg.protocol, msg.pillar, msg.category, 
    msg.message_type, msg.message, '', '', 'Interactive test message', msg.active, now, now
  ], function(err) {
    if (err) {
      console.error('❌ Error adding message', msg.id, ':', err);
    } else {
      console.log('✅ Added message:', msg.id);
    }
    
    completed++;
    if (completed === messages.length) {
      console.log('🎉 All interactive messages added successfully!');
      db.close();
    }
  });
});