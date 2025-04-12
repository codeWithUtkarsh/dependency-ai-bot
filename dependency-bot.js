// dependency-bot.js
// A GitHub bot for automated dependency version bumping using a structured protocol

const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');
const semver = require('semver');
const yaml = require('js-yaml');

require('dotenv').config();

class DependencyBot {
    constructor(config) {
        this.config = config;
        this.octokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: config.appId,
                privateKey: config.privateKey,
                installationId: config.installationId,
            },
        });
    }

    /**
     * Entry point for the bot
     */
    async run() {
        console.log('Starting Dependency Bot...');

        // Get repositories to check
        const repos = await this.getRepositories();

        for (const repo of repos) {
            await this.processRepository(repo);
        }
    }

    /**
     * Get repositories to monitor
     */
    async getRepositories() {
        const { data: repos } = await this.octokit.apps.listReposAccessibleToInstallation();
        return repos.repositories.filter(repo =>
            !repo.archived &&
            !this.config.excludedRepos.includes(`${repo.owner.login}/${repo.name}`)
        );
    }

    /**
     * Process a single repository
     */
    async processRepository(repo) {
        console.log(`Processing ${repo.full_name}...`);

        try {
            // Get package files (package.json, requirements.txt, etc.)
            const packageFiles = await this.getPackageFiles(repo);

            for (const file of packageFiles) {
                const outdatedDeps = await this.checkDependencies(repo, file);

                if (outdatedDeps.length > 0) {
                    await this.createUpdatePR(repo, file, outdatedDeps);
                }
            }
        } catch (error) {
            console.error(`Error processing ${repo.full_name}:`, error);
        }
    }

    /**
     * Get package files from repository
     */
    async getPackageFiles(repo) {
        const files = [];

        // Check for package.json (Node.js)
        try {
            const { data: packageJson } = await this.octokit.repos.getContent({
                owner: repo.owner.login,
                repo: repo.name,
                path: 'package.json',
            });

            if (packageJson) files.push({
                path: 'package.json',
                type: 'npm',
                content: Buffer.from(packageJson.content, 'base64').toString()
            });
        } catch (e) {
            // File doesn't exist, ignore
        }

        // Check for requirements.txt (Python)
        try {
            const { data: requirements } = await this.octokit.repos.getContent({
                owner: repo.owner.login,
                repo: repo.name,
                path: 'requirements.txt',
            });

            if (requirements) files.push({
                path: 'requirements.txt',
                type: 'python',
                content: Buffer.from(requirements.content, 'base64').toString()
            });
        } catch (e) {
            // File doesn't exist, ignore
        }

        return files;
    }

    /**
     * Check for outdated dependencies
     */
    async checkDependencies(repo, file) {
        const outdatedDeps = [];

        if (file.type === 'npm') {
            const packageJson = JSON.parse(file.content);
            const dependencies = {
                ...packageJson.dependencies,
                ...packageJson.devDependencies
            };

            for (const [name, version] of Object.entries(dependencies)) {
                // Skip git dependencies and local paths
                if (version.includes('git') || version.startsWith('file:')) continue;

                const cleanVersion = version.replace(/[^0-9.]/g, '');
                const latestVersion = await this.getLatestNpmVersion(name);

                if (latestVersion && semver.gt(latestVersion, cleanVersion)) {
                    outdatedDeps.push({
                        name,
                        currentVersion: version,
                        latestVersion,
                        type: packageJson.dependencies?.[name] ? 'dependency' : 'devDependency',
                        updateType: this.getUpdateType(cleanVersion, latestVersion)
                    });
                }
            }
        }
        else if (file.type === 'python') {
            const lines = file.content.split('\n');

            for (const line of lines) {
                if (line.trim() === '' || line.startsWith('#')) continue;

                const match = line.match(/^([a-zA-Z0-9_.-]+)([<>=!~]+)([a-zA-Z0-9_.-]+)/);
                if (!match) continue;

                const [, name, operator, version] = match;
                const latestVersion = await this.getLatestPypiVersion(name);

                if (latestVersion && semver.gt(latestVersion, version)) {
                    outdatedDeps.push({
                        name,
                        currentVersion: `${operator}${version}`,
                        latestVersion,
                        type: 'dependency',
                        updateType: this.getUpdateType(version, latestVersion)
                    });
                }
            }
        }

        return outdatedDeps;
    }

    /**
     * Determine update type (patch, minor, major)
     */
    getUpdateType(current, latest) {
        if (semver.major(latest) > semver.major(current)) {
            return 'major';
        } else if (semver.minor(latest) > semver.minor(current)) {
            return 'minor';
        } else {
            return 'patch';
        }
    }

    /**
     * Get latest version from npm registry
     */
    async getLatestNpmVersion(packageName) {
        try {
            const response = await fetch(`https://registry.npmjs.org/${packageName}`);
            const data = await response.json();
            return data['dist-tags']?.latest;
        } catch (error) {
            console.error(`Error fetching npm version for ${packageName}:`, error);
            return null;
        }
    }

    /**
     * Get latest version from PyPI
     */
    async getLatestPypiVersion(packageName) {
        try {
            const response = await fetch(`https://pypi.org/pypi/${packageName}/json`);
            const data = await response.json();
            return data.info.version;
        } catch (error) {
            console.error(`Error fetching PyPI version for ${packageName}:`, error);
            return null;
        }
    }

    /**
     * Create PR for dependency updates using context protocol format
     */
    async createUpdatePR(repo, file, outdatedDeps) {
        const branchName = `dependency-updates-${new Date().toISOString().slice(0, 10)}`;
        const baseBranch = await this.getDefaultBranch(repo);

        // Create a new branch
        await this.createBranch(repo, branchName, baseBranch);

        // Update the file
        const updatedContent = this.updateDependenciesInFile(file, outdatedDeps);
        await this.commitFile(repo, file.path, updatedContent, branchName,
            `Update dependencies in ${file.path}`);

        // Create PR with dependency context protocol
        const prBody = this.generateContextProtocolPR(file, outdatedDeps);

        await this.octokit.pulls.create({
            owner: repo.owner.login,
            repo: repo.name,
            title: `📦 Dependency Updates (${outdatedDeps.length})`,
            body: prBody,
            head: branchName,
            base: baseBranch,
        });

        console.log(`Created PR for ${repo.full_name} with ${outdatedDeps.length} dependency updates`);
    }

    /**
     * Generate PR description using a context protocol format
     */
    generateContextProtocolPR(file, outdatedDeps) {
        // Group dependencies by update type
        const byType = {
            major: outdatedDeps.filter(d => d.updateType === 'major'),
            minor: outdatedDeps.filter(d => d.updateType === 'minor'),
            patch: outdatedDeps.filter(d => d.updateType === 'patch')
        };

        let prBody = `# Dependency Context Protocol (DCP)\n\n`;

        // Framework section
        prBody += `## 🔄 Framework\n\n`;
        prBody += `- **Tool:** Dependency Bot\n`;
        prBody += `- **File Type:** ${file.type === 'npm' ? 'Node.js (package.json)' : 'Python (requirements.txt)'}\n`;
        prBody += `- **Update Time:** ${new Date().toISOString()}\n\n`;

        // Updates summary section
        prBody += `## 📊 Updates Summary\n\n`;
        prBody += `- **Total Updates:** ${outdatedDeps.length}\n`;
        prBody += `- **Major Updates:** ${byType.major.length}\n`;
        prBody += `- **Minor Updates:** ${byType.minor.length}\n`;
        prBody += `- **Patch Updates:** ${byType.patch.length}\n\n`;

        // Risk assessment section
        const riskLevel = byType.major.length > 0 ? 'High' :
            byType.minor.length > 0 ? 'Medium' : 'Low';

        prBody += `## ⚠️ Risk Assessment\n\n`;
        prBody += `- **Overall Risk Level:** ${riskLevel}\n\n`;

        if (riskLevel === 'High') {
            prBody += `> ⚠️ **Warning:** This update contains major version changes which may include breaking changes.\n`;
            prBody += `> Please review the changelog for each dependency carefully before merging.\n\n`;
        }

        // Detailed changes section
        prBody += `## 🔍 Detailed Changes\n\n`;

        if (byType.major.length > 0) {
            prBody += `### Major Updates (Breaking Changes Possible)\n\n`;
            prBody += this.formatDependencyTable(byType.major);
        }

        if (byType.minor.length > 0) {
            prBody += `### Minor Updates (New Features)\n\n`;
            prBody += this.formatDependencyTable(byType.minor);
        }

        if (byType.patch.length > 0) {
            prBody += `### Patch Updates (Bug Fixes)\n\n`;
            prBody += this.formatDependencyTable(byType.patch);
        }

        // Testing instructions section
        prBody += `## 🧪 Testing Instructions\n\n`;
        prBody += `Please test the following before merging:\n\n`;

        if (file.type === 'npm') {
            prBody += `1. Run \`npm install\` to install updated dependencies\n`;
            prBody += `2. Run \`npm test\` to ensure all tests pass\n`;
            prBody += `3. Check any functionality that relies on the updated packages\n`;
        } else {
            prBody += `1. Run \`pip install -r requirements.txt\` to install updated dependencies\n`;
            prBody += `2. Run your test suite to ensure all tests pass\n`;
            prBody += `3. Check any functionality that relies on the updated packages\n`;
        }

        return prBody;
    }

    /**
     * Format dependency updates as a markdown table
     */
    formatDependencyTable(deps) {
        let table = `| Package | Current Version | New Version | Type | Change |\n`;
        table += `| ------- | --------------- | ----------- | ---- | ------ |\n`;

        for (const dep of deps) {
            table += `| ${dep.name} | ${dep.currentVersion} | ${dep.latestVersion} | ${dep.type} | `;

            // Add changelog link if available
            if (dep.type === 'npm') {
                table += `[View Changes](https://github.com/npm/cli/releases) |\n`;
            } else {
                table += `[View Changes](https://pypi.org/project/${dep.name}/${dep.latestVersion}/) |\n`;
            }
        }

        return table + '\n';
    }

    /**
     * Update dependencies in the file
     */
    updateDependenciesInFile(file, outdatedDeps) {
        let content = file.content;

        if (file.type === 'npm') {
            const packageJson = JSON.parse(content);

            for (const dep of outdatedDeps) {
                if (dep.type === 'dependency' && packageJson.dependencies?.[dep.name]) {
                    // Preserve version prefix (^, ~, etc.)
                    const prefix = dep.currentVersion.match(/^[^0-9]*/)?.[0] || '';
                    packageJson.dependencies[dep.name] = `${prefix}${dep.latestVersion}`;
                } else if (dep.type === 'devDependency' && packageJson.devDependencies?.[dep.name]) {
                    const prefix = dep.currentVersion.match(/^[^0-9]*/)?.[0] || '';
                    packageJson.devDependencies[dep.name] = `${prefix}${dep.latestVersion}`;
                }
            }

            return JSON.stringify(packageJson, null, 2);
        }
        else if (file.type === 'python') {
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.trim() === '' || line.startsWith('#')) continue;

                const match = line.match(/^([a-zA-Z0-9_.-]+)([<>=!~]+)([a-zA-Z0-9_.-]+)/);
                if (!match) continue;

                const [, name, operator] = match;
                const dep = outdatedDeps.find(d => d.name === name);

                if (dep) {
                    // Keep the same operator, but update the version
                    lines[i] = `${name}${operator}${dep.latestVersion}`;
                }
            }

            return lines.join('\n');
        }

        return content;
    }

    /**
     * Get default branch for a repository
     */
    async getDefaultBranch(repo) {
        const { data } = await this.octokit.repos.get({
            owner: repo.owner.login,
            repo: repo.name,
        });

        return data.default_branch;
    }

    /**
     * Create a new branch
     */
    async createBranch(repo, branchName, baseBranch) {
        // Get the SHA of the base branch
        const { data: baseRef } = await this.octokit.git.getRef({
            owner: repo.owner.login,
            repo: repo.name,
            ref: `heads/${baseBranch}`,
        });

        // Create the new branch
        await this.octokit.git.createRef({
            owner: repo.owner.login,
            repo: repo.name,
            ref: `refs/heads/${branchName}`,
            sha: baseRef.object.sha,
        });
    }

    /**
     * Commit file changes
     */
    async commitFile(repo, path, content, branch, message) {
        // Get the current file to get its SHA
        let fileSha;
        try {
            const { data: currentFile } = await this.octokit.repos.getContent({
                owner: repo.owner.login,
                repo: repo.name,
                path,
                ref: branch,
            });
            fileSha = currentFile.sha;
        } catch (e) {
            // File doesn't exist in the branch yet
        }

        // Commit the updated file
        await this.octokit.repos.createOrUpdateFileContents({
            owner: repo.owner.login,
            repo: repo.name,
            path,
            message,
            content: Buffer.from(content).toString('base64'),
            branch,
            sha: fileSha,
        });
    }
}

// Example usage
const bot = new DependencyBot({
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    installationId: process.env.GITHUB_INSTALLATION_ID,
    excludedRepos: ['owner/repo-to-exclude'],
});

bot.run().catch(console.error);