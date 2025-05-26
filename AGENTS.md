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
- **Deployment**: Docker containers with Nginx reverse proxy

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
├── db/                 # Neo4j database configuration
├── router/             # Nginx reverse proxy configuration
└── docker-compose.*.yaml # Container orchestration
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

### Docker Development Environment
```bash
# Start development environment
docker-compose -f docker-compose.dev.yaml up

# Services:
# - Frontend: http://localhost:3030
# - Backend: http://localhost:5059  
# - Neo4j: http://localhost:7474 (browser), bolt://localhost:7687
```

### Testing Strategy
- **Frontend**: Jest unit tests + Playwright E2E tests
- **Backend**: Rust unit tests with Neo4j test containers
- **Integration**: Full-stack testing with authentication
- **Timezone**: Comprehensive timezone scenario testing

### Environment Variables
```bash
# Required for AI functionality
GOALS_GEMINI_API_KEY=your_gemini_api_key

# Optional (have defaults)
JWT_SECRET=your_jwt_secret
HOST_URL=http://localhost
```

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
2. **Database Connection**: Verify Neo4j container is running
3. **CORS Errors**: Ensure frontend origin is in CORS allowlist
4. **Timezone Issues**: Check browser timezone vs server timezone
5. **AI Tool Failures**: Verify Gemini API key and rate limits

### Debug Tools
- **Browser DevTools**: Network tab for API debugging
- **Neo4j Browser**: Direct database query interface
- **Docker Logs**: Container-specific logging
- **Rust Tracing**: Structured logging in backend

## Agent-Specific Guidelines

### When Working with This Codebase
1. **Understand Goal Types**: Each type has specific validation rules and behaviors
2. **Respect Time Zones**: Always consider timezone implications for time-related operations
3. **Use Type Safety**: Leverage TypeScript types for frontend development
4. **Follow Rust Patterns**: Use Result types and proper error handling in backend
5. **Test Thoroughly**: Especially time-related and AI integration features
6. **Consider Performance**: Graph database queries can be expensive
7. **Maintain Security**: Always validate user permissions and input sanitization

### Key Files to Reference
- `frontend/src/types/goals.ts` - Core type definitions
- `backend/src/tools/goal.rs` - Goal business logic
- `backend/src/ai/tool_registry.rs` - AI tool definitions
- `frontend/src/shared/utils/time.ts` - Time handling utilities
- `docker-compose.dev.yaml` - Development environment setup

This documentation provides a comprehensive foundation for understanding and working with the Goals application codebase.

