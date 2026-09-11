const fs = require('fs');
const content = fs.readFileSync('worker/test/access-jwt.test.ts', 'utf8');

const updated = content
  .replace(/now: NOW,\n    \}\);/g, 'now: NOW,\n      authorizedEmails: ["operator@hivarium.test"],\n    });')
  .replace(/now: NOW \},\n/g, 'now: NOW, authorizedEmails: ["operator@hivarium.test"] },\n');

fs.writeFileSync('worker/test/access-jwt.test.ts', updated);
