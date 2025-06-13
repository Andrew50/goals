use axum::middleware::from_fn;
use axum::{
    extract::{Extension, Path, Query},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use neo4rs::Graph;
use std::collections::HashMap;
use std::env;
use std::sync::Arc;
use tokio::sync::Mutex;
use yup_oauth2::ServiceAccountKey;

use crate::ai::query as ai_query;
use crate::jobs::routine_generator;
use crate::server::auth;
use crate::server::middleware;
use crate::tools::{
    achievements, calendar, day, event,
    gcal::{self, GCalService, GCalSyncRequest, SyncResult},
    goal::{self, ExpandTaskDateRangeRequest, Goal, GoalUpdate, Relationship},
    list, migration, network, routine, stats, traversal,
};

// Type alias for user locks that's used in routine processing
type UserLocks = Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>;

pub fn create_routes(pool: Graph, user_locks: UserLocks) -> Router {
    let auth_routes = Router::new()
        .route("/signin", post(handle_signin))
        .route("/signup", post(handle_signup))
        .route("/google", get(handle_google_auth))
        .route("/callback", get(handle_google_callback))
        .route("/validate", get(handle_validate_token));

    let goal_routes = Router::new()
        .route("/create", post(handle_create_goal))
        .route("/:id", get(handle_get_goal))
        .route("/:id", put(handle_update_goal))
        .route("/:id", delete(handle_delete_goal))
        .route("/relationship", post(handle_create_relationship))
        .route("/relationship", delete(handle_delete_relationship))
        .route("/:id/complete", put(handle_complete_goal))
        .route("/expand-date-range", post(handle_expand_task_date_range));

    let event_routes = Router::new()
        .route("/", post(handle_create_event))
        .route("/:id/complete", put(handle_complete_event))
        .route("/:id/delete", delete(handle_delete_event))
        .route("/:id/split", post(handle_split_event))
        .route("/task/:id", get(handle_get_task_events))
        .route("/:id/update", put(handle_update_event))
        .route("/:id/routine-update", put(handle_update_routine_event))
        .route(
            "/:id/routine-properties",
            put(handle_update_routine_event_properties),
        )
        .route(
            "/:id/reschedule-options",
            get(handle_get_reschedule_options),
        )
        .route("/smart-schedule", post(handle_get_smart_schedule_options));

    let task_routes = Router::new()
        .route("/:id/complete", put(handle_complete_task))
        .route("/:id/uncomplete", put(handle_uncomplete_task))
        .route(
            "/:id/completion-status",
            get(handle_check_task_completion_status),
        );

    let network_routes = Router::new()
        .route("/", get(handle_get_network_data))
        .route("/:id/position", put(handle_update_node_position));

    let traversal_routes = Router::new().route("/:goal_id", get(handle_query_hierarchy));

    let calendar_routes = Router::new().route("/", get(handle_get_calendar_data));

    let list_routes = Router::new().route("/", get(handle_get_list_data));

    let day_routes = Router::new()
        .route("/", get(handle_get_day_tasks))
        .route("/complete/:id", put(handle_toggle_complete_task));

    let query_routes = Router::new().route("/ws", get(ai_query::handle_query_ws));

    let achievements_routes = Router::new().route("/", get(handle_get_achievements_data));

    let misc_routes = Router::<()>::new()
        .route("/health", get(handle_health_check))
        .route("/list", get(handle_get_list_data))
        .route("/migrate-to-events", post(handle_migrate_to_events));

    let gcal_routes = Router::new()
        .route("/sync-from", post(handle_sync_from_gcal))
        .route("/sync-to", post(handle_sync_to_gcal))
        .route("/sync-bidirectional", post(handle_sync_bidirectional));

    let stats_routes = Router::new()
        .route("/", get(handle_get_stats_data))
        .route("/extended", get(handle_get_extended_stats))
        .route("/analytics", get(handle_get_event_analytics))
        .route("/routines/search", get(handle_search_routines))
        .route("/routines/stats", post(handle_get_routine_stats))
        .route("/rescheduling", get(handle_get_rescheduling_stats))
        .route("/event-moves", post(handle_record_event_move));

    // Add migration route (should be protected or removed after migration)
    let migration_routes = Router::new()
        .route("/migrate-to-events", post(handle_migrate_to_events))
        .route("/run", post(handle_run_migration))
        .route("/verify", get(handle_verify_migration));

    // New route group for on-demand routine event generation
    let routine_generation_routes =
        Router::new().route("/:end_timestamp", post(handle_generate_routine_events));

    // Protected routes with auth middleware
    let protected_routes = Router::new()
        .nest("/goals", goal_routes)
        .nest("/events", event_routes)
        .nest("/tasks", task_routes)
        .nest("/network", network_routes)
        .nest("/traversal", traversal_routes)
        .nest("/calendar", calendar_routes)
        .nest("/list", list_routes)
        .nest("/day", day_routes)
        .nest("/query", query_routes)
        .nest("/achievements", achievements_routes)
        .nest("/gcal", gcal_routes)
        .nest("/stats", stats_routes)
        .nest("/migration", migration_routes)
        .nest("/routine", routine_generation_routes)
        .layer(from_fn(middleware::auth_middleware));

    Router::new()
        .nest("/auth", auth_routes)
        .merge(protected_routes)
        .layer(Extension(pool))
        .layer(Extension(user_locks))
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

// Google OAuth handlers
async fn handle_google_auth() -> Result<impl IntoResponse, impl IntoResponse> {
    auth::generate_google_auth_url().await
}

async fn handle_google_callback(
    Extension(graph): Extension<Graph>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    eprintln!("🌐 [ROUTE] Google OAuth callback handler called");
    eprintln!("📋 [ROUTE] Query parameters received: {:?}", params);

    let code = params.get("code").ok_or_else(|| {
        eprintln!("❌ [ROUTE] Missing authorization code parameter");
        (
            StatusCode::BAD_REQUEST,
            Json(auth::AuthResponse {
                message: "Missing authorization code".to_string(),
                token: "".to_string(),
                username: None,
            }),
        )
    })?;

    let state = params.get("state").ok_or_else(|| {
        eprintln!("❌ [ROUTE] Missing state parameter");
        (
            StatusCode::BAD_REQUEST,
            Json(auth::AuthResponse {
                message: "Missing state parameter".to_string(),
                token: "".to_string(),
                username: None,
            }),
        )
    })?;

    eprintln!("✅ [ROUTE] Both code and state parameters extracted successfully");
    eprintln!("🔄 [ROUTE] Calling auth::handle_google_callback...");

    let result = auth::handle_google_callback(graph, code.clone(), state.clone()).await;

    match &result {
        Ok(_) => eprintln!("✅ [ROUTE] Google OAuth callback completed successfully"),
        Err((status, response)) => {
            eprintln!(
                "❌ [ROUTE] Google OAuth callback failed with status: {:?}",
                status
            );
            eprintln!("❌ [ROUTE] Error response: {:?}", response);
        }
    }

    result
}

// Goal handlers
async fn handle_get_goal(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::tools::goal::get_goal_handler(graph, id).await
}

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

async fn handle_complete_goal(
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
) -> Result<impl IntoResponse, (StatusCode, String)> {
    event::create_event_handler(graph, user_id, request).await
}

async fn handle_update_event(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
    Json(request): Json<event::UpdateEventRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    event::update_event_handler(graph, user_id, id, request).await
}

async fn handle_update_routine_event(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
    Json(request): Json<event::UpdateRoutineEventRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Log the incoming request with all details
    println!(
        "🔄 [ROUTE] Routine event update request - event_id: {}, user_id: {}, scope: {}, new_timestamp: {}",
        id, user_id, request.update_scope, request.new_timestamp
    );

    match event::update_routine_event_handler(graph, user_id, id, request).await {
        Ok(events) => Ok((StatusCode::OK, Json(events.0))),
        Err((status, message)) => {
            println!(
                "❌ [ROUTE] Routine event update failed: {} - {}",
                status, message
            );
            Err((status, message))
        }
    }
}

async fn handle_update_routine_event_properties(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
    Json(request): Json<event::UpdateRoutineEventPropertiesRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    println!(
        "🔄 [ROUTE] Routine event properties update request - event_id: {}, user_id: {}, scope: {}",
        id, user_id, request.update_scope
    );

    match event::update_routine_event_properties_handler(graph, user_id, id, request).await {
        Ok(events) => Ok((StatusCode::OK, Json(events.0))),
        Err((status, message)) => {
            println!(
                "❌ [ROUTE] Routine event properties update failed: {} - {}",
                status, message
            );
            Err((status, message))
        }
    }
}

async fn handle_complete_event(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    event::complete_event_handler(graph, id).await
}

// New task completion handlers
async fn handle_complete_task(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    event::complete_task_handler(graph, id, user_id).await
}

async fn handle_uncomplete_task(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    event::uncomplete_task_handler(graph, user_id, id).await
}

async fn handle_check_task_completion_status(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    event::check_task_completion_status(graph, id).await
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
) -> Result<impl IntoResponse, (StatusCode, String)> {
    event::split_event_handler(graph, id).await
}

async fn handle_get_task_events(
    Extension(graph): Extension<Graph>,
    Path(task_id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    event::get_task_events_handler(graph, task_id).await
}

async fn handle_get_reschedule_options(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(event_id): Path<i64>,
    Query(params): Query<HashMap<String, i32>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let look_ahead_days = params.get("look_ahead_days").copied().unwrap_or(7);
    event::get_reschedule_options_handler(graph, user_id, event_id, look_ahead_days).await
}

async fn handle_get_smart_schedule_options(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<event::SmartScheduleRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    event::get_smart_schedule_options_handler(graph, user_id, request).await
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

async fn handle_get_extended_stats(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, i32>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let year = params.get("year").copied();
    stats::get_extended_stats(graph, user_id, year).await
}

async fn handle_get_event_analytics(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, i32>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let year = params.get("year").copied();
    stats::get_event_analytics(graph, user_id, year).await
}

async fn handle_search_routines(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let search_term = params.get("q").cloned().unwrap_or_default();
    stats::search_routines(graph, user_id, search_term).await
}

async fn handle_get_routine_stats(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, i32>>,
    Json(payload): Json<serde_json::Value>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let year = params.get("year").copied();
    let routine_ids: Vec<i64> = payload
        .get("routine_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
        .unwrap_or_default();

    stats::get_routine_stats(graph, user_id, routine_ids, year).await
}

async fn handle_get_rescheduling_stats(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, i32>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let year = params.get("year").copied();
    stats::get_rescheduling_stats(graph, user_id, year).await
}

async fn handle_record_event_move(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(mut event_move): Json<stats::EventMove>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    event_move.user_id = user_id; // Ensure user_id is set from authentication
    stats::record_event_move(graph, event_move).await
}

// Add this function at the end of the file
#[allow(dead_code)]
async fn handle_health_check() -> impl IntoResponse {
    StatusCode::OK
}

// Add this function at the end of the file
async fn handle_migrate_to_events(
    Extension(graph): Extension<Graph>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match migration::migrate_to_events(&graph).await {
        Ok(_) => Ok((StatusCode::OK, "Migration completed successfully")),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

async fn handle_expand_task_date_range(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<ExpandTaskDateRangeRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    goal::expand_task_date_range_handler(graph, user_id, request).await
}

// Migration management handlers
async fn handle_run_migration(
    Extension(graph): Extension<Graph>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match migration::migrate_to_events(&graph).await {
        Ok(_) => Ok((
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "success",
                "message": "Migration completed successfully"
            })),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Migration failed: {}", e),
        )),
    }
}

async fn handle_verify_migration(
    Extension(graph): Extension<Graph>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match migration::verify_migration_integrity(&graph).await {
        Ok(result) => Ok((StatusCode::OK, Json(result))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Migration verification failed: {}", e),
        )),
    }
}

// Routine generation handler – triggers creation of future events for all routines.
async fn handle_generate_routine_events(
    Extension(graph): Extension<Graph>,
    Path(_end_timestamp): Path<i64>, // Currently unused, generator creates events ahead automatically
) -> Result<StatusCode, (StatusCode, String)> {
    routine_generator::run_routine_generator(graph).await;
    Ok(StatusCode::OK)
}

// Helper function to create GCalService
async fn create_gcal_service() -> Result<GCalService, (StatusCode, String)> {
    let gcp_credentials_path = std::env::var("GCP_CREDENTIALS_PATH").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "GCP_CREDENTIALS_PATH env var not set".to_string(),
        )
    })?;

    let sa_key = yup_oauth2::read_service_account_key(&gcp_credentials_path)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to read service account key: {}", e),
            )
        })?;

    GCalService::new(sa_key).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create GCal service: {}", e),
        )
    })
}

// Google Calendar handlers
#[axum::debug_handler]
async fn handle_sync_from_gcal(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<GCalSyncRequest>,
) -> Result<Json<SyncResult>, (StatusCode, String)> {
    let gcal_service = create_gcal_service().await?;
    gcal::sync_from_gcal(graph, user_id, &gcal_service, &request.calendar_id).await
}

#[axum::debug_handler]
async fn handle_sync_to_gcal(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<GCalSyncRequest>,
) -> Result<Json<SyncResult>, (StatusCode, String)> {
    let gcal_service = create_gcal_service().await?;
    gcal::sync_to_gcal(graph, user_id, &gcal_service, &request.calendar_id).await
}

#[axum::debug_handler]
async fn handle_sync_bidirectional(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<GCalSyncRequest>,
) -> Result<Json<SyncResult>, (StatusCode, String)> {
    let gcal_service = create_gcal_service().await?;

    // Step 1: Sync from GCal to our app
    let from_gcal_result =
        match gcal::sync_from_gcal(graph.clone(), user_id, &gcal_service, &request.calendar_id)
            .await
        {
            Ok(Json(res)) => res,
            Err((_status, msg)) => {
                let mut res = SyncResult {
                    imported_events: 0,
                    exported_events: 0,
                    updated_events: 0,
                    errors: vec![],
                };
                res.errors.push(format!("Sync from GCal failed: {}", msg));
                res
            }
        };

    // Step 2: Sync from our app to GCal
    let to_gcal_result =
        match gcal::sync_to_gcal(graph, user_id, &gcal_service, &request.calendar_id).await {
            Ok(Json(res)) => res,
            Err((_status, msg)) => {
                let mut res = SyncResult {
                    imported_events: 0,
                    exported_events: 0,
                    updated_events: 0,
                    errors: vec![],
                };
                res.errors.push(format!("Sync to GCal failed: {}", msg));
                res
            }
        };

    // Step 3: Combine results
    let final_result = SyncResult {
        imported_events: from_gcal_result.imported_events,
        exported_events: to_gcal_result.exported_events,
        // Sum updates from both directions. `updated_events` in `from_gcal` are local goals updated from GCal.
        // `updated_events` in `to_gcal` are GCal events updated from local goals.
        updated_events: from_gcal_result.updated_events + to_gcal_result.updated_events,
        errors: [from_gcal_result.errors, to_gcal_result.errors].concat(),
    };

    Ok(Json(final_result))
}
