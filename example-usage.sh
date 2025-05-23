#!/bin/bash

# example-usage.sh - Example commands for using the dependency-ai-bot CLI
# Make this script executable with: chmod +x example-usage.sh

# Set colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Dependency AI Bot CLI Usage Examples ===${NC}\n"

# Ensure .env file exists
if [ ! -f .env ]; then
  echo -e "${YELLOW}Warning: .env file not found. The examples below will fail without proper credentials.${NC}"
  echo -e "Create a .env file with your GitHub App and Anthropic API credentials first.\n"
fi

echo -e "${GREEN}1. Basic usage with repository name${NC}"
echo -e "npx dependency-ai-bot --repo owner/repo-name\n"

echo -e "${GREEN}2. Using a full GitHub URL${NC}"
echo -e "npx dependency-ai-bot --repo https://github.com/owner/repo-name\n"

echo -e "${GREEN}3. Run in dry-run mode (no PRs created)${NC}"
echo -e "npx dependency-ai-bot --repo owner/repo-name --dry-run\n"

echo -e "${GREEN}4. Install globally and use from anywhere${NC}"
echo -e "npm install -g ."
echo -e "dependency-ai-bot --repo owner/repo-name\n"

echo -e "${YELLOW}Running example (dry-run mode)...${NC}"
echo -e "Press Ctrl+C to cancel or any key to continue"
read -n 1 -s

# Execute a real example with --dry-run flag
node cli.js --repo codeWithUtkarsh/dependency-ai-bot --dry-run

echo -e "\n\n${BLUE}For more information, check the README.md file${NC}"