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

use crate::auth;
use crate::calendar;
use crate::day;
use crate::goal::{Goal, GoalUpdate, Relationship};
use crate::list;
use crate::middleware;
use crate::network;
use crate::query;
use crate::routine;
use crate::traversal;

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

    let query_routes = Router::new()
        .route("/", post(handle_query))
        .route("/tool-execute", post(handle_tool_execute));

    // Auth routes don't need the auth middleware
    let api_routes = Router::new()
        .nest("/goals", goals_routes)
        .nest("/network", network_routes)
        .nest("/traversal", traversal_routes)
        .nest("/calendar", calendar_routes)
        .nest("/list", list_routes)
        .nest("/day", day_routes)
        .nest("/routine", routine_routes)
        .nest("/query", query_routes)
        .route_layer(from_fn(middleware::auth_middleware))
        .layer(Extension(graph.clone()))
        .layer(Extension(user_locks));

    // Combine auth routes with the rest of the API
    Router::new()
        .nest("/auth", auth_routes.layer(Extension(graph)))
        .merge(api_routes)
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
    crate::goal::create_goal_handler(graph, user_id, goal_with_user_id).await
}

async fn handle_update_goal(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
    Json(goal): Json<Goal>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::goal::update_goal_handler(graph, id, goal).await
}

async fn handle_delete_goal(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::goal::delete_goal_handler(graph, id).await
}

async fn handle_create_relationship(
    Extension(graph): Extension<Graph>,
    Json(relationship): Json<Relationship>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::goal::create_relationship_handler(graph, relationship).await
}

async fn handle_delete_relationship(
    Extension(graph): Extension<Graph>,
    Path((from_id, to_id)): Path<(i64, i64)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::goal::delete_relationship_handler(graph, from_id, to_id).await
}

async fn handle_toggle_completion(
    Extension(graph): Extension<Graph>,
    Json(update): Json<GoalUpdate>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::goal::toggle_completion(graph, update).await
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

// Query handlers
async fn handle_query(
    Extension(graph): Extension<Graph>,
    Json(request): Json<query::GeminiRequest>,
) -> impl IntoResponse {
    query::handle_query(Extension(graph), Json(request)).await
}

async fn handle_tool_execute(
    Extension(graph): Extension<Graph>,
    Json(request): Json<query::ToolExecuteRequest>,
) -> impl IntoResponse {
    query::handle_tool_execute(Extension(graph), Json(request)).await
}
