// dependency-bot.js
// A GitHub bot for automated dependency version bumping using a structured protocol

// Update to use ES Module syntax
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import semver from 'semver';
import yaml from 'js-yaml';
import { SecurityChecker } from './security-checker.js';

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

        // Initialize the security checker
        this.securityChecker = new SecurityChecker({
            anthropicApiKey: config.anthropicApiKey,
            reportDir: config.reportDir || './reports'
        });

        // Store target repository if specified
        this.targetRepo = config.targetRepo || null;

        // Track if we're in dry run mode
        this.dryRun = config.dryRun || false;
        
        // Initialize excluded repos
        this.excludedRepos = config.excludedRepos || [];
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
        // If a specific target repository is provided, only check that one
        if (this.targetRepo) {
            try {
                const { data: repo } = await this.octokit.repos.get({
                    owner: this.targetRepo.owner,
                    repo: this.targetRepo.repo
                });
                
                // Check if repo is archived
                if (repo.archived) {
                    console.log(`Repository ${repo.full_name} is archived. Skipping.`);
                    return [];
                }
                
                console.log(`Processing specific repository: ${repo.full_name}`);
                return [repo];
            } catch (error) {
                console.error(`Error accessing repository ${this.targetRepo.owner}/${this.targetRepo.repo}:`, error.message);
                return [];
            }
        }
        
        // Otherwise, get all repositories accessible to the installation
        const { data: repos } = await this.octokit.apps.listReposAccessibleToInstallation();
        return repos.repositories.filter(repo =>
            !repo.archived &&
            !this.excludedRepos.includes(`${repo.owner.login}/${repo.name}`)
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
            const allDependencies = [];

            for (const file of packageFiles) {
                console.log(`+++++++ checkDependencies +++++++`);
                const outdatedDeps = await this.checkDependencies(repo, file);

                if (outdatedDeps.length > 0) {
                    // Filter to only safe dependencies if not in dry run mode
                    const safeDeps = this.dryRun
                        ? outdatedDeps
                        : outdatedDeps.filter(dep => dep.securityCheck?.safe);

                    // Add to overall list for reporting
                    allDependencies.push(...outdatedDeps);

                    if (safeDeps.length > 0) {
                        await this.createUpdatePR(repo, file, safeDeps);
                    } else {
                        console.log(`No safe dependencies found to update in ${file.path}`);
                    }
                }
            }

            // Generate security report if we have dependencies to report on
            if (allDependencies.length > 0 && !this.dryRun) {
                console.log(`+++++++ Generate security report +++++++`);
                await this.securityChecker.generateReport(repo.full_name, allDependencies);
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
                const latestVersion = await this.getLatestNpmVersion(name);

                const cleanVersion = version.replace(/[^0-9.]/g, '');
                const sanitizedCurrentVersion = this.sanitizeVersion(cleanVersion);
                const sanitizedLatestVersion = this.sanitizeVersion(latestVersion);

                if (latestVersion && semver.gt(sanitizedLatestVersion, sanitizedCurrentVersion)) {
                    const depInfo = {
                        name,
                        currentVersion: version,
                        latestVersion,
                        type: packageJson.dependencies?.[name] ? 'dependency' : 'devDependency',
                        updateType: this.getUpdateType(cleanVersion, latestVersion)
                    };

                    // Check for security vulnerabilities if not in dry run mode
                    if (!this.dryRun) {
                        console.log(`Checking security for ${name} (${cleanVersion} → ${latestVersion})`);
                        depInfo.securityCheck = await this.securityChecker.checkVulnerability(
                            name, cleanVersion, latestVersion, 'npm'
                        );
                        console.log(`Security check for ${name}: ${depInfo.securityCheck.safe ? 'SAFE' : 'UNSAFE'}`);
                
                        // Log CVE details if available
                        if (depInfo.securityCheck.currentVersionVulnerabilities?.length > 0) {
                            console.log(`Found ${depInfo.securityCheck.currentVersionVulnerabilities.length} CVEs in current version`);
                        }
                        if (depInfo.securityCheck.newVersionVulnerabilities?.length > 0) {
                            console.log(`Found ${depInfo.securityCheck.newVersionVulnerabilities.length} CVEs in new version`);
                        }
                    }

                    outdatedDeps.push(depInfo);
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

                const semverCompatibleCurrent = this.makeVersionSemverCompatible(version);
                const semverCompatibleLatest = this.makeVersionSemverCompatible(latestVersion);

                try {
                    if (latestVersion && semver.gt(semverCompatibleLatest, semverCompatibleCurrent)) {
                    const depInfo = {
                        name,
                        currentVersion: `${operator}${version}`,
                        latestVersion,
                        type: 'dependency',
                        updateType: this.getUpdateType(version, latestVersion)
                    };

                    // Check for security vulnerabilities if not in dry run mode
                    if (!this.dryRun) {
                        console.log(`Checking security for ${name} (${version} → ${latestVersion})`);
                        depInfo.securityCheck = await this.securityChecker.checkVulnerability(
                            name, version, latestVersion, 'pypi'
                        );
                        console.log(`Security check for ${name}: ${depInfo.securityCheck.safe ? 'SAFE' : 'UNSAFE'}`);
                        
                        // Log CVE details if available
                        if (depInfo.securityCheck.currentVersionVulnerabilities?.length > 0) {
                            console.log(`Found ${depInfo.securityCheck.currentVersionVulnerabilities.length} CVEs in current version`);
                        }
                        if (depInfo.securityCheck.newVersionVulnerabilities?.length > 0) {
                            console.log(`Found ${depInfo.securityCheck.newVersionVulnerabilities.length} CVEs in new version`);
                        }
                    }

                    outdatedDeps.push(depInfo);
                }
                } catch (error) {
                    console.log(`Error comparing versions for ${name}: ${error.message}`);
                    console.log(`Current: ${cleanVersion} (${semverCompatibleCurrent}), Latest: ${latestVersion} (${semverCompatibleLatest})`);
                    // Skip this dependency

                }
            }
        }

        return outdatedDeps;
    }

    /**
     * Determine update type (patch, minor, major)
     */
    getUpdateType(current, latest) {
        try {
            // Sanitize version strings
            const sanitizedCurrent = this.sanitizeVersion(current);
            const sanitizedLatest = this.sanitizeVersion(latest);

            // Try to use semver to determine update type
            if (semver.valid(sanitizedCurrent) && semver.valid(sanitizedLatest)) {
                if (semver.major(sanitizedLatest) > semver.major(sanitizedCurrent)) {
                    return 'major';
                } else if (semver.minor(sanitizedLatest) > semver.minor(sanitizedCurrent)) {
                    return 'minor';
                } else {
                    return 'patch';
                }
            }

            // Fallback: manual comparison for invalid semver
            const currentParts = sanitizedCurrent.split('.').map(Number);
            const latestParts = sanitizedLatest.split('.').map(Number);

            // Pad arrays to equal length
            while (currentParts.length < 3) currentParts.push(0);
            while (latestParts.length < 3) latestParts.push(0);

            if (latestParts[0] > currentParts[0]) {
                return 'major';
            } else if (latestParts[1] > currentParts[1]) {
                return 'minor';
            } else {
                return 'patch';
            }
        } catch (error) {
            console.log(`Error determining update type: ${error.message}`);
            return 'unknown';
        }
    }

    /**
     * Get latest version from npm registry
     */
    async getLatestNpmVersion(packageName) {
        try {
            // Import fetch dynamically since Node.js may require explicit import
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(`https://registry.npmjs.org/${packageName}`);
            const data = await response.json();
            return data['dist-tags']?.latest;
        } catch (error) {
            console.error(`Error fetching npm version for ${packageName}:`, error);
            return null;
        }
    }

    // Add this helper function to the DependencyBot class
    sanitizeVersion(version) {
        if (!version) return version;

        // Remove any non-numeric or non-dot characters first
        let cleanVersion = version.replace(/[^0-9.]/g, '');

        // Handle leading zeros in version segments
        const parts = cleanVersion.split('.');
        const sanitized = parts.map(part => {
            // Remove leading zeros but keep single zero
            if (part.length > 1 && part.startsWith('0')) {
                return parseInt(part, 10).toString();
            }
            return part;
        }).join('.');

        return sanitized;
    }

    /**
     * Get latest version from PyPI
     */
    async getLatestPypiVersion(packageName) {
        try {
            // Import fetch dynamically since Node.js may require explicit import
            const fetch = (await import('node-fetch')).default;
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
     * Generate PR description using a context protocol format with detailed security information
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
        prBody += `- **Tool:** Dependency Bot with AI Security Verification\n`;
        prBody += `- **File Type:** ${file.type === 'npm' ? 'Node.js (package.json)' : 'Python (requirements.txt)'}\n`;
        prBody += `- **Update Time:** ${new Date().toISOString()}\n\n`;

        // Updates summary section
        prBody += `## 📊 Updates Summary\n\n`;
        prBody += `- **Total Updates:** ${outdatedDeps.length}\n`;
        prBody += `- **Major Updates:** ${byType.major.length}\n`;
        prBody += `- **Minor Updates:** ${byType.minor.length}\n`;
        prBody += `- **Patch Updates:** ${byType.patch.length}\n\n`;

        // Security verification section
        prBody += `## 🔒 Security Verification\n\n`;
        prBody += `All dependencies in this PR have been verified as **SAFE** by Claude AI security analysis.\n`;
        prBody += `Any dependencies with identified security concerns have been excluded from this update.\n\n`;
        
        // Count security fixes
        const securityFixCount = outdatedDeps.filter(d => 
            d.securityCheck?.currentVersionVulnerabilities?.length > 0 && 
            d.securityCheck?.newVersionVulnerabilities?.length === 0
        ).length;
        
        if (securityFixCount > 0) {
            prBody += `This update fixes **${securityFixCount}** security vulnerabilities across all dependencies.\n\n`;
        }

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
            
            // Add detailed vulnerability information for each dependency
            prBody += this.formatDetailedVulnerabilityInfo(byType.major);
        }

        if (byType.minor.length > 0) {
            prBody += `### Minor Updates (New Features)\n\n`;
            prBody += this.formatDependencyTable(byType.minor);
            
            // Add detailed vulnerability information for each dependency
            prBody += this.formatDetailedVulnerabilityInfo(byType.minor);
        }

        if (byType.patch.length > 0) {
            prBody += `### Patch Updates (Bug Fixes)\n\n`;
            prBody += this.formatDependencyTable(byType.patch);
            
            // Add detailed vulnerability information for each dependency
            prBody += this.formatDetailedVulnerabilityInfo(byType.patch);
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
     * Format dependency updates as a markdown table with CVE information
     */
    formatDependencyTable(deps) {
        let table = `| Package | Current Version | Current CVEs | New Version | New CVEs | Type | Change |\n`;
        table += `| ------- | --------------- | ------------ | ----------- | -------- | ---- | ------ |\n`;

        for (const dep of deps) {
            // Format CVE information for current version
            let currentCVEs = "None";
            if (dep.securityCheck?.currentVersionVulnerabilities?.length > 0) {
                currentCVEs = dep.securityCheck.currentVersionVulnerabilities.map(cve => 
                    `[${cve.id}](${cve.url})`
                ).join(", ");
            }
            
            // Format CVE information for new version
            let newCVEs = "None";
            if (dep.securityCheck?.newVersionVulnerabilities?.length > 0) {
                newCVEs = dep.securityCheck.newVersionVulnerabilities.map(cve => 
                    `[${cve.id}](${cve.url})`
                ).join(", ");
            }
            
            table += `| ${dep.name} | ${dep.currentVersion} | ${currentCVEs} | ${dep.latestVersion} | ${newCVEs} | ${dep.type} | `;

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
     * Format detailed vulnerability information for dependencies
     */
    formatDetailedVulnerabilityInfo(deps) {
        let details = '';
        
        // Loop through each dependency
        for (const dep of deps) {
            // Skip if no security check data is available
            if (!dep.securityCheck) continue;
            
            // Create a collapsible section for each dependency
            details += `<details>\n`;
            details += `<summary><strong>${dep.name}</strong>: ${dep.currentVersion} → ${dep.latestVersion} (${dep.updateType})</summary>\n\n`;
            
            // Current version vulnerabilities
            if (dep.securityCheck.currentVersionVulnerabilities?.length > 0) {
                details += `#### CVEs in Current Version (${dep.currentVersion})\n\n`;
                for (const cve of dep.securityCheck.currentVersionVulnerabilities) {
                    details += `- **${cve.id}** (${cve.severity}): ${cve.description}\n`;
                    details += `  - [View Details](${cve.url})\n`;
                }
                details += `\n`;
            } else {
                details += `#### Current Version (${dep.currentVersion})\n\n`;
                details += `- No known vulnerabilities found\n\n`;
            }
            
            // New version vulnerabilities
            if (dep.securityCheck.newVersionVulnerabilities?.length > 0) {
                details += `#### CVEs in New Version (${dep.latestVersion})\n\n`;
                for (const cve of dep.securityCheck.newVersionVulnerabilities) {
                    details += `- **${cve.id}** (${cve.severity}): ${cve.description}\n`;
                    details += `  - [View Details](${cve.url})\n`;
                }
                details += `\n`;
            } else {
                details += `#### New Version (${dep.latestVersion})\n\n`;
                details += `- No known vulnerabilities found\n\n`;
            }
            
            // Security improvements
            if (dep.securityCheck.securityImprovements) {
                details += `#### Security Improvements\n\n`;
                details += `${dep.securityCheck.securityImprovements}\n\n`;
            }
            
            // Overall assessment
            if (dep.securityCheck.overallAssessment) {
                details += `#### Overall Assessment\n\n`;
                details += `${dep.securityCheck.overallAssessment}\n\n`;
            }
            
            // Close the details tag
            details += `</details>\n\n`;
        }
        
        return details;
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


    /**
     * Make a version string compatible with semver
     */
    makeVersionSemverCompatible(version) {
        if (!version) return '0.0.0';

        // Remove any non-numeric or non-dot characters
        let cleanVersion = version.replace(/[^0-9.]/g, '');

        // Split into parts
        const parts = cleanVersion.split('.');

        // Remove leading zeros from each part and ensure we have at least 3 parts
        const processedParts = parts.map(part => {
            // Parse as integer to remove leading zeros, then convert back to string
            return parseInt(part, 10).toString();
        });

        // Ensure we have at least 3 parts (major.minor.patch)
        while (processedParts.length < 3) {
            processedParts.push('0');
        }

        // Join with dots to create a valid semver string
        return processedParts.join('.');
    }
}

// Export the DependencyBot class
export { DependencyBot };

// If running directly (not imported)
if (import.meta.url === import.meta.main) {
    const bot = new DependencyBot({
        appId: process.env.GITHUB_APP_ID,
        privateKey: process.env.GITHUB_PRIVATE_KEY,
        installationId: process.env.GITHUB_INSTALLATION_ID,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        excludedRepos: ['owner/repo-to-exclude'],
    });

    bot.run().catch(console.error);
}