#!/bin/bash

# Setup script for SSAI Admin Platform

set -e  # Exit on error

echo "🚀 SSAI Admin Platform Setup"
echo "================================"
echo ""

# Colors for output
GREEN='\033[0.32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "${RED}Error: wrangler CLI not found. Please install it first:${NC}"
    echo "npm install -g wrangler"
    exit 1
fi

echo "${BLUE}Step 1: Creating D1 Database...${NC}"
echo ""
echo "Run this command and note the database_id:"
echo "  wrangler d1 create ssai-admin"
echo ""
read -p "Have you created the database and updated wrangler.admin.toml with the database_id? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "${RED}Please create the database and update wrangler.admin.toml first.${NC}"
    exit 1
fi

echo ""
echo "${BLUE}Step 2: Initializing Database Schema...${NC}"
wrangler d1 execute ssai-admin --file=./schema.sql --config wrangler.admin.toml --remote

echo ""
echo "${GREEN}✓ Database initialized successfully${NC}"
echo ""

echo "${BLUE}Step 3: Setting JWT Secret...${NC}"
echo "Generate a secure random string (e.g., using: openssl rand -hex 32)"
echo ""
wrangler secret put JWT_SECRET --config wrangler.admin.toml

echo ""
echo "${GREEN}✓ JWT secret configured${NC}"
echo ""

echo "${BLUE}Step 4: Deploying Admin API...${NC}"
wrangler deploy --config wrangler.admin.toml

echo ""
echo "${GREEN}✓ Admin API deployed successfully${NC}"
echo ""

echo "${BLUE}Step 5: Setting up Frontend...${NC}"
cd admin-frontend

if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

echo ""
echo "Initializing ShadCN UI..."
echo "Please select the following options when prompted:"
echo "  - TypeScript: Yes"
echo "  - Style: Default"
echo "  - Base color: Slate"
echo "  - CSS variables: Yes"
echo ""
read -p "Press enter to continue..."
npx shadcn-ui@latest init

echo ""
echo "Installing ShadCN components..."
components=(
    "button" "card" "form" "input" "label" "select" "switch"
    "table" "tabs" "dialog" "dropdown-menu" "toast" "separator"
    "badge" "alert"
)

for component in "${components[@]}"; do
    echo "Installing $component..."
    npx shadcn-ui@latest add "$component" --yes
done

echo ""
echo "${GREEN}✓ Frontend setup complete${NC}"
echo ""

cd ..

echo ""
echo "${GREEN}════════════════════════════════════════${NC}"
echo "${GREEN}✓ Admin Platform Setup Complete!${NC}"
echo "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Start the Admin API (in one terminal):"
echo "   ${BLUE}npm run dev:admin-api${NC}"
echo ""
echo "2. Start the Frontend (in another terminal):"
echo "   ${BLUE}cd admin-frontend && npm run dev${NC}"
echo ""
echo "3. Access the platform:"
echo "   ${BLUE}http://localhost:3000${NC}"
echo ""
echo "4. Login with demo credentials:"
echo "   Email: ${BLUE}admin@demo.com${NC}"
echo "   Password: ${BLUE}demo123${NC}"
echo ""
echo "📚 Documentation:"
echo "   - ${BLUE}ADMIN_PLATFORM_GUIDE.md${NC} - Comprehensive setup guide"
echo "   - ${BLUE}schema.sql${NC} - Database schema"
echo ""

echo "${GREEN}Happy building! 🎉${NC}"

