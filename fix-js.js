import fs from 'fs';
let content = fs.readFileSync('worker/test/access-jwt.test.ts', 'utf8');

content = content.replace(/authorizedEmails: \['operator@hivarium.test'\],\n\s*authorizedEmails: \["operator@hivarium.test"\],/g, 'authorizedEmails: ["operator@hivarium.test"],');
fs.writeFileSync('worker/test/access-jwt.test.ts', content);
