# Dependency Context Protocol Bot

A GitHub bot that updates dependencies using a structured context protocol approach.

![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)
![Node.js](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![ESLint](https://img.shields.io/badge/ESLint-4B3263?style=for-the-badge&logo=eslint&logoColor=white)

## Overview

This bot automatically monitors repositories for outdated dependencies and creates informative pull requests using a structured Dependency Context Protocol (DCP).

Unlike standard dependency update tools, it:
- Categorizes updates by risk level (major/minor/patch)
- Provides detailed context about what's changing
- Includes testing instructions
- Uses a consistent, structured format for pull requests

## Workflow

![Workflow Diagram](https://mermaid.ink/img/pako:eNp1U8Fu2zAM_RXCpw3ItqTDDrlsCXIodi67Demh7cGxmVhYbHmSnCFL4H8f5SZ1iwGbL6Se-B5J8lm5aB1qrU9J7EmKS35O7O4BV60Poe2y-APEoOA0hcCZxaRw8nEeMZyDfwD3TmBGwKOMsYuXlbgldNLpZJ4BdIc_EXE6gVPSfgLmhCbMPwGdCTa-eDKFiEkyS7ARJ_R9J4EZ2OQdgvHy83kMD0S7h_FRuF7u-0J1w60n6MzScJ2WCbS6i1PiQD53_RK5Xzq2iRCDwsEzjnmbIMWk4OLaEMRDUfiLPAoVlB1eIcJJwVUEU3uTJVRt_Y2EvBJDDUU5Ly7hluRQqzYPHxTalPQVUOsxnmrpmkAGT16h7d6aR58rXZxOi_MZlOIXJQ0uzDTbF21eEcqqZHRKxCdA-wXMvUbxVJrZGUsTqBYuDWNstGqUunOmizbkMbEb29Fq_8I0ylYuMPkbrzZaP4dJJK-Mm1ILYxP5v5Uti_Zq8RcrdJz931o1xBjWW2eY9WOVLbBVZq3bHDJ_4jEuaS-lQxbWqjlucK_0Joc4hrzTN3eJLlKDwN_I6LusbsOQzC1u0vZ-u4GtdIZJa92v2W59jZl9eCQPutfq84zPaNZr_vYTFGvXY3Ev5LRSvz1S8H4oKUwC1ZPbz3Ivzk7ZT5npn_Qbpvs?type=png)

## Features

- **Multi-Ecosystem Support**: Handles npm (Node.js) and PyPI (Python) dependencies
- **Risk Assessment**: Automatically categorizes updates as high/medium/low risk
- **Structured PR Format**: Consistent format for all dependency update PRs
- **Detailed Changelogs**: Links to release notes for each dependency
- **Comprehensive CVE Information**: Detailed security vulnerability data with links to CVE details
- **Testing Instructions**: Specific guidance for validating changes
- **CLI Tool**: Run for specific repositories with a simple command
- **AI Security Verification**: Uses Claude AI to verify the security of dependency updates

## Setup

### 1. Create a GitHub App

1. Go to your GitHub account settings > Developer settings > GitHub Apps
2. Click "New GitHub App"
3. Set the required permissions:
    - Repository permissions:
        - Contents: Read & write
        - Pull requests: Read & write
        - Metadata: Read-only
4. Subscribe to events:
    - Push
    - Pull request
    - Repository
5. Generate and download a private key

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file with:

```
GITHUB_APP_ID=your-app-id
GITHUB_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----
GITHUB_INSTALLATION_ID=your-installation-id
ANTHROPIC_API_KEY=your-anthropic-api-key
```

You can use the included `key-helper.js` script to format your private key correctly:

```bash
node key-helper.js
```

### 4. Configure the Bot

Edit `dependency-bot.yml` to customize behavior:

```yaml
# Update strategy
updateStrategy:
  allowMajor: true
  allowMinor: true
  allowPatch: true

# Repositories to exclude
excludedRepositories:
  - owner/repo-to-exclude
```

### 5. Run Locally

#### As a Service
```bash
node index.js
```

#### As a CLI Tool
```bash
# Install CLI globally
npm install -g .

# Run the CLI tool for a specific repository
dependency-ai-bot --repo owner/repo-name

# Run in dry-run mode (no PRs created, just testing)
dependency-ai-bot --repo https://github.com/owner/repo-name --dry-run

```

### 6. Deploy with GitHub Actions

#### For monitoring all repositories:

```yaml
name: Dependency Updates

For each dependency:
Check is there is any latest dependency
Check CVE for the latest dependency
  if CVE exists:
    Look for the last SAFE dependency version
Print(Safe upgradable dependency for <dependency_name>)


Try a containerized build to verify the de 

on:
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch:

jobs:
  dependency-update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: node index.js
        env:
          GITHUB_TOKEN: ${{ secrets.DEPENDENCY_BOT_TOKEN }}
          GITHUB_APP_ID: ${{ secrets.DEPENDENCY_BOT_APP_ID }}
          GITHUB_PRIVATE_KEY: ${{ secrets.DEPENDENCY_BOT_PRIVATE_KEY }}
          GITHUB_INSTALLATION_ID: ${{ secrets.DEPENDENCY_BOT_INSTALLATION_ID }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

#### For targeting a specific repository:

```yaml
name: Dependency Updates for Specific Repo

on:
  schedule:
    - cron: '0 0 * * *'
  workflow_dispatch:
    inputs:
      repository:
        description: 'Repository to check (owner/repo or full URL)'
        required: true
        default: 'owner/repo'

jobs:
  dependency-update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: node cli.js --repo ${{ github.event.inputs.repository || 'owner/repo' }}
        env:
          GITHUB_APP_ID: ${{ secrets.DEPENDENCY_BOT_APP_ID }}
          GITHUB_PRIVATE_KEY: ${{ secrets.DEPENDENCY_BOT_PRIVATE_KEY }}
          GITHUB_INSTALLATION_ID: ${{ secrets.DEPENDENCY_BOT_INSTALLATION_ID }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Example PR

<details>
<summary>Click to see an example PR created by the bot</summary>

```markdown
# Dependency Context Protocol (DCP)

## 🔄 Framework

- **Tool:** Dependency Bot
- **File Type:** Node.js (package.json)
- **Update Time:** 2025-04-12T10:15:23.456Z

## 📊 Updates Summary

- **Total Updates:** 4
- **Major Updates:** 1
- **Minor Updates:** 2
- **Patch Updates:** 1

## ⚠️ Risk Assessment

- **Overall Risk Level:** High

> ⚠️ **Warning:** This update contains major version changes which may include breaking changes.
> Please review the changelog for each dependency carefully before merging.

## 🔍 Detailed Changes

### Major Updates (Breaking Changes Possible)

| Package | Current Version | Current CVEs | New Version | New CVEs | Type | Change |
| ------- | --------------- | ------------ | ----------- | -------- | ---- | ------ |
| express | ^4.18.2 | [CVE-2022-24999](https://nvd.nist.gov/vuln/detail/CVE-2022-24999) | ^5.0.0 | None | dependency | [View Changes](https://github.com/expressjs/express/releases) |

<details>
<summary><strong>express</strong>: ^4.18.2 → ^5.0.0 (major)</summary>

#### CVEs in Current Version (^4.18.2)

- **CVE-2022-24999** (medium): Cross-site Scripting vulnerability in express
  - [View Details](https://nvd.nist.gov/vuln/detail/CVE-2022-24999)

#### New Version (^5.0.0)

- No known vulnerabilities found

#### Security Improvements

This update fixes the CVE-2022-24999 vulnerability by implementing improved input validation and output encoding.

#### Overall Assessment

This update significantly improves security by addressing known vulnerabilities in the current version.

</details>

### Minor Updates (New Features)

| Package | Current Version | Current CVEs | New Version | New CVEs | Type | Change |
| ------- | --------------- | ------------ | ----------- | -------- | ---- | ------ |
| lodash | ^4.17.20 | [CVE-2021-23337](https://nvd.nist.gov/vuln/detail/CVE-2021-23337) | ^4.17.21 | None | dependency | [View Changes](https://github.com/lodash/lodash/releases) |
| jest | ^29.5.0 | None | ^29.7.0 | None | devDependency | [View Changes](https://github.com/facebook/jest/releases) |

<details>
<summary><strong>lodash</strong>: ^4.17.20 → ^4.17.21 (minor)</summary>

#### CVEs in Current Version (^4.17.20)

- **CVE-2021-23337** (high): Prototype Pollution vulnerability in lodash
  - [View Details](https://nvd.nist.gov/vuln/detail/CVE-2021-23337)

#### New Version (^4.17.21)

- No known vulnerabilities found

#### Security Improvements

This update fixes the CVE-2021-23337 vulnerability related to prototype pollution.

</details>

## 🧪 Testing Instructions

Please test the following before merging:

1. Run `npm install` to install updated dependencies
2. Run `npm test` to ensure all tests pass
3. Check any functionality that relies on the updated packages
```
</details>

## License

MIT

## Inspired By

This project was inspired by the [Model Context Protocol (MCP)](https://www.datacamp.com/tutorial/mcp-model-context-protocol) concept for structured prompt engineering.