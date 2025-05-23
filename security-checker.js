// security-checker.js
// Module to check for security vulnerabilities in dependencies using Anthropic API

import fs from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';


export class SecurityChecker {

    constructor(config) {
        this.anthropic = new Anthropic({
            apiKey: config.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
        });
        this.reportDir = config.reportDir || './reports';
    }

    /**
     * Check if a dependency has known security vulnerabilities
     * @param {string} packageName - The name of the package
     * @param {string} currentVersion - Current version in use
     * @param {string} newVersion - New version to check
     * @param {string} ecosystem - 'npm' or 'pypi'
     * @returns {Promise<{safe: boolean, details: string}>} - Results of the security check
     */
    async checkVulnerability(packageName, currentVersion, newVersion, ecosystem) {
        try {
            console.log(`Checking vulnerabilities for ${packageName} (${currentVersion} → ${newVersion})`);

            // Create the prompt for Claude
            const prompt = this.createSecurityPrompt(packageName, currentVersion, newVersion, ecosystem);

            // Call the Anthropic API
            const response = await this.anthropic.messages.create({
                model: "claude-3-opus-20240229",
                max_tokens: 1000,
                temperature: 0,
                system: "You are a security researcher specializing in software dependency analysis. Provide factual information about known security vulnerabilities in the specified package versions.",
                messages: [
                    { role: "user", content: prompt }
                ]
            });

            // Parse the response to determine if it's safe
            const analysisResult = this.parseSecurityResponse(response.content[0].text);

            return analysisResult;
        } catch (error) {
            console.error(`Error checking vulnerabilities for ${packageName}:`, error);
            // In case of API error, err on the side of caution
            return {
                safe: false,
                details: `Error checking security: ${error.message}. Skipping update as a precaution.`
            };
        }
    }

    /**
     * Creates a prompt for Claude to analyze security vulnerabilities
     */
    createSecurityPrompt(packageName, currentVersion, newVersion, ecosystem) {
        return `
I need to determine if updating ${packageName} from version ${currentVersion} to ${newVersion} in the ${ecosystem} ecosystem is safe from a security perspective.

Please provide a comprehensive security analysis with these specific details:

1. CURRENT VERSION VULNERABILITIES:
   - List all known CVEs in version ${currentVersion} of ${packageName}
   - For each CVE, provide: CVE ID, severity, brief description, and URL to the CVE details (from https://nvd.nist.gov/vuln/detail/ or other official source)

2. NEW VERSION VULNERABILITIES:
   - List all known CVEs in version ${newVersion} of ${packageName}
   - For each CVE, provide: CVE ID, severity, brief description, and URL to the CVE details

3. SECURITY IMPROVEMENT:
   - Does the update from ${currentVersion} to ${newVersion} fix any known vulnerabilities?
   - Provide URLs to any security advisories or release notes that mention security fixes

4. OVERALL ASSESSMENT:
   - Give a clear "SAFE" or "UNSAFE" recommendation based solely on security considerations
   - Provide a brief security summary explaining your recommendation

Format your response with clear sections and include URLs for all mentioned CVEs and advisories. If no vulnerabilities are found, explicitly state this.`;
    }

    /**
     * Parse Claude's response to determine if the package is safe and extract CVE details
     */
    parseSecurityResponse(responseText) {
        const lowerText = responseText.toLowerCase();

        // Look for a clear "SAFE" or "UNSAFE" indicator
        const isSafe =
            (lowerText.includes("safe") && !lowerText.includes("unsafe")) ||
            !lowerText.includes("vulnerabilit") &&
            !lowerText.includes("cve-") &&
            !lowerText.includes("security issue") &&
            !lowerText.includes("advisory");

        // Extract CVE information using regex
        const currentVersionCVEs = this.extractCVEsFromText(responseText, "CURRENT VERSION VULNERABILITIES");
        const newVersionCVEs = this.extractCVEsFromText(responseText, "NEW VERSION VULNERABILITIES");
        
        // Extract any mentioned security improvements
        const securityImprovements = this.extractSectionContent(responseText, "SECURITY IMPROVEMENT");
        
        // Extract overall assessment
        const overallAssessment = this.extractSectionContent(responseText, "OVERALL ASSESSMENT");

        return {
            safe: isSafe,
            currentVersionVulnerabilities: currentVersionCVEs,
            newVersionVulnerabilities: newVersionCVEs,
            securityImprovements: securityImprovements,
            overallAssessment: overallAssessment,
            details: responseText
        };
    }

    /**
     * Extract CVEs from a section of text
     */
    extractCVEsFromText(text, sectionTitle) {
        // Get the content of the section
        const sectionContent = this.extractSectionContent(text, sectionTitle);
        if (!sectionContent) return [];

        // Extract CVE IDs and their associated URLs
        const cvePattern = /CVE-\d{4}-\d{4,}/gi;
        const urlPattern = /(https?:\/\/[^\s]+)/g;
        
        const cves = [];
        const cveMatches = sectionContent.match(cvePattern) || [];
        const urlMatches = sectionContent.match(urlPattern) || [];
        
        // Match CVEs with their descriptions and URLs
        for (let i = 0; i < cveMatches.length; i++) {
            const cveId = cveMatches[i];
            
            // Find description by looking for text around the CVE ID
            const cveIndex = sectionContent.indexOf(cveId);
            let description = "";
            
            if (cveIndex !== -1) {
                // Try to extract a sentence or line containing the description
                const startIndex = sectionContent.lastIndexOf('.', cveIndex) + 1;
                const endIndex = sectionContent.indexOf('.', cveIndex);
                
                if (endIndex !== -1) {
                    description = sectionContent.substring(startIndex, endIndex).trim();
                }
            }
            
            // Find nearest URL (try to match URLs that appear close to this CVE)
            let url = "";
            if (urlMatches.length > 0) {
                // Simple heuristic: use the URL that appears closest to this CVE ID
                for (const match of urlMatches) {
                    if (sectionContent.indexOf(match) > cveIndex) {
                        url = match;
                        break;
                    }
                }
                
                // If no URL found after the CVE, take the nearest one before it
                if (!url && urlMatches.length > i) {
                    url = urlMatches[i];
                }
            }
            
            // Find severity by looking for common severity terms near the CVE
            const severityTerms = ["critical", "high", "medium", "low", "severity"];
            let severity = "unknown";
            
            for (const term of severityTerms) {
                const severityPattern = new RegExp(`(${term})`, 'i');
                const severityMatch = sectionContent.substring(cveIndex - 50, cveIndex + 50).match(severityPattern);
                
                if (severityMatch) {
                    severity = severityMatch[0].toLowerCase();
                    break;
                }
            }
            
            cves.push({
                id: cveId,
                url: url || `https://nvd.nist.gov/vuln/detail/${cveId}`, // Fallback URL
                description: description || "No description available",
                severity: severity
            });
        }
        
        // If no CVEs were found but there's content, report as "No known vulnerabilities"
        if (cves.length === 0 && sectionContent.length > 0) {
            if (sectionContent.toLowerCase().includes("no") && 
               (sectionContent.toLowerCase().includes("vulnerabilit") || 
                sectionContent.toLowerCase().includes("cve"))) {
                return [];
            }
        }
        
        return cves;
    }
    
    /**
     * Extract content from a section of text
     */
    extractSectionContent(text, sectionTitle) {
        const sectionPattern = new RegExp(`${sectionTitle}[:\\s]*(.*?)(?:\\n\\s*\\d+\\.|$)`, 'is');
        const match = text.match(sectionPattern);
        
        if (match && match[1]) {
            return match[1].trim();
        }
        
        return "";
    }

    /**
     * Generate a security report for a repository
     * @param {string} repoName - Repository name
     * @param {Array} dependencies - List of dependencies checked
     * @returns {Promise<string>} - Path to the report file
     */
    async generateReport(repoName, dependencies) {
        try {
            // Create reports directory if it doesn't exist
            const fullReportDir = path.resolve(this.reportDir);
            console.log(`Reports will be stored in: ${fullReportDir}`);

            await fs.mkdir(this.reportDir, { recursive: true });

            const safeRepoName = repoName.replace(/\//g, '-').replace(/[^a-zA-Z0-9-_.]/g, '');

            const timestamp = new Date().toISOString().replace(/:/g, '-');
            const reportPath = path.join(this.reportDir, `${safeRepoName}-security-report-${timestamp}.txt`);

            console.log(`Full report path: ${path.resolve(reportPath)}`);

            let reportContent = `SECURITY REPORT FOR ${repoName}\n`;
            reportContent += `Generated: ${new Date().toISOString()}\n\n`;
            reportContent += `====================================================\n\n`;

            // Group by safe/unsafe
            const safeUpdates = dependencies.filter(d => d.securityCheck?.safe);
            const unsafeUpdates = dependencies.filter(d => d.securityCheck && !d.securityCheck.safe);
            const skippedUpdates = dependencies.filter(d => !d.securityCheck);

            // Summary section
            reportContent += `SUMMARY:\n`;
            reportContent += `- Total dependencies checked: ${dependencies.length}\n`;
            reportContent += `- Safe to update: ${safeUpdates.length}\n`;
            reportContent += `- Unsafe (vulnerabilities found): ${unsafeUpdates.length}\n`;
            reportContent += `- Skipped (error or not checked): ${skippedUpdates.length}\n\n`;

            // Detailed sections
            if (unsafeUpdates.length > 0) {
                reportContent += `VULNERABLE DEPENDENCIES (NOT UPDATED):\n`;
                reportContent += `====================================================\n`;
                for (const dep of unsafeUpdates) {
                    reportContent += `Package: ${dep.name}\n`;
                    reportContent += `Current version: ${dep.currentVersion}\n`;
                    reportContent += `Latest version: ${dep.latestVersion}\n`;
                    reportContent += `Type: ${dep.type}\n`;
                    reportContent += `Update type: ${dep.updateType}\n\n`;
                    
                    // Add CVE details for current version
                    if (dep.securityCheck.currentVersionVulnerabilities && dep.securityCheck.currentVersionVulnerabilities.length > 0) {
                        reportContent += `CURRENT VERSION VULNERABILITIES:\n`;
                        for (const cve of dep.securityCheck.currentVersionVulnerabilities) {
                            reportContent += `  - ${cve.id} (${cve.severity}): ${cve.description}\n`;
                            reportContent += `    URL: ${cve.url}\n`;
                        }
                        reportContent += `\n`;
                    } else {
                        reportContent += `CURRENT VERSION VULNERABILITIES: None found\n\n`;
                    }
                    
                    // Add CVE details for new version
                    if (dep.securityCheck.newVersionVulnerabilities && dep.securityCheck.newVersionVulnerabilities.length > 0) {
                        reportContent += `NEW VERSION VULNERABILITIES:\n`;
                        for (const cve of dep.securityCheck.newVersionVulnerabilities) {
                            reportContent += `  - ${cve.id} (${cve.severity}): ${cve.description}\n`;
                            reportContent += `    URL: ${cve.url}\n`;
                        }
                        reportContent += `\n`;
                    } else {
                        reportContent += `NEW VERSION VULNERABILITIES: None found\n\n`;
                    }
                    
                    // Add security improvements
                    if (dep.securityCheck.securityImprovements) {
                        reportContent += `SECURITY IMPROVEMENTS:\n${dep.securityCheck.securityImprovements}\n\n`;
                    }
                    
                    // Add overall assessment
                    if (dep.securityCheck.overallAssessment) {
                        reportContent += `OVERALL ASSESSMENT:\n${dep.securityCheck.overallAssessment}\n\n`;
                    }
                    
                    reportContent += `FULL SECURITY DETAILS:\n${dep.securityCheck.details}\n\n`;
                    reportContent += `----------------------------------------------------\n\n`;
                }
            }

            if (safeUpdates.length > 0) {
                reportContent += `SAFE DEPENDENCIES (UPDATED):\n`;
                reportContent += `====================================================\n`;
                for (const dep of safeUpdates) {
                    reportContent += `Package: ${dep.name}\n`;
                    reportContent += `Current version: ${dep.currentVersion}\n`;
                    reportContent += `Latest version: ${dep.latestVersion}\n`;
                    reportContent += `Type: ${dep.type}\n`;
                    reportContent += `Update type: ${dep.updateType}\n\n`;
                    reportContent += `----------------------------------------------------\n\n`;
                }
            }

            if (skippedUpdates.length > 0) {
                reportContent += `SKIPPED DEPENDENCIES:\n`;
                reportContent += `====================================================\n`;
                for (const dep of skippedUpdates) {
                    reportContent += `Package: ${dep.name}\n`;
                    reportContent += `Current version: ${dep.currentVersion}\n`;
                    reportContent += `Latest version: ${dep.latestVersion}\n`;
                    reportContent += `Type: ${dep.type}\n`;
                    reportContent += `Update type: ${dep.updateType}\n`;
                    reportContent += `Reason: Security check was skipped or failed\n\n`;
                    reportContent += `----------------------------------------------------\n\n`;
                }
            }

            // Write report to file
            await fs.writeFile(reportPath, reportContent);
            console.log(`Security report generated: ${reportPath}`);

            return reportPath;
        } catch (error) {
            console.error(`Error generating report for ${repoName}:`, error);
            return null;
        }
    }
}