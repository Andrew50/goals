use neo4rs::{query, Graph};

use crate::tools::gcal_client;

/// Run periodic Google Calendar sync for all users with auto-sync enabled
pub async fn run_gcal_sync(graph: Graph) {
    println!("📅 [GCAL_SYNC] Starting scheduled Google Calendar sync...");

    // Find all users with gcal_auto_sync_enabled = true and valid Google tokens
    let users_query = query(
        "MATCH (u:User) 
         WHERE u.gcal_auto_sync_enabled = true 
         AND u.google_refresh_token IS NOT NULL
         RETURN id(u) as user_id, u.gcal_default_calendar_id as calendar_id, u.google_email as email",
    );

    let mut result = match graph.execute(users_query).await {
        Ok(result) => result,
        Err(e) => {
            eprintln!("❌ [GCAL_SYNC] Failed to query users for auto-sync: {}", e);
            return;
        }
    };

    let mut sync_count = 0;
    let mut error_count = 0;

    while let Ok(Some(row)) = result.next().await {
        let user_id: i64 = match row.get("user_id") {
            Ok(id) => id,
            Err(_) => continue,
        };

        let calendar_id: String = row
            .get("calendar_id")
            .unwrap_or_else(|_| "primary".to_string());

        let email: String = row
            .get("email")
            .unwrap_or_else(|_| format!("user_{}", user_id));

        eprintln!(
            "🔄 [GCAL_SYNC] Syncing for user {} ({}) calendar={}",
            user_id, email, calendar_id
        );

        // Run bidirectional sync for this user
        match sync_user_calendar(&graph, user_id, &calendar_id).await {
            Ok(result) => {
                sync_count += 1;
                eprintln!(
                    "✅ [GCAL_SYNC] User {} sync complete: imported={}, exported={}, updated={}, conflicts={}, errors={}",
                    user_id,
                    result.imported_events,
                    result.exported_events,
                    result.updated_events,
                    result.conflicts.len(),
                    result.errors.len()
                );
            }
            Err(e) => {
                error_count += 1;
                eprintln!("❌ [GCAL_SYNC] User {} sync failed: {}", user_id, e);
            }
        }
    }

    println!(
        "📅 [GCAL_SYNC] Scheduled sync complete: {} users synced, {} errors",
        sync_count, error_count
    );
}

/// Sync a single user's calendar (bidirectional)
async fn sync_user_calendar(
    graph: &Graph,
    user_id: i64,
    calendar_id: &str,
) -> Result<gcal_client::SyncResult, String> {
    // First sync from GCal to local
    let from_result = gcal_client::sync_from_gcal(graph.clone(), user_id, calendar_id)
        .await
        .map_err(|(_, msg)| msg)?;

    // Then sync from local to GCal
    let to_result = gcal_client::sync_to_gcal(graph.clone(), user_id, calendar_id)
        .await
        .map_err(|(_, msg)| msg)?;

    // Combine results
    Ok(gcal_client::SyncResult {
        imported_events: from_result.0.imported_events,
        exported_events: to_result.0.exported_events,
        updated_events: from_result.0.updated_events + to_result.0.updated_events,
        errors: [from_result.0.errors, to_result.0.errors].concat(),
        conflicts: from_result.0.conflicts,
    })
}






