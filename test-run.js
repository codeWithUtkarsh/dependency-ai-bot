const { DependencyBot } = require('./dependency-bot');

// Test with a specific repository
const bot = new DependencyBot({
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    installationId: process.env.GITHUB_INSTALLATION_ID,
    // For testing, specify exactly which repo to check
    specificRepo: {
        owner: 'codeWithUtkarsh',
        repo: 'https://github.com/codeWithUtkarsh/ai-saas'
    }
});

// Run the bot in test mode (no PRs created)
bot.run({ dryRun: true })
    .then(() => console.log('Test completed successfully'))
    .catch(err => console.error('Test failed:', err));