# Goals - Comprehensive Goal Management Platform

A full-featured goal planning, tracking, and scheduling application for all timeframes, from daily tasks to life goals. Enhanced with AI capabilities, it allows for the creation of calendars, daily to-do lists, and a goal hierarchy system.

## Table of Contents

- [Project Overview](#project-overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Directory Structure](#directory-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [Development Environment](#development-environment)
  - [Production Environment](#production-environment)
- [Environment Variables](#environment-variables)
- [Database Management](#database-management)
  - [Backup and Restore](#backup-and-restore)
- [API Documentation](#api-documentation)
- [Continuous Integration](#continuous-integration)
- [Deployment](#deployment)
- [Contributing](#contributing)

## Project Overview

The Goals application is designed to help users manage their goals at various levels, from daily tasks to long-term life goals. It provides an integrated platform for planning, tracking, and scheduling goals, enhanced with AI features to make goal management more efficient and effective.

## Features

- **Goal Hierarchy**: Create and manage goals at different levels, from daily tasks to life goals
- **Calendar Integration**: Schedule goals and tasks on a calendar interface
- **Daily To-Do Lists**: Create and manage daily task lists
- **Goal Visualization**: View goals in a network graph to understand relationships
- **AI Enhancement**: Get AI-powered suggestions for goal planning and execution
- **AI Assistant**: Interact with Google Gemini to get help with goals, schedule management, and more
- **Progress Tracking**: Monitor progress on goals and tasks over time

## Technology Stack

- **Frontend**: React, TypeScript, Material UI, FullCalendar
- **Backend**: Rust with Axum framework
- **Database**: Neo4j (graph database)
- **Containerization**: Docker, Docker Compose
- **Reverse Proxy**: Nginx
- **CI/CD**: GitHub Actions
- **Cloud Connectivity**: Cloudflared for secure tunneling

## Directory Structure

```
.
├── .github/           # GitHub Actions workflows for CI/CD
├── backend/           # Rust backend application
│   ├── src/           # Backend source code
│   └── Dockerfile.*   # Docker configurations for backend
├── db/                # Database configurations and scripts
│   ├── backup.sh      # Database backup script
│   └── Dockerfile.*   # Docker configurations for database
├── frontend/          # React frontend application
│   ├── public/        # Static assets
│   ├── src/           # Frontend source code
│   └── Dockerfile.*   # Docker configurations for frontend
├── router/            # Nginx configuration for routing
│   └── nginx.conf     # Nginx configuration file
├── docker-compose.dev.yaml    # Docker Compose config for development
├── docker-compose.prod.yaml   # Docker Compose config for production
└── .env               # Environment variables
```

## Prerequisites

- Docker and Docker Compose
- Git
- For development:
  - Node.js 18+ (frontend)
  - Rust (backend)

## Getting Started

### Development Environment

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd goals
   ```

2. Start the development environment:
   ```bash
   docker-compose -f docker-compose.dev.yaml -p dev up --build
   ```

3. Access the application:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5057
   - Neo4j Browser: http://localhost:7474 (username: neo4j, password: password123)

### Production Environment

1. Configure your environment variables:
   ```bash
   # Update the .env file with your production settings
   # Especially GOALS_CLOUDFLARED_TOKEN if using Cloudflare for tunneling
   ```

2. Start the production environment:
   ```bash
   docker-compose -f docker-compose.prod.yaml up -d
   ```

## Environment Variables

- `GOALS_CLOUDFLARED_TOKEN`: Token for Cloudflare tunnel (production only)
- `BACKUP_PATH`: Path for database backups (default: /home/dev/goals/backups)
- Backend environment variables (defined in Dockerfiles):
  - `NEO4J_URI`: Neo4j database connection URI
  - `NEO4J_USERNAME`: Neo4j username
  - `NEO4J_PASSWORD`: Neo4j password

## Database Management

The application uses Neo4j, a graph database, which is ideal for modeling complex relationships between goals, tasks, and other entities.

### Backup and Restore

Automated backups are configured in the production environment:

- Backups are created using the `backup.sh` script
- Backups are stored in the directory specified by `BACKUP_PATH`
- Backups older than 7 days are automatically deleted
- The backup cron job is configured in the `db/crontab` file

To manually create a backup:

```bash
docker exec -it goals_db /scripts/backup.sh
```

To restore from a backup:

```bash
# Stop the containers
docker-compose -f docker-compose.prod.yaml down

# Restore the database (replace YYYY-MM-DD_HHMMSS with the backup timestamp)
docker run --rm -v prod_goal_db:/data -v ${BACKUP_PATH}:/backups neo4j:5-community \
  neo4j-admin database restore --from-path=/backups/neo4j_dump_YYYYMMDD_HHMMSS.dump --database=neo4j

# Restart the containers
docker-compose -f docker-compose.prod.yaml up -d
```

## API Documentation

The backend API is organized into several modules:

- `/auth` - Authentication and user management
- `/goal` - Goal CRUD operations and relationship management
- `/calendar` - Calendar and event management
- `/day` - Daily planning and task management
- `/routine` - Routine management
- `/network` - Goal network visualization
- `/query` - AI assistant powered by Google Gemini with function calling capabilities