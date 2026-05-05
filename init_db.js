const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const collections = ['users', 'projects', 'files', 'file_history', 'messages', 'notifications', 'signup_requests', 'settings'];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

collections.forEach(col => {
  const file = path.join(DATA_DIR, col + '.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([], null, 2));
    console.log(`Created ${col}.json`);
  }
});

console.log('Database initialized.');
