use axum::{
    extract::{Extension, Path, Query, Request},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{from_fn, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono_tz::Tz;
use neo4rs::Graph;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::Mutex;

// use crate::ai::query as ai_query;
use crate::jobs::routine_generator;
use crate::server::auth::{self};
use crate::server::middleware;
use crate::tools::{
    achievements, autofill, calendar, day, event, gcal_client,
    goal::{self, DuplicateOptions, ExpandTaskDateRangeRequest, Goal, ResolveGoalRequest, Relationship},
    list, migration, network, notification_settings, relations, stats, telegram, theme_settings, traversal,
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
        .route("/refresh", post(handle_refresh))
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
        .route("/:id/relations", get(handle_get_goal_relations))
        .route("/:id/subgraph", get(handle_get_goal_subgraph))
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

    let calendar_routes = Router::new()
        .route("/", get(handle_get_calendar_data))
        .route("/tasks", get(handle_get_calendar_tasks));

    let list_routes = Router::new().route("/", get(handle_get_list_data));

    let day_routes = Router::new()
        .route("/", get(handle_get_day_tasks))
        .route("/complete/:id", put(handle_toggle_complete_task));

    // let query_routes = Router::new().route("/ws", get(ai_query::handle_query_ws));

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
    let telegram_routes = Router::new()
        .route("/settings", get(handle_get_telegram_settings))
        .route("/settings", put(handle_update_telegram_settings))
        .route("/test", post(handle_telegram_test));

    let notification_settings_routes = Router::new()
        .route("/settings", get(handle_get_notification_settings))
        .route("/settings", put(handle_update_notification_settings));

    let theme_settings_routes = Router::new()
        .route("/settings", get(handle_get_theme_settings))
        .route("/settings", put(handle_update_theme_settings));

    let account_routes = Router::new()
        .route("/", get(handle_get_account))
        .route("/set-password", post(handle_set_password));

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
        // .nest("/query", query_routes)
        .nest("/achievements", achievements_routes)
        .nest("/gcal", gcal_routes)
        .nest("/stats", stats_routes)
        .nest("/migration", migration_routes)
        .nest("/routine", routine_generation_routes)
        .nest("/telegram", telegram_routes)
        .nest("/notifications", notification_settings_routes)
        .nest("/theme", theme_settings_routes)
        .nest("/account", account_routes)
        .nest("/auth", auth_protected_routes)
        .route("/autofill", post(handle_autofill_suggestions))
        .layer(from_fn(invalidate_year_stats_on_mutation))
        .layer(from_fn(middleware::auth_middleware));

    Router::new()
        .nest("/auth", auth_routes)
        .merge(protected_routes)
        .layer(Extension(pool))
        .layer(Extension(user_locks))
}

fn year_stats_mutation_path(path: &str) -> bool {
    path.starts_with("/goals")
        || path.starts_with("/events")
        || path.starts_with("/tasks")
        || path.starts_with("/day")
        || path.starts_with("/routine")
        || path.starts_with("/gcal")
        || path == "/stats/event-moves"
}

async fn invalidate_year_stats_on_mutation(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let user_id = request.extensions().get::<i64>().copied();
    let response = next.run(request).await;
    let mutating = matches!(
        method,
        Method::POST | Method::PUT | Method::DELETE | Method::PATCH
    );
    if response.status().is_success() && mutating && year_stats_mutation_path(&path) {
        if let Some(user_id) = user_id {
            stats::invalidate_user_year_stats(user_id);
        }
    }
    response
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
        Ok(session) => {
            let body = auth_body("Sign-in successful", &session);
            Ok((StatusCode::OK, session_cookie_headers(&session), Json(body)))
        }
        Err((status, _json)) => Err(status),
    }
}

async fn handle_refresh(
    Extension(graph): Extension<Graph>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, impl IntoResponse> {
    let refresh = refresh_token_from_headers(&headers).unwrap_or_default();
    match auth::refresh_session(&graph, &refresh).await {
        Ok(session) => {
            let body = auth_body("Session refreshed", &session);
            Ok((StatusCode::OK, session_cookie_headers(&session), Json(body)))
        }
        Err((status, body)) => Err((status, clear_session_cookie_headers(), body)),
    }
}

async fn handle_validate_token(
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    let token = bearer_from_headers(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    auth::validate_token(&token).await
}

// Google OAuth handlers
async fn handle_google_auth(
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, Json<auth::AuthResponse>)> {
    let connect_calendar = params.get("purpose").map(|value| value.as_str()) == Some("calendar");
    if connect_calendar {
        let authorized = bearer_from_headers(&headers)
            .and_then(|token| auth::decode_access_token(&token))
            .is_some();
        if !authorized {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(auth::AuthResponse {
                    message: "Sign in before connecting Google Calendar".to_string(),
                    token: "".to_string(),
                    username: None,
                }),
            ));
        }
    }
    auth::generate_google_auth_url(connect_calendar).await
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

    let connect_calendar = params.get("purpose").map(|value| value.as_str()) == Some("calendar");
    let presented_refresh = refresh_token_from_headers(&headers);

    // After the Google redirect the access token is gone. The refresh cookie
    // identifies a user who is connecting Calendar or linking an account.
    let bearer_user_id =
        bearer_from_headers(&headers).and_then(|token| auth::decode_access_token(&token));
    let existing_user_id = if let Some(user_id) = bearer_user_id {
        Some(user_id)
    } else if let Some(refresh) = &presented_refresh {
        auth::user_id_from_refresh_token(&graph, refresh).await
    } else {
        None
    };

    let result = auth::handle_google_callback(
        graph.clone(),
        code.clone(),
        state.clone(),
        existing_user_id,
        connect_calendar,
    )
    .await;

    match result {
        Ok(session) => {
            if let Some(refresh) = presented_refresh {
                let _ = auth::revoke_refresh_token(&graph, &refresh).await;
            }
            eprintln!("✅ [ROUTE] Google OAuth callback completed successfully");
            let message = if connect_calendar {
                "Google Calendar connected"
            } else {
                "Google sign-in successful"
            };
            let body = auth_body(message, &session);
            Ok((StatusCode::OK, session_cookie_headers(&session), Json(body)))
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
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    crate::tools::goal::get_goal_handler(graph, user_id, id).await
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

async fn handle_get_goal_relations(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    relations::get_goal_relations(graph, user_id, id).await
}

async fn handle_get_goal_subgraph(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    relations::get_goal_subgraph(graph, user_id, id).await
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

    calendar::get_calendar_range(graph, user_id, start_timestamp, end_timestamp).await
}

async fn handle_get_calendar_tasks(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    calendar::get_calendar_tasks(graph, user_id).await
}

// List handlers
async fn handle_get_list_data(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, (StatusCode, String)> {
    list::get_list_data(graph, user_id, &params).await
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
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let from_timestamp = params
        .get("from_timestamp")
        .and_then(|v| v.parse::<i64>().ok());

    match routine_generator::recompute_future_for_routine(&graph, user_id, id, from_timestamp).await
    {
        Ok((deleted, created)) => Ok((StatusCode::OK, Json(RecomputeResult { deleted, created }))),
        Err(e) if e == "Routine not found" => Err((StatusCode::NOT_FOUND, e)),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

fn is_development_host() -> bool {
    let host_url = std::env::var("HOST_URL").unwrap_or_else(|_| "localhost".to_string());
    host_url == "localhost" || host_url.starts_with("127.0.0.1")
}

/// Public path of auth routes. `/auth` when the API is at the host root.
/// Production nginx mounts the API at `/api`, so set AUTH_COOKIE_PATH=/api/auth.
fn refresh_cookie_path() -> String {
    std::env::var("AUTH_COOKIE_PATH").unwrap_or_else(|_| "/auth".to_string())
}

fn lax_cookie_attrs() -> String {
    let secure = if is_development_host() { "" } else { "; Secure" };
    format!("; HttpOnly; SameSite=Lax{secure}")
}

fn build_refresh_cookie(token: &str, max_age_secs: i64) -> String {
    format!(
        "refresh_token={}; Max-Age={}; Path={}{}",
        token,
        max_age_secs,
        refresh_cookie_path(),
        lax_cookie_attrs()
    )
}

fn clear_refresh_cookie() -> String {
    format!(
        "refresh_token=; Max-Age=0; Path={}{}",
        refresh_cookie_path(),
        lax_cookie_attrs()
    )
}

fn clear_legacy_auth_cookie() -> String {
    let secure = if is_development_host() { "" } else { "; Secure" };
    format!("auth_token=; Max-Age=0; Path=/; HttpOnly; SameSite=None{secure}")
}

fn append_set_cookie(headers: &mut HeaderMap, value: String) {
    if let Ok(header_value) = HeaderValue::from_str(&value) {
        headers.append(header::SET_COOKIE, header_value);
    }
}

fn session_cookie_headers(session: &auth::IssuedSession) -> HeaderMap {
    let mut headers = HeaderMap::new();
    append_set_cookie(
        &mut headers,
        build_refresh_cookie(&session.refresh_token, session.refresh_max_age_secs),
    );
    append_set_cookie(&mut headers, clear_legacy_auth_cookie());
    headers
}

fn clear_session_cookie_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    append_set_cookie(&mut headers, clear_refresh_cookie());
    append_set_cookie(&mut headers, clear_legacy_auth_cookie());
    headers
}

fn auth_body(message: &str, session: &auth::IssuedSession) -> auth::AuthResponse {
    auth::AuthResponse {
        message: message.to_string(),
        token: session.access_token.clone(),
        username: Some(session.username.clone()),
    }
}

fn bearer_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(|value| value.to_string())
}

fn refresh_token_from_headers(headers: &HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookie_header.split(';') {
        let trimmed = part.trim();
        if let Some(value) = trimmed.strip_prefix("refresh_token=") {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
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

// Logout revokes the refresh session and clears both the new and legacy cookies.
async fn handle_logout(
    Extension(graph): Extension<Graph>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(refresh) = refresh_token_from_headers(&headers) {
        let _ = auth::revoke_refresh_token(&graph, &refresh).await;
    }
    (
        StatusCode::OK,
        clear_session_cookie_headers(),
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
// Telegram settings handlers
async fn handle_get_telegram_settings(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<telegram::TelegramSettings>, (StatusCode, String)> {
    telegram::get_telegram_settings(&graph, user_id)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn handle_update_telegram_settings(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(settings): Json<telegram::TelegramSettings>,
) -> Result<StatusCode, (StatusCode, String)> {
    telegram::save_telegram_settings(&graph, user_id, settings)
        .await
        .map(|_| StatusCode::OK)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn handle_telegram_test(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    telegram::send_test_message(&graph, user_id)
        .await
        .map(|_| StatusCode::OK)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

// Notification settings handlers
async fn handle_get_notification_settings(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<notification_settings::NotificationSettings>, (StatusCode, String)> {
    notification_settings::get_notification_settings(&graph, user_id)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn handle_update_notification_settings(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(settings): Json<notification_settings::NotificationSettings>,
) -> Result<StatusCode, (StatusCode, String)> {
    notification_settings::update_notification_settings(&graph, user_id, settings)
        .await
        .map(|_| StatusCode::OK)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

// Theme settings handlers
async fn handle_get_theme_settings(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<theme_settings::ThemeSettings>, (StatusCode, String)> {
    theme_settings::get_theme_settings(&graph, user_id)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn handle_update_theme_settings(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(settings): Json<theme_settings::ThemeSettings>,
) -> Result<StatusCode, (StatusCode, String)> {
    theme_settings::update_theme_settings(&graph, user_id, settings)
        .await
        .map(|_| StatusCode::OK)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

// Account handlers
async fn handle_get_account(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<auth::UserAccount>, (StatusCode, String)> {
    auth::get_user_account(&graph, user_id)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn handle_set_password(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<auth::SetPasswordPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    auth::set_password_for_user(&graph, user_id, payload.password)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    // Drop every refresh token, including ones that may have been stolen,
    // then issue a new session so this browser stays signed in.
    auth::revoke_all_sessions(&graph, user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let account = auth::get_user_account(&graph, user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let display = account
        .display_name
        .clone()
        .unwrap_or_else(|| account.username.clone());
    let session = auth::issue_session(&graph, user_id, &account.username, display)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let body = auth_body("Password updated", &session);
    Ok((StatusCode::OK, session_cookie_headers(&session), Json(body)))
}

async fn handle_autofill_suggestions(
    Extension(graph): Extension<Graph>,
    Extension(user_id): Extension<i64>,
    Json(request): Json<autofill::AutofillRequest>,
) -> Result<Json<autofill::AutofillResponse>, (StatusCode, String)> {
    autofill::get_autofill_suggestions(graph, user_id, request).await
}
