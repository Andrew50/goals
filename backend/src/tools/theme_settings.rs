use neo4rs::{query, Graph};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeSettings {
    pub theme_name: String, // "light", "dark", "green", "blue", "orange", "purple"
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            theme_name: "light".to_string(),
        }
    }
}

pub async fn get_theme_settings(graph: &Graph, user_id: i64) -> Result<ThemeSettings, String> {
    let query_str = "
        MATCH (u:User)
        WHERE id(u) = $user_id
        RETURN COALESCE(u.theme_name, 'light') as theme_name
    ";

    let mut result = graph
        .execute(query(query_str).param("user_id", user_id))
        .await
        .map_err(|e| format!("Failed to get theme settings: {}", e))?;

    if let Some(row) = result.next().await.map_err(|e| e.to_string())? {
        Ok(ThemeSettings {
            theme_name: row.get("theme_name").unwrap_or_else(|_| "light".to_string()),
        })
    } else {
        Err("User not found".to_string())
    }
}

pub async fn update_theme_settings(
    graph: &Graph,
    user_id: i64,
    settings: ThemeSettings,
) -> Result<(), String> {
    // Validate theme name
    let valid_themes = ["light", "dark", "green", "blue", "orange", "purple"];
    if !valid_themes.contains(&settings.theme_name.as_str()) {
        return Err(format!("Invalid theme name: {}", settings.theme_name));
    }

    let query_str = "
        MATCH (u:User)
        WHERE id(u) = $user_id
        SET u.theme_name = $theme_name
        RETURN u
    ";

    graph
        .run(
            query(query_str)
                .param("user_id", user_id)
                .param("theme_name", settings.theme_name),
        )
        .await
        .map_err(|e| format!("Failed to update theme settings: {}", e))?;

    Ok(())
}
