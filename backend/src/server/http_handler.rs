use axum::{
    extract::{Extension, Path, Query},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::from_fn,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono_tz::Tz;
use jsonwebtoken::{decode, DecodingKey, Validation};
use neo4rs::Graph;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::ai::query as ai_query;
use crate::jobs::routine_generator;
use crate::server::auth::{self};
use crate::server::middleware;
use crate::tools::{
    achievements, calendar, day, event, gcal_client,
    goal::{self, DuplicateOptions, ExpandTaskDateRangeRequest, Goal, ResolveGoalRequest, Relationship},
    list, migration, network, push, stats, traversal,
};

// Type alias for user locks that's used in routine processing
type UserLocks = Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>;

fn validated_tz(params: &HashMap<String, String>) -> Result<String, (StatusCode, String)> {
    let tz_raw = params
        .get("tz")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("UTC");

    let tz_raw = if tz_raw.eq_ignore_ascii_case("utc") {
        "UTC"
    } else {
        tz_raw
    };

    Tz::from_str(tz_raw)
        .map(|tz| tz.to_string())
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                format!(
                    "Invalid timezone '{}'. Expected an IANA timezone like 'America/New_York' or 'UTC'.",
                    tz_raw
                ),
            )
        })
}

pub fn create_routes(pool: Graph, user_locks: UserLocks) -> Router {
    let auth_routes = Router::new()
        .route("/signin", post(handle_signin))
        .route("/signup", post(handle_signup))
        .route("/google", get(handle_google_auth))
        .route("/callback", get(handle_google_callback))
        .route("/validate", get(handle_validate_token))
        .route("/logout", get(handle_logout));

    // Protected auth routes (require authentication)
    let auth_protected_routes = Router::new()
        .route("/google-status", get(handle_google_status))
        .route("/google-unlink", post(handle_google_unlink));

    let goal_routes = Router::new()
        .route("/create", post(handle_create_goal))
        .route("/:id", get(handle_get_goal))
        .route("/:id", put(handle_update_goal))
        .route("/:id", delete(handle_delete_goal))
        .route("/relationship", post(handle_create_relationship))
        .route("/relationship", delete(handle_delete_relationship))
        .route("/:id/resolve", put(handle_resolve_goal))
        .route("/:id/duplicate", post(handle_duplicate_goal))
        .route("/expand-date-range", post(handle_expand_task_date_range));

    let event_routes = Router::new()
        .route("/", post(handle_create_event))
        .route("/:id/complete", put(handle_complete_event))
        .route("/:id/delete", delete(handle_delete_event))
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

    let _misc_routes: Router = Router::new()
        .route("/health", get(handle_health_check))
        .route("/list", get(handle_get_list_data))
        .route("/migrate-to-events", post(handle_migrate_to_events));

    let gcal_routes = Router::new()
        .route("/calendars", get(handle_list_calendars))
        .route("/sync-from", post(handle_sync_from_gcal))
        .route("/sync-to", post(handle_sync_to_gcal))
        .route("/sync-bidirectional", post(handle_sync_bidirectional))
        .route("/event/:goal_id", delete(handle_delete_gcal_event))
        .route("/resolve-conflict", post(handle_resolve_conflict))
        .route("/reset-sync/:calendar_id", post(handle_reset_sync_state))
        .route("/settings", get(handle_get_gcal_settings))
        .route("/settings", put(handle_update_gcal_settings));

    let stats_routes = Router::new()
        .route("/", get(handle_get_stats_data))
        .route("/extended", get(handle_get_extended_stats))
        .route("/analytics", get(handle_get_event_analytics))
        .route("/effort", get(handle_get_effort_stats))
        .route("/effort/:id/children", get(handle_get_goal_children_effort))
        .route("/routines/search", get(handle_search_routines))
        .route("/routines/stats", post(handle_get_routine_stats))
        .route("/rescheduling", get(handle_get_rescheduling_stats))
        .route("/event-moves", post(handle_record_event_move));

    // Add migration route (should be protected or removed after migration)
    let migration_routes = Router::new()
        .route("/migrate-to-events", post(handle_migrate_to_events))
        .route("/remove-queues", post(handle_remove_queues))
        .route("/run", post(handle_run_migration))
        .route("/verify", get(handle_verify_migration));

    // New route group for on-demand routine event generation
    let routine_generation_routes = Router::new()
        .route("/:end_timestamp", post(handle_generate_routine_events))
        .route("/:id/recompute-future", post(handle_recompute_routine_future));

    // Push notification routes
    let push_routes = Router::new()
        .route("/subscribe", post(handle_push_subscribe))
        .route("/unsubscribe", post(handle_push_unsubscribe))
        .route("/test", post(handle_push_test))
        .route("/check-notifications", post(handle_check_notifications));

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
        .nest("/push", push_routes)
        .nest("/auth", auth_protected_routes)
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
    // Use enhanced_sign_in to get token
    match auth::enhanced_sign_in(graph, payload.username.clone(), payload.password).await {
        Ok(Json(resp)) => {
            // Build Set-Cookie header for HttpOnly session cookie
            let cookie_value = build_auth_cookie(&resp.token);
            let mut headers = HeaderMap::new();
            headers.insert(
                header::SET_COOKIE,
                HeaderValue::from_str(&cookie_value)
                    .unwrap_or_else(|_| HeaderValue::from_static("")),
            );
            Ok((StatusCode::OK, headers, Json(resp)))
        }
        Err((status, _json)) => Err(status),
    }
}

async fn handle_validate_token(
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    // Extract token from Authorization header first
    let mut token_opt = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    // Fallback to cookie if no Authorization header
    if token_opt.is_none() {
        if let Some(cookie_header) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
            for part in cookie_header.split(';') {
                let trimmed = part.trim();
                if let Some(value) = trimmed.strip_prefix("auth_token=") {
                    token_opt = Some(value.to_string());
                    break;
                }
            }
        }
    }

    let token = token_opt.ok_or(StatusCode::UNAUTHORIZED)?;
    auth::validate_token(&token).await
}

// Google OAuth handlers
async fn handle_google_auth() -> Result<impl IntoResponse, impl IntoResponse> {
    auth::generate_google_auth_url().await
}

async fn handle_google_callback(
    Extension(graph): Extension<Graph>,
    headers: axum::http::HeaderMap,
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

    // Try to extract existing session token to link Google to current user if logged in
    let mut token_opt = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    if token_opt.is_none() {
        if let Some(cookie_header) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
            for part in cookie_header.split(';') {
                let trimmed = part.trim();
                if let Some(value) = trimmed.strip_prefix("auth_token=") {
                    token_opt = Some(value.to_string());
                    break;
                }
            }
        }
    }

    let existing_user_id: Option<i64> = if let Some(token) = token_opt {
        let jwt_secret =
            std::env::var("JWT_SECRET").unwrap_or_else(|_| "default_secret".to_string());
        match decode::<auth::Claims>(
            &token,
            &DecodingKey::from_secret(jwt_secret.as_bytes()),
            &Validation::default(),
        ) {
            Ok(data) => Some(data.claims.user_id),
            Err(e) => {
                eprintln!(
                    "⚠️ [ROUTE] Failed to decode existing auth token during Google callback: {:?}",
                    e
                );
                None
            }
        }
    } else {
        None
    };

    let result =
        auth::handle_google_callback(graph, code.clone(), state.clone(), existing_user_id).await;

    match result {
        Ok(Json(resp)) => {
            eprintln!("✅ [ROUTE] Google OAuth callback completed successfully");
            let cookie_value = build_auth_cookie(&resp.token);
            let mut headers = HeaderMap::new();
            headers.insert(
                header::SET_COOKIE,
                HeaderValue::from_str(&cookie_value)
                    .unwrap_or_else(|_| HeaderValue::from_static("")),
            );
            Ok((StatusCode::OK, headers, Json(resp)))
        }
        Err((status, response)) => {
            eprintln!(
                "❌ [ROUTE] Google OAuth callback failed with status: {:?}",
                status
            );
            eprintln!("❌ [ROUTE] Error response: {:?}", response);
            Err((status, response))
        }
    }
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
    Json(relationship): Json<Relationship>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::tools::goal::delete_relationship_handler(
        graph,
        relationship.from_id,
        relationship.to_id,
    )
    .await
}

async fn handle_resolve_goal(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
    Json(request): Json<ResolveGoalRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    goal::resolve_goal_handler(graph, id, request).await
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
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    let delete_future = params
        .get("delete_future")
        .map(|v| v == "true")
        .unwrap_or(false);

    event::delete_event_handler(graph, user_id, id, delete_future).await
}

// removed split handler; replaced by duplicate goal API at /goals/:id/duplicate

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
    let start = std::time::Instant::now();
    eprintln!(
        "📡 [SMART_SCHEDULE][ROUTE] user_id={} duration={} look_ahead_days={:?} preferred_time_start={:?} preferred_time_end={:?} start_after={:?}",
        user_id,
        request.duration,
        request.look_ahead_days,
        request.preferred_time_start,
        request.preferred_time_end,
        request.start_after_timestamp
    );
    match event::get_smart_schedule_options_handler(graph, user_id, request).await {
        Ok(res) => Ok(res),
        Err((status, msg)) => {
            let elapsed = start.elapsed().as_millis();
            eprintln!(
                "❌ [SMART_SCHEDULE][ROUTE] failed status={} after {}ms message={}",
                status, elapsed, msg
            );
            Err((status, msg))
        }
    }
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
    Query(params): Query<HashMap<String, i64>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let start_timestamp = params.get("start").copied();
    let end_timestamp = params.get("end").copied();

    calendar::get_calendar_data(graph, user_id, start_timestamp, end_timestamp).await
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
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let year = params.get("year").and_then(|s| s.parse::<i32>().ok());
    let tz = validated_tz(&params)?;
    stats::get_year_stats(graph, user_id, year, tz).await
}

async fn handle_get_extended_stats(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let year = params.get("year").and_then(|s| s.parse::<i32>().ok());
    let tz = validated_tz(&params)?;
    stats::get_extended_stats(graph, user_id, year, tz).await
}

async fn handle_get_event_analytics(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let year = params.get("year").and_then(|s| s.parse::<i32>().ok());
    let tz = validated_tz(&params)?;
    stats::get_event_analytics(graph, user_id, year, tz).await
}

async fn handle_get_effort_stats(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let range = params.get("range").cloned();
    let tz = validated_tz(&params)?;
    stats::get_effort_stats(graph, user_id, range, tz).await
}

async fn handle_get_goal_children_effort(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let range = params.get("range").cloned();
    let tz = validated_tz(&params)?;
    stats::get_goal_children_effort(graph, user_id, id, range, tz).await
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
    Query(params): Query<HashMap<String, String>>,
    Json(payload): Json<serde_json::Value>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let year = params.get("year").and_then(|s| s.parse::<i32>().ok());
    let tz = validated_tz(&params)?;
    let routine_ids: Vec<i64> = payload
        .get("routine_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
        .unwrap_or_default();

    stats::get_routine_stats(graph, user_id, routine_ids, year, tz).await
}

async fn handle_get_rescheduling_stats(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let year = params.get("year").and_then(|s| s.parse::<i32>().ok());
    let tz = validated_tz(&params)?;
    stats::get_rescheduling_stats(graph, user_id, year, tz).await
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

async fn handle_remove_queues(
    Extension(graph): Extension<Graph>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    match migration::remove_queue_relationships(&graph).await {
        Ok(_) => Ok((StatusCode::OK, "Removed all QUEUE relationships")),
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

async fn handle_duplicate_goal(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
    Json(options): Json<DuplicateOptions>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    goal::duplicate_goal_handler(graph, user_id, id, options).await
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

#[derive(serde::Serialize)]
struct RecomputeResult {
    deleted: i64,
    created: i64,
}

// Recompute handler – soft-delete future events for a routine and regenerate upcoming ones
async fn handle_recompute_routine_future(
    Extension(graph): Extension<Graph>,
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let from_timestamp = params
        .get("from_timestamp")
        .and_then(|v| v.parse::<i64>().ok());

    match routine_generator::recompute_future_for_routine(&graph, id, from_timestamp).await {
        Ok((deleted, created)) => Ok((StatusCode::OK, Json(RecomputeResult { deleted, created }))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

// Helper to build HttpOnly auth cookie string
fn build_auth_cookie(token: &str) -> String {
    let host_url = std::env::var("HOST_URL").unwrap_or_else(|_| "localhost".to_string());
    let is_development = host_url == "localhost" || host_url.starts_with("127.0.0.1");
    // Cross-site XHR requires SameSite=None. In production we must also set Secure.
    // In development, many browsers still accept SameSite=None without Secure for localhost.
    let same_site = "; SameSite=None";
    let secure_attr = if is_development { "" } else { "; Secure" };

    // Default to 30 days for persistence
    let max_age_seconds = 60 * 60 * 24 * 30;

    format!(
        "auth_token={}; Max-Age={}; Path=/; HttpOnly{}{}",
        token, max_age_seconds, same_site, secure_attr
    )
}

// Google account status handler
async fn handle_google_status(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    auth::get_google_status(&graph, user_id).await
}

// Google account unlink handler
async fn handle_google_unlink(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    auth::unlink_google_account(&graph, user_id).await
}

// Logout handler clears the auth cookie
async fn handle_logout() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_static("auth_token=deleted; Max-Age=0; Path=/; HttpOnly; SameSite=None"),
    );
    (
        StatusCode::OK,
        headers,
        Json(serde_json::json!({"message": "Logged out"})),
    )
}

// Google Calendar handlers
async fn handle_list_calendars(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    gcal_client::list_calendars(&graph, user_id).await
}

async fn handle_sync_from_gcal(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<gcal_client::GCalSyncRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    eprintln!(
        "📨 [ROUTE][GCAL←] /gcal/sync-from | user={} calendar={} direction={}",
        user_id, request.calendar_id, request.sync_direction
    );
    gcal_client::sync_from_gcal(graph, user_id, &request.calendar_id).await
}

#[axum::debug_handler]
async fn handle_sync_to_gcal(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<gcal_client::GCalSyncRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    eprintln!(
        "📨 [ROUTE][GCAL→] /gcal/sync-to | user={} calendar={} direction={}",
        user_id, request.calendar_id, request.sync_direction
    );
    gcal_client::sync_to_gcal(graph, user_id, &request.calendar_id).await
}

#[axum::debug_handler]
async fn handle_sync_bidirectional(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<gcal_client::GCalSyncRequest>,
) -> Result<Json<gcal_client::SyncResult>, (StatusCode, String)> {
    eprintln!(
        "📨 [ROUTE][GCAL↔] /gcal/sync-bidirectional | user={} calendar={}",
        user_id, request.calendar_id
    );
    // Step 1: Sync from GCal to our app
    let from_gcal_result =
        match gcal_client::sync_from_gcal(graph.clone(), user_id, &request.calendar_id).await {
            Ok(Json(res)) => res,
            Err((status, msg)) => {
                // If sync_from fails, we should stop and return the error
                return Err((
                    status,
                    format!("Error during sync from Google Calendar: {}", msg),
                ));
            }
        };

    // Step 2: Sync from our app to GCal
    let to_gcal_result = match gcal_client::sync_to_gcal(graph, user_id, &request.calendar_id).await
    {
        Ok(Json(res)) => res,
        Err((_status, msg)) => {
            // Even if sync_to fails, we have still imported events.
            // It's better to return a partial success with error details.
            return Ok(Json(gcal_client::SyncResult {
                imported_events: from_gcal_result.imported_events,
                exported_events: 0,
                updated_events: from_gcal_result.updated_events, // These are updates from GCal->local
                errors: vec![format!("Error during sync to Google Calendar: {}", msg)],
                conflicts: from_gcal_result.conflicts, // Preserve conflicts from sync_from
            }));
        }
    };

    // Step 3: Combine results
    let final_result = gcal_client::SyncResult {
        imported_events: from_gcal_result.imported_events,
        exported_events: to_gcal_result.exported_events,
        // Sum updates from both directions. `updated_events` in `from_gcal` are local goals updated from GCal.
        // `updated_events` in `to_gcal` are GCal events updated from local goals.
        updated_events: from_gcal_result.updated_events + to_gcal_result.updated_events,
        errors: [from_gcal_result.errors, to_gcal_result.errors].concat(),
        conflicts: from_gcal_result.conflicts, // Conflicts only come from sync_from_gcal
    };

    Ok(Json(final_result))
}

#[axum::debug_handler]
async fn handle_delete_gcal_event(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(goal_id): Path<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    gcal_client::delete_gcal_event_handler(graph, user_id, goal_id).await
}

#[axum::debug_handler]
async fn handle_resolve_conflict(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<gcal_client::ResolveConflictRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    gcal_client::resolve_conflict_handler(graph, user_id, request).await
}

#[axum::debug_handler]
async fn handle_reset_sync_state(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(calendar_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    gcal_client::reset_sync_state_handler(graph, user_id, &calendar_id).await
}

async fn handle_get_gcal_settings(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    gcal_client::get_gcal_settings_handler(&graph, user_id).await
}

#[axum::debug_handler]
async fn handle_update_gcal_settings(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(settings): Json<gcal_client::GCalSettings>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    gcal_client::update_gcal_settings_handler(graph, user_id, settings).await
}

// Push notification handlers
async fn handle_push_subscribe(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<serde_json::Value>,
) -> Result<StatusCode, (StatusCode, String)> {
    push::save_subscription(graph, user_id, payload).await
}

async fn handle_push_unsubscribe(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<serde_json::Value>,
) -> Result<StatusCode, (StatusCode, String)> {
    push::remove_subscription(graph, user_id, payload).await
}

async fn handle_push_test(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    push::send_test_notification(graph, user_id).await
}

async fn handle_check_notifications(
    Extension(graph): Extension<Graph>,
    Extension(_user_id): Extension<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Manually trigger notification check (useful for testing)
    println!("📢 [PUSH] Manual notification check triggered");

    // Import the notification scheduler
    use crate::jobs::notification_scheduler;

    // Run the notification checks
    if let Err(e) = notification_scheduler::check_and_send_event_notifications(&graph).await {
        eprintln!("❌ [PUSH] Error during manual notification check: {}", e);
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Notification check failed: {}", e),
        ));
    }

    Ok(StatusCode::OK)
}
