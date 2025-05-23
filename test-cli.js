#!/usr/bin/env node

// test-cli.js - Test script for dependency-ai-bot CLI
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Get the directory of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Validate .env file exists
if (!fs.existsSync(path.join(__dirname, '.env'))) {
  console.error('Error: .env file not found. Please create one with the required variables.');
  process.exit(1);
}

// Sample repositories to test with
const testRepos = [
  'owner/repo',
  'https://github.com/codeWithUtkarsh/dependency-ai-bot',
  'github.com/octokit/rest.js'
];

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

console.log(`${colors.blue}=== Dependency AI Bot CLI Tester ===${colors.reset}`);
console.log('This script tests the CLI parsing functionality without making actual API calls.\n');

// Function to run the CLI with different repo URLs
async function testCli(repoUrl) {
  return new Promise((resolve) => {
    console.log(`${colors.yellow}Testing with repo: ${repoUrl}${colors.reset}`);
    
    // Run the CLI with the --dry-run flag to prevent actual API calls
    const cli = spawn('node', ['cli.js', '--repo', repoUrl, '--dry-run'], {
      cwd: __dirname,
      env: process.env
    });
    
    // Collect output
    let output = '';
    cli.stdout.on('data', (data) => {
      output += data.toString();
      process.stdout.write(data.toString());
    });
    
    cli.stderr.on('data', (data) => {
      output += data.toString();
      process.stderr.write(`${colors.red}${data.toString()}${colors.reset}`);
    });
    
    cli.on('close', (code) => {
      const success = code === 0;
      console.log(`${success ? colors.green : colors.red}Exit code: ${code}${colors.reset}`);
      
      // Validate the output contains expected repository parsing
      const parsedCorrectly = output.includes('Running dependency check for');
      
      console.log(`${parsedCorrectly ? colors.green : colors.red}URL parsed correctly: ${parsedCorrectly}${colors.reset}`);
      console.log('-----------------------------------\n');
      
      resolve({ success, parsedCorrectly });
    });
  });
}

// Run tests sequentially
async function runTests() {
  let successCount = 0;
  let failCount = 0;
  
  for (const repo of testRepos) {
    const result = await testCli(repo);
    if (result.success && result.parsedCorrectly) {
      successCount++;
    } else {
      failCount++;
    }
  }
  
  // Print summary
  console.log(`${colors.blue}=== Test Results ===${colors.reset}`);
  console.log(`${colors.green}Passed: ${successCount}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failCount}${colors.reset}`);
  
  // Also test an intentionally malformed URL
  console.log(`\n${colors.yellow}Testing with invalid repo URL:${colors.reset}`);
  await testCli('invalid-url-format');
}

runTests().catch(err => {
  console.error(`${colors.red}Test failed with error:${colors.reset}`, err);
  process.exit(1);
});