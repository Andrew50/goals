#!/bin/bash

# Goals Project Local Development Setup Script
set -e

echo "🚀 Setting up Goals project for local development..."

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     MACHINE=Linux;;
    Darwin*)    MACHINE=Mac;;
    CYGWIN*)    MACHINE=Cygwin;;
    MINGW*)     MACHINE=MinGw;;
    *)          MACHINE="UNKNOWN:${OS}"
esac

echo "🖥️  Detected OS: ${MACHINE}"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install Homebrew on macOS if not present
if [[ "$MACHINE" == "Mac" ]] && ! command_exists brew; then
    echo "🍺 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install Node.js and npm
echo "📦 Installing Node.js..."
if ! command_exists node; then
    if [[ "$MACHINE" == "Mac" ]]; then
        brew install node@20
        echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
        export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
    elif [[ "$MACHINE" == "Linux" ]]; then
        # Install Node.js via NodeSource repository
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
else
    echo "✅ Node.js already installed: $(node --version)"
fi

# Install Yarn
echo "🧶 Installing Yarn..."
if ! command_exists yarn; then
    npm install -g yarn
else
    echo "✅ Yarn already installed: $(yarn --version)"
fi

# Install Rust
echo "🦀 Installing Rust..."
if ! command_exists rustc; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source ~/.cargo/env
    echo 'source ~/.cargo/env' >> ~/.zshrc
else
    echo "✅ Rust already installed: $(rustc --version)"
fi

# Ensure Rust is in PATH for current session
if command_exists rustc; then
    echo "✅ Rust toolchain ready: $(rustc --version)"
else
    echo "⚠️  Sourcing Rust environment..."
    source ~/.cargo/env
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating a template..."
    cat > .env << EOF
# Database Configuration (configure your own Neo4j instance)
NEO4J_AUTH=neo4j/password123
NEO4J_PLUGINS=["apoc"]
DATABASE_URL=bolt://localhost:7687

# Backend Configuration
RUST_LOG=debug
HOST_URL=http://localhost

# Frontend Configuration
REACT_APP_API_URL=http://localhost:5057

# Development
NODE_ENV=development

# AI Configuration (Required for AI functionality)
GOALS_GEMINI_API_KEY=your_gemini_api_key_here

# JWT Secret (Optional - has default)
JWT_SECRET=your_jwt_secret_here
EOF
    echo "✅ Created .env template. Please update GOALS_GEMINI_API_KEY with your actual API key."
else
    echo "✅ .env file already exists"
fi

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
if [ -f package.json ]; then
    # Clean any existing node_modules and lock files to ensure fresh install
    echo "🧹 Cleaning existing dependencies..."
    rm -rf node_modules package-lock.json yarn.lock
    
    # Install all dependencies including dev dependencies
    echo "📦 Installing dependencies with npm..."
    npm install
    
    # Verify react-scripts is installed
    if [ -f node_modules/.bin/react-scripts ]; then
        echo "✅ react-scripts installed successfully"
    else
        echo "❌ react-scripts not found, trying alternative installation..."
        npm install react-scripts --save
    fi
    
    # Install Playwright browsers for E2E testing
    echo "🎭 Installing Playwright browsers..."
    npx playwright install
    
    # Verify installation by checking if key binaries exist
    if [ -f node_modules/.bin/react-scripts ] && [ -f node_modules/.bin/playwright ]; then
        echo "✅ Frontend dependencies and Playwright browsers installed successfully"
    else
        echo "⚠️  Some dependencies may not have installed correctly. Please check manually."
    fi
else
    echo "❌ No package.json found in frontend directory"
    exit 1
fi
cd ..

# Build backend and install Rust dependencies
echo "🦀 Building Rust backend and installing dependencies..."
cd backend
if [ -f Cargo.toml ]; then
    # This will download and compile all Rust dependencies
    cargo build
    echo "✅ Backend built successfully with all Rust dependencies"
else
    echo "❌ No Cargo.toml found in backend directory"
    exit 1
fi
cd ..

echo "✅ Setup complete!"
echo ""
echo "🌐 To start the development environment:"
echo ""
echo "1. Start your Neo4j database (install separately if needed)"
echo "2. Start the backend (in one terminal):"
echo "   cd backend && cargo run"
echo ""
echo "3. Start the frontend (in another terminal):"
echo "   cd frontend && yarn start"
echo ""
echo "🌐 Services will be available at:"
echo "  - Frontend: http://localhost:3000"
echo "  - Backend API: http://localhost:5057"
echo "  - Neo4j Browser: http://localhost:7474 (if running locally)"
echo ""
echo "📝 Don't forget to:"
echo "  - Install and configure Neo4j separately"
echo "  - Update your GOALS_GEMINI_API_KEY in the .env file"
echo "  - Restart your terminal or run 'source ~/.zshrc' to load new PATH variables"
echo ""
echo "🧪 To run tests:"
echo "  - Frontend unit tests: cd frontend && npm test"
echo "  - Frontend unit tests (CI mode): cd frontend && CI=true npm test"
echo "  - Frontend E2E tests: cd frontend && npm run test:e2e"
echo "  - Backend tests: cd backend && cargo test"
echo ""
echo "🔧 Troubleshooting:"
echo "  - If 'react-scripts: not found' error occurs, run: cd frontend && npm install react-scripts"
echo "  - If dependencies are missing, run: cd frontend && rm -rf node_modules && npm install" 