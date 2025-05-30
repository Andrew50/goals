use axum::{
    extract::{Extension, Json, Path, Query},
    http::StatusCode,
    middleware::from_fn,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Router,
};
use neo4rs::Graph;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::ai::query;
use crate::server::auth;
use crate::server::middleware;
use crate::tools::achievements;
use crate::tools::calendar;
use crate::tools::day;
use crate::tools::event;
use crate::tools::goal::{Goal, GoalUpdate, Relationship};
use crate::tools::list;
use crate::tools::migration;
use crate::tools::network;
use crate::tools::routine;
use crate::tools::stats;
use crate::tools::traversal;

// Type alias for user locks that's used in routine processing
type UserLocks = Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>;

pub fn create_routes(graph: Graph, user_locks: UserLocks) -> Router {
    let auth_routes = Router::new()
        .route("/signup", post(handle_signup))
        .route("/signin", post(handle_signin))
        .route("/validate", get(handle_validate_token));

    let goals_routes = Router::new()
        .route("/create", post(handle_create_goal))
        .route("/:id", put(handle_update_goal))
        .route("/:id", delete(handle_delete_goal))
        .route("/relationship", post(handle_create_relationship))
        .route(
            "/relationship/:from_id/:to_id",
            delete(handle_delete_relationship),
        )
        .route("/:id/complete", put(handle_toggle_completion));

    let event_routes = Router::new()
        .route("/", post(handle_create_event))
        .route("/:id/complete", put(handle_complete_event))
        .route("/:id", delete(handle_delete_event))
        .route("/:id/split", post(handle_split_event));

    let network_routes = Router::new()
        .route("/", get(handle_get_network_data))
        .route("/:id/position", put(handle_update_node_position));

    let traversal_routes = Router::new().route("/:goal_id", get(handle_query_hierarchy));

    let calendar_routes = Router::new().route("/", get(handle_get_calendar_data));

    let list_routes = Router::new().route("/", get(handle_get_list_data));

    let day_routes = Router::new()
        .route("/", get(handle_get_day_tasks))
        .route("/complete/:id", put(handle_toggle_complete_task));

    let routine_routes = Router::new().route("/:timestamp", post(handle_process_user_routines));

    let query_routes = Router::new().route("/ws", get(query::handle_query_ws));

    let achievements_routes = Router::new().route("/", get(handle_get_achievements_data));

    let stats_routes = Router::new().route("/", get(handle_get_stats_data));

    // Add migration route (should be protected or removed after migration)
    let migration_routes = Router::new()
        .route("/migrate-to-events", post(handle_migrate_to_events));

    // Auth routes don't need the auth middleware
    let api_routes = Router::new()
        .nest("/goals", goals_routes)
        .nest("/events", event_routes)
        .nest("/network", network_routes)
        .nest("/traversal", traversal_routes)
        .nest("/calendar", calendar_routes)
        .nest("/list", list_routes)
        .nest("/day", day_routes)
        .nest("/routine", routine_routes)
        .nest("/query", query_routes)
        .nest("/achievements", achievements_routes)
        .nest("/stats", stats_routes)
        .nest("/migration", migration_routes)
        .route_layer(from_fn(middleware::auth_middleware))
        .layer(Extension(graph.clone()))
        .layer(Extension(user_locks));

    // Combine auth routes with the rest of the API
    Router::new()
        .nest("/auth", auth_routes.layer(Extension(graph)))
        .merge(api_routes)
        // Add health check endpoint that doesn't require auth
        .route("/health", get(handle_health_check))
}

// Auth handlers
async fn handle_signup(
    Extension(graph): Extension<Graph>,
    Json(payload): Json<auth::AuthPayload>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    auth::sign_up(graph, payload.username, payload.password).await
}

async fn handle_signin(
    Extension(graph): Extension<Graph>,
    Json(payload): Json<auth::AuthPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    auth::sign_in(graph, payload.username, payload.password).await
}

async fn handle_validate_token(
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    // Extract token from Authorization header
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    auth::validate_token(token).await
}

// Goal handlers
async fn handle_create_goal(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(goal): Json<Goal>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let goal_with_user_id = Goal {
        user_id: Some(user_id),
        ..goal
    };
    crate::tools::goal::create_goal_handler(graph, user_id, goal_with_user_id).await
}

async fn handle_update_goal(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
    Json(goal): Json<Goal>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::tools::goal::update_goal_handler(graph, id, goal).await
}

async fn handle_delete_goal(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::tools::goal::delete_goal_handler(graph, id).await
}

async fn handle_create_relationship(
    Extension(graph): Extension<Graph>,
    Json(relationship): Json<Relationship>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::tools::goal::create_relationship_handler(graph, relationship).await
}

async fn handle_delete_relationship(
    Extension(graph): Extension<Graph>,
    Path((from_id, to_id)): Path<(i64, i64)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::tools::goal::delete_relationship_handler(graph, from_id, to_id).await
}

async fn handle_toggle_completion(
    Extension(graph): Extension<Graph>,
    Json(update): Json<GoalUpdate>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::tools::goal::toggle_completion(graph, update).await
}

// Event handlers
async fn handle_create_event(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<event::CreateEventRequest>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    event::create_event_handler(graph, user_id, request).await
}

async fn handle_complete_event(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    event::complete_event_handler(graph, id).await
}

async fn handle_delete_event(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    let delete_future = params
        .get("delete_future")
        .map(|v| v == "true")
        .unwrap_or(false);
    
    event::delete_event_handler(graph, id, delete_future).await
}

async fn handle_split_event(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    event::split_event_handler(graph, id).await
}

// Network handlers
async fn handle_get_network_data(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    network::get_network_data(graph, user_id).await
}

async fn handle_update_node_position(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
    Json(position): Json<network::PositionUpdate>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    network::update_node_position(graph, id, position.x, position.y).await
}

// Traversal handlers
async fn handle_query_hierarchy(
    Path(goal_id): Path<i64>,
    Extension(graph): Extension<Graph>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    traversal::query_hierarchy_handler(graph, goal_id).await
}

// Calendar handlers
async fn handle_get_calendar_data(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    calendar::get_calendar_data(graph, user_id).await
}

// List handlers
async fn handle_get_list_data(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    list::get_list_data(graph, user_id).await
}

// Day handlers
async fn handle_get_day_tasks(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, i64>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let start_timestamp = params.get("start").copied();
    let end_timestamp = params.get("end").copied();

    day::get_day_tasks(graph, user_id, start_timestamp, end_timestamp).await
}

async fn handle_toggle_complete_task(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    day::toggle_complete_task(graph, id).await
}

// Routine handlers
async fn handle_process_user_routines(
    Path(user_eod_timestamp): Path<i64>,
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Extension(user_locks): Extension<UserLocks>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    routine::process_user_routines(user_eod_timestamp, graph, user_id, user_locks).await
}

// Achievements handlers
async fn handle_get_achievements_data(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    achievements::get_achievements_data(graph, user_id).await
}

// Stats handlers
async fn handle_get_stats_data(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, i32>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let year = params.get("year").copied();
    stats::get_year_stats(graph, user_id, year).await
}

// Add this function at the end of the file
async fn handle_health_check() -> impl IntoResponse {
    StatusCode::OK
}

// Add this function at the end of the file
async fn handle_migrate_to_events(
    Extension(graph): Extension<Graph>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match migration::migrate_to_events(&graph).await {
        Ok(_) => Ok((StatusCode::OK, "Migration completed successfully")),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e))
    }
}
