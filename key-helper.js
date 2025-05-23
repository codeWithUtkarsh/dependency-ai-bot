// key-helper.js
import fs from 'fs';
import path from 'path';

// Read your .pem file
const pemFilePath = path.resolve('./dependency-ai-bot.pem'); // Update path to your .pem file
const privateKey = fs.readFileSync(pemFilePath, 'utf8');

// Format for .env file (escape newlines)
const formattedKey = privateKey.replace(/\n/g, '\\n');
console.log('Copy this into your .env file:');
console.log(`GITHUB_PRIVATE_KEY=${formattedKey}`);