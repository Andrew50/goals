# Goals Application - Agent Documentation

## Project Overview

**Goals** is a comprehensive goal management application built with a modern full-stack architecture. It enables users to create, manage, and track various types of goals with AI-powered assistance through natural language queries.

### Core Purpose
- **Goal Management**: Create and organize goals in a hierarchical structure
- **Task Scheduling**: Schedule tasks with calendar integration
- **Routine Management**: Automate recurring tasks and routines
- **AI Assistant**: Natural language interface for goal management operations
- **Network Visualization**: Visual representation of goal relationships

## Architecture Overview

### Technology Stack
- **Frontend**: React 18 + TypeScript + Material-UI
- **Backend**: Rust (Axum framework)
- **Database**: Neo4j (Graph Database)
- **AI Integration**: Google Gemini 2.0 Flash
- **Authentication**: JWT tokens
- **Development**: Local installation with native runtimes

### Project Structure
```
goals/
├── frontend/           # React TypeScript application
│   ├── src/
│   │   ├── pages/      # Route components (calendar, network, list, etc.)
│   │   ├── shared/     # Reusable components, hooks, utils
│   │   └── types/      # TypeScript type definitions
│   └── tests/          # Playwright E2E tests
├── backend/            # Rust Axum server
│   └── src/
│       ├── ai/         # AI integration (Gemini API, tool registry)
│       ├── server/     # HTTP handlers, auth, middleware
│       └── tools/      # Business logic modules
├── db/                 # Neo4j database configuration (legacy Docker files)
├── router/             # Nginx reverse proxy configuration (legacy Docker files)
├── setup.sh            # Local development setup script
└── docker-compose.*.yaml # Legacy Docker files (not used in local dev)
```

## Core Domain Models

### Goal Types
The application supports 5 distinct goal types, each with specific behaviors:

1. **Directive** - High-level strategic goals
2. **Project** - Time-bound initiatives with start/end dates
3. **Achievement** - Specific accomplishments to complete
4. **Routine** - Recurring tasks with frequency patterns
5. **Task** - Individual actionable items with duration

### Goal Data Structure
```typescript
interface Goal {
    id: number;
    name: string;
    description?: string;
    goal_type: GoalType;
    priority?: 'high' | 'medium' | 'low';
    start_timestamp?: Date;
    end_timestamp?: Date;
    completed?: boolean;
    frequency?: string;           // For routines: "1D", "2W:MON,WED", etc.
    next_timestamp?: Date;        // Next occurrence for routines
    routine_name?: string;
    routine_description?: string;
    routine_type?: 'task' | 'achievement';
    routine_duration?: number;    // Minutes
    routine_time?: Date;
    scheduled_timestamp?: Date;   // For scheduled tasks
    duration?: number;            // Task duration in minutes
    position_x?: number;          // Network graph position
    position_y?: number;          // Network graph position
}
```

### Relationships
Goals can be connected through relationships:
- **Child**: Parent-child hierarchical relationships
- **Queue**: Sequential dependencies between achievements

## AI Integration Architecture

### AI Assistant Features
The application includes a sophisticated AI assistant powered by Google Gemini 2.0 Flash that can:
- Understand natural language queries about goals
- Execute tool functions to manipulate goal data
- Provide conversational responses about goal management
- Handle complex multi-step operations

### Tool Registry System
The AI has access to 14 specialized tools for goal management:

#### Goal Management Tools
1. **create_goal** - Creates new goals with validation
2. **update_goal** - Updates existing goal properties
3. **delete_goal** - Removes goals from the system
4. **toggle_completion** - Marks goals as complete/incomplete

#### Relationship Management
5. **create_relationship** - Links goals with parent/child or queue relationships
6. **delete_relationship** - Removes connections between goals

#### Data Retrieval Tools
7. **get_network_data** - Fetches complete goal network for visualization
8. **get_calendar_data** - Retrieves calendar-formatted goal data
9. **get_list_data** - Gets list view of goals
10. **get_day_tasks** - Fetches tasks for specific date ranges
11. **query_hierarchy** - Traverses goal hierarchies from a root goal

#### Specialized Operations
12. **update_node_position** - Updates goal positions in network graph
13. **toggle_complete_task** - Toggles task completion status
14. **process_user_routines** - Processes and updates user routines

### AI Communication Flow
1. **WebSocket Connection**: Real-time bidirectional communication
2. **Message Types**:
   - `UserQuery`: Natural language input from user
   - `AssistantText`: AI response text
   - `ToolCall`: Function execution notification
   - `ToolResult`: Function execution results
   - `Error`: Error messages

3. **Processing Loop**:
   - User sends natural language query
   - Gemini processes query and determines if tools are needed
   - Tools execute against Neo4j database
   - Results feed back to Gemini for natural language response
   - Continues until query is fully resolved

## Database Schema (Neo4j)

### Node Types
- **User**: User accounts with authentication
- **Goal**: All goal types stored as single node type with properties

### Relationships
- **CHILD**: Hierarchical parent-child relationships
- **QUEUE**: Sequential dependencies between achievements

### Key Properties
- Goals store all type-specific data as node properties
- Timestamps stored as Unix milliseconds (i64)
- User isolation through user_id property
- Position data for network visualization

## Authentication & Security

### JWT Authentication
- **Token Storage**: localStorage in frontend
- **Token Validation**: Middleware on all protected routes
- **Token Transmission**: Authorization header or query parameter (WebSocket)
- **Expiration**: 24-hour token lifetime

### Security Features
- Password hashing with bcrypt
- CORS configuration for cross-origin requests
- User isolation in database queries
- Protected route middleware

## Frontend Architecture

### Page Structure
- **Calendar**: FullCalendar integration for scheduled tasks and routines
- **Network**: vis-network graph visualization of goal relationships
- **List**: Tabular view of all goals with filtering
- **Day**: Daily task management interface
- **Query**: AI assistant chat interface
- **Auth**: Sign-in/sign-up pages

### State Management
- React Context for authentication state
- Local component state with custom hooks
- History state management for undo/redo functionality

### Key Components
- **GoalMenu**: Modal for creating/editing goals
- **GoalRelations**: Relationship management interface
- **ProtectedRoute**: Authentication wrapper component

## Backend Architecture

### Axum Web Framework
- **Routing**: Modular route organization by feature
- **Middleware**: Authentication, CORS, logging
- **Extensions**: Dependency injection for database and user locks

### Business Logic Modules
- **goal.rs**: Core goal CRUD operations
- **calendar.rs**: Calendar data formatting
- **network.rs**: Network graph data preparation
- **routine.rs**: Routine processing and scheduling
- **day.rs**: Daily task management
- **traversal.rs**: Goal hierarchy queries

### Concurrency Management
- **User Locks**: Prevents concurrent routine processing per user
- **Async/Await**: Non-blocking I/O operations
- **Connection Pooling**: Efficient database connection management

## Time & Timezone Handling

### Critical Time Considerations
- **Frontend**: Uses JavaScript Date objects in user timezone
- **Backend**: Stores Unix timestamps (UTC milliseconds)
- **Conversion**: Automatic conversion between frontend/backend
- **DST Handling**: Comprehensive timezone transition support
- **Testing**: Extensive timezone testing with mocking utilities

### Time-Related Fields
- `start_timestamp`: Goal start time
- `end_timestamp`: Goal end time  
- `scheduled_timestamp`: When task is scheduled
- `next_timestamp`: Next occurrence for routines
- `routine_time`: Time of day for routine execution

## Development & Testing

### Local Development Environment

#### Initial Setup
```bash
# Run the setup script to install all dependencies
./setup.sh

# The script will install:
# - Node.js 20 and Yarn
# - Rust (latest stable)
# - All frontend dependencies (including Playwright for E2E testing)
# - All backend Rust dependencies
# Note: Neo4j database needs to be installed and configured separately
```

#### Database Setup (Neo4j)
Neo4j needs to be installed separately. Choose one of these options:

**Option 1: Local Installation**
```bash
# macOS
brew install neo4j
brew services start neo4j
neo4j-admin dbms set-initial-password password123

# Linux (Ubuntu/Debian)
wget -O - https://debian.neo4j.com/neotechnology.gpg.key | sudo apt-key add -
echo 'deb https://debian.neo4j.com stable latest' | sudo tee -a /etc/apt/sources.list.d/neo4j.list
sudo apt-get update
sudo apt-get install neo4j
sudo systemctl start neo4j
sudo neo4j-admin dbms set-initial-password password123
```

**Option 2: Docker (if preferred)**
```bash
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password123 \
  neo4j:latest
```

**Option 3: Neo4j Desktop**
- Download and install Neo4j Desktop
- Create a new database with password `password123`
- Start the database

#### Starting the Development Environment
```bash
# Ensure Neo4j is running (check http://localhost:7474)

# Terminal 1: Start the backend
cd backend
cargo run

# Terminal 2: Start the frontend  
cd frontend
npm start

# Services will be available at:
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:5057
# - Neo4j Browser: http://localhost:7474 (neo4j/password123)
```

#### Post-Setup Reminders
After running the setup script, don't forget to:
- **Install and configure Neo4j separately** (see Database Setup section above)
- **Update your GOALS_GEMINI_API_KEY** in the .env file with your actual API key
- **Restart your terminal** or run `source ~/.zshrc` to load new PATH variables

#### Setup Script Details
The setup script (`./setup.sh`) performs the following operations:
- **OS Detection**: Automatically detects macOS, Linux, or other platforms
- **Homebrew Installation**: Installs Homebrew on macOS if not present
- **Node.js 20 Installation**: Via Homebrew (macOS) or NodeSource repository (Linux)
- **Yarn Installation**: Global installation via npm
- **Rust Installation**: Latest stable toolchain via rustup
- **Environment Setup**: Creates .env template with all required variables
- **Frontend Dependencies**: Clean installation with npm, including react-scripts verification
- **Playwright Setup**: Installs browsers for E2E testing
- **Backend Dependencies**: Compiles Rust project and downloads all crates

### Testing Strategy
- **Frontend**: Jest unit tests + Playwright E2E tests
- **Backend**: Rust unit tests with local Neo4j instance
- **Integration**: Full-stack testing with authentication
- **Timezone**: Comprehensive timezone scenario testing

#### Running Tests
```bash
# Frontend unit tests
cd frontend
npm test

# Frontend unit tests (CI mode)
cd frontend
CI=true npm test

# Frontend E2E tests (requires running backend and Neo4j)
cd frontend
npm run test:e2e

# Backend tests
cd backend
cargo test

# Specific test suites
cd frontend
npm run test:calendar      # Calendar-specific E2E tests
npm run test:timezone      # Timezone-related E2E tests
```

### Environment Variables
The setup script creates a comprehensive .env template with all required configuration:

```bash
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
```

**Required Variables:**
- `GOALS_GEMINI_API_KEY`: Your Google Gemini API key for AI functionality

**Auto-configured Variables:**
- `DATABASE_URL`, `NEO4J_AUTH`: Set up for local Neo4j instance
- `REACT_APP_API_URL`, `HOST_URL`: Configured for local development ports

**Optional Variables:**
- `JWT_SECRET`: Has secure default if not specified
- `RUST_LOG`: Controls backend logging level

### Development Dependencies

#### System Requirements
- **Node.js**: 20.x (installed by setup script)
- **Rust**: Latest stable (installed by setup script)
- **Neo4j**: Latest stable (install separately - see Database Setup section)
- **Yarn**: Package manager (installed by setup script)
- **Playwright**: E2E testing framework (installed by setup script)

#### Platform Support
- **macOS**: Full support via Homebrew
- **Linux**: Ubuntu/Debian support via package managers
- **Windows**: Manual installation required (setup script supports WSL)

#### What the Setup Script Installs
- **Node.js 20** and **Yarn** package manager
- **Rust toolchain** (rustc, cargo, etc.)
- **All frontend dependencies** from package.json
- **Playwright browsers** for E2E testing
- **All Rust crates** and dependencies for the backend
- **Environment configuration** (.env template)

## API Endpoints

### Authentication
- `POST /auth/signup` - User registration
- `POST /auth/signin` - User login
- `GET /auth/validate` - Token validation

### Goal Management
- `POST /goals/create` - Create new goal
- `PUT /goals/:id` - Update goal
- `DELETE /goals/:id` - Delete goal
- `PUT /goals/:id/complete` - Toggle completion

### Relationships
- `POST /goals/relationship` - Create relationship
- `DELETE /goals/relationship/:from_id/:to_id` - Delete relationship

### Data Views
- `GET /network` - Network graph data
- `GET /calendar` - Calendar view data
- `GET /list` - List view data
- `GET /day` - Daily tasks
- `GET /traversal/:goal_id` - Goal hierarchy

### AI Interface
- `GET /query/ws` - WebSocket connection for AI chat

## Common Development Patterns

### Error Handling
- **Frontend**: Try-catch with user-friendly error messages
- **Backend**: Result types with HTTP status codes
- **Database**: Transaction rollback on failures

### Data Flow
1. **User Action** → Frontend component
2. **API Call** → Backend endpoint
3. **Database Query** → Neo4j operations
4. **Response** → JSON data back to frontend
5. **State Update** → React component re-render

### Validation
- **Frontend**: Real-time validation with Material-UI
- **Backend**: Comprehensive validation before database operations
- **Database**: Constraint enforcement at schema level

## Performance Considerations

### Frontend Optimizations
- **Code Splitting**: Route-based lazy loading
- **Memoization**: React.memo and useMemo for expensive operations
- **Debouncing**: Search and filter operations

### Backend Optimizations
- **Connection Pooling**: Efficient database connections
- **Async Processing**: Non-blocking operations
- **Caching**: Strategic caching of frequently accessed data

### Database Optimizations
- **Indexing**: Proper Neo4j indexes on frequently queried properties
- **Query Optimization**: Efficient Cypher queries
- **Relationship Traversal**: Optimized graph traversal patterns

## Troubleshooting Guide

### Common Issues
1. **Authentication Failures**: Check JWT_SECRET consistency
2. **Database Connection**: Verify Neo4j is running (`brew services list` or `systemctl status neo4j`)
3. **Port Conflicts**: Ensure ports 3000, 5057, 7474, 7687 are available
4. **Timezone Issues**: Check browser timezone vs server timezone
5. **AI Tool Failures**: Verify Gemini API key and rate limits
6. **Rust Compilation**: Ensure Rust toolchain is properly installed and updated
7. **react-scripts not found**: Run `cd frontend && npm install react-scripts` to fix missing react-scripts
8. **Missing Dependencies**: Run `cd frontend && rm -rf node_modules && npm install` for clean dependency reinstall

### Debug Tools
- **Browser DevTools**: Network tab for API debugging
- **Neo4j Browser**: Direct database query interface at http://localhost:7474
- **Cargo Logs**: `RUST_LOG=debug cargo run` for detailed backend logging
- **Frontend Logs**: React DevTools and browser console

### Service Management
```bash
# Check if services are running
lsof -i :3000  # Frontend
lsof -i :5057  # Backend
lsof -i :7474  # Neo4j HTTP
lsof -i :7687  # Neo4j Bolt

# Restart Neo4j if needed
brew services restart neo4j  # macOS
sudo systemctl restart neo4j  # Linux

# Clear Neo4j data (development only)
# macOS: rm -rf /opt/homebrew/var/neo4j/data/databases/*
# Linux: sudo rm -rf /var/lib/neo4j/data/databases/*
```

## Agent-Specific Guidelines

### When Working with This Codebase
1. **Understand Goal Types**: Each type has specific validation rules and behaviors
2. **Respect Time Zones**: Always consider timezone implications for time-related operations
3. **Use Type Safety**: Leverage TypeScript types for frontend development
4. **Follow Rust Patterns**: Use Result types and proper error handling in backend
5. **Test Thoroughly**: Especially time-related and AI integration features
6. **Consider Performance**: Graph database queries can be expensive
7. **Maintain Security**: Always validate user permissions and input sanitization
8. **Local Development**: Use native runtimes instead of Docker for faster development cycles

### Key Files to Reference
- `frontend/src/types/goals.ts` - Core type definitions
- `backend/src/tools/goal.rs` - Goal business logic
- `backend/src/ai/tool_registry.rs` - AI tool definitions
- `frontend/src/shared/utils/time.ts` - Time handling utilities
- `setup.sh` - Local development environment setup
- `.env` - Environment configuration

### Development Workflow
1. **Initial Setup**: Run `./setup.sh` once to install all dependencies
2. **Daily Development**: Start backend with `cd backend && cargo run`, frontend with `cd frontend && yarn start`
3. **Testing**: Run unit tests frequently, E2E tests before commits
4. **Database**: Use Neo4j Browser for direct database inspection and queries
5. **AI Development**: Ensure GOALS_GEMINI_API_KEY is set for AI functionality testing

This documentation provides a comprehensive foundation for understanding and working with the Goals application codebase in a local development environment.

