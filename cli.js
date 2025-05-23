#!/usr/bin/env node

// cli.js - Command-line interface for dependency-ai-bot
// Note: When installing globally, make sure this file has executable permissions
// You may need to run: chmod +x cli.js
import 'dotenv/config';
import { program } from 'commander';
import { DependencyBot } from './dependency-bot.js';

// Parse command line arguments
program
  .name('dependency-ai-bot')
  .description('A CLI tool to update dependencies and create PRs')
  .version('1.0.0')
  .requiredOption('--repo <url>', 'GitHub repository URL (e.g., https://github.com/owner/repo)')
  .option('--dry-run', 'Run without creating PRs (test mode)', false)
  .parse(process.argv);

const options = program.opts();

// Extract owner and repo from the repository URL
function parseRepoUrl(url) {
  try {
    // Handle different URL formats
    // https://github.com/owner/repo
    // github.com/owner/repo
    // owner/repo
    let repoPath = url;
    
    if (url.includes('github.com')) {
      // Extract the path part after github.com
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      repoPath = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    }
    
    // Split by '/' and take the first two parts
    const parts = repoPath.split('/').filter(part => part.trim() !== '');
    
    if (parts.length < 2) {
      throw new Error('Invalid repository format. Expected owner/repo');
    }
    
    return {
      owner: parts[0],
      repo: parts[1]
    };
  } catch (error) {
    console.error('Failed to parse repository URL:', error.message);
    process.exit(1);
  }
}

// Validate required environment variables
const requiredEnvVars = [
  'GITHUB_APP_ID',
  'GITHUB_PRIVATE_KEY',
  'GITHUB_INSTALLATION_ID',
  'ANTHROPIC_API_KEY'
];

const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingVars.length > 0) {
  console.error(`Error: Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Main function
async function main() {
  try {
    const { owner, repo } = parseRepoUrl(options.repo);
    
    console.log(`Running dependency check for ${owner}/${repo}`);
    console.log(`Mode: ${options.dryRun ? 'DRY RUN (no PRs will be created)' : 'LIVE'}`);
    console.log('Enhanced PR Format: Including detailed CVE information for dependencies');
    
    // Initialize and run the bot
    const bot = new DependencyBot({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY,
      installationId: process.env.GITHUB_INSTALLATION_ID,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      targetRepo: { owner, repo },
      dryRun: options.dryRun
    });
    
    await bot.run();
    console.log('Dependency check completed successfully');
  } catch (error) {
    console.error('Error running dependency bot:', error);
    process.exit(1);
  }
}

// Run the CLI tool
main();