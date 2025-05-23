// index.js - Entry point to run the dependency bot with security checking
import 'dotenv/config';
import { DependencyBot } from './dependency-bot.js';

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

// Create and run bot instance
const bot = new DependencyBot({
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    installationId: process.env.GITHUB_INSTALLATION_ID,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    excludedRepos: process.env.EXCLUDED_REPOS ? process.env.EXCLUDED_REPOS.split(',') : [],
    reportDir: process.env.REPORT_DIR || './reports',
    dryRun: process.env.DRY_RUN === 'true'
});

console.log('Starting Dependency Version Bot with AI Security Verification...');
console.log('Enhanced PR Format: Including detailed CVE information for dependencies');
console.log(`Mode: ${process.env.DRY_RUN === 'true' ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);

bot.run()
    .then(() => console.log('Dependency bot completed successfully'))
    .catch(error => {
        console.error('Error running dependency bot:', error);
        process.exit(1);
    });