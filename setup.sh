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

# Install Neo4j
echo "🗄️  Installing Neo4j..."
if ! command_exists neo4j; then
    if [[ "$MACHINE" == "Mac" ]]; then
        brew install neo4j
    elif [[ "$MACHINE" == "Linux" ]]; then
        # Add Neo4j repository and install
        wget -O - https://debian.neo4j.com/neotechnology.gpg.key | sudo apt-key add -
        echo 'deb https://debian.neo4j.com stable latest' | sudo tee -a /etc/apt/sources.list.d/neo4j.list
        sudo apt-get update
        sudo apt-get install neo4j
    fi
else
    echo "✅ Neo4j already installed"
fi

# Configure Neo4j
echo "⚙️  Configuring Neo4j..."
if [[ "$MACHINE" == "Mac" ]]; then
    NEO4J_CONF="/opt/homebrew/var/neo4j/conf/neo4j.conf"
    NEO4J_HOME="/opt/homebrew/var/neo4j"
elif [[ "$MACHINE" == "Linux" ]]; then
    NEO4J_CONF="/etc/neo4j/neo4j.conf"
    NEO4J_HOME="/var/lib/neo4j"
fi

# Set Neo4j initial password
echo "🔐 Setting Neo4j password..."
if [[ "$MACHINE" == "Mac" ]]; then
    neo4j-admin dbms set-initial-password password123 || echo "Password may already be set"
elif [[ "$MACHINE" == "Linux" ]]; then
    sudo neo4j-admin dbms set-initial-password password123 || echo "Password may already be set"
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating a template..."
    cat > .env << EOF
# Database Configuration
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
    yarn install
    echo "✅ Frontend dependencies installed"
else
    echo "❌ No package.json found in frontend directory"
    exit 1
fi
cd ..

# Build backend
echo "🦀 Building Rust backend..."
cd backend
cargo build
echo "✅ Backend built successfully"
cd ..

# Start Neo4j
echo "🗄️  Starting Neo4j..."
if [[ "$MACHINE" == "Mac" ]]; then
    brew services start neo4j
elif [[ "$MACHINE" == "Linux" ]]; then
    sudo systemctl start neo4j
    sudo systemctl enable neo4j
fi

# Wait for Neo4j to start
echo "⏳ Waiting for Neo4j to start..."
sleep 10

echo "✅ Setup complete!"
echo ""
echo "🌐 To start the development environment:"
echo ""
echo "1. Start the backend (in one terminal):"
echo "   cd backend && cargo run"
echo ""
echo "2. Start the frontend (in another terminal):"
echo "   cd frontend && yarn start"
echo ""
echo "🌐 Services will be available at:"
echo "  - Frontend: http://localhost:3000"
echo "  - Backend API: http://localhost:5057"
echo "  - Neo4j Browser: http://localhost:7474 (username: neo4j, password: password123)"
echo ""
echo "📝 Don't forget to:"
echo "  - Update your GOALS_GEMINI_API_KEY in the .env file"
echo "  - Restart your terminal or run 'source ~/.zshrc' to load new PATH variables"
echo ""
echo "🛑 To stop Neo4j:"
if [[ "$MACHINE" == "Mac" ]]; then
    echo "   brew services stop neo4j"
elif [[ "$MACHINE" == "Linux" ]]; then
    echo "   sudo systemctl stop neo4j"
fi 