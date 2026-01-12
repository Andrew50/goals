use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::error::Error;
use tracing::{error, info};

// Embed the prompts.json file at compile time
const PROMPTS_JSON: &str = include_str!("prompts.json");

#[derive(Serialize)]
struct OpenRouterRequest {
    model: String,
    messages: Vec<Message>,
}

#[derive(Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct OpenRouterResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: MessageContent,
}

#[derive(Deserialize)]
struct MessageContent {
    content: String,
}

/// Loads the embedded prompts from prompts.json
fn load_prompts() -> Result<HashMap<String, String>, Box<dyn Error>> {
    let prompts: HashMap<String, String> = serde_json::from_str(PROMPTS_JSON)?;
    Ok(prompts)
}

/// Calls OpenRouter with a specific prompt key and input.
///
/// # Arguments
/// * `prompt_key` - The key in prompts.json to look up.
/// * `input` - The input string to replace `{{input}}` with.
///
/// # Returns
/// The text response from the model.
pub async fn call_openrouter(prompt_key: &str, input: Option<&str>) -> Result<String, Box<dyn Error + Send + Sync>> {
    let api_key = env::var("OPENROUTER_API_KEY").map_err(|_| "OPENROUTER_API_KEY not set")?;
    let model = env::var("OPENROUTER_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());
    
    // Load prompts
    let prompts = load_prompts().map_err(|e| format!("Failed to load prompts: {}", e))?;
    
    // Get the template
    let template = prompts.get(prompt_key).ok_or_else(|| format!("Prompt key '{}' not found", prompt_key))?;
    
    // Substitute input
    let prompt_content = if let Some(inp) = input {
        template.replace("{{input}}", inp)
    } else {
        template.clone()
    };

    info!(
        prompt_key = prompt_key,
        model = %model,
        "Calling OpenRouter API"
    );

    let client = reqwest::Client::new();
    let request_body = OpenRouterRequest {
        model: model.clone(),
        messages: vec![Message {
            role: "user".to_string(),
            content: prompt_content,
        }],
    };

    let resp = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        // OpenRouter optional headers for ranking
        // .header("HTTP-Referer", "https://your-site.com") 
        // .header("X-Title", "Your App Name")
        .json(&request_body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_text = resp.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        error!(
            status = %status,
            error = %err_text,
            "OpenRouter API request failed"
        );
        return Err(format!("OpenRouter API error (status {}): {}", status, err_text).into());
    }

    let response_text = resp.text().await?;
    let openrouter_resp: OpenRouterResponse = serde_json::from_str(&response_text).map_err(|e| {
        format!("Failed to parse OpenRouter response: {}. Response: {}", e, response_text)
    })?;

    if let Some(choice) = openrouter_resp.choices.first() {
        Ok(choice.message.content.clone())
    } else {
        Err("OpenRouter returned no choices".into())
    }
}



