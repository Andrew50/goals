use reqwest::{Client, Response, StatusCode};
use serde_json::Value;
use std::time::Duration;
use tokio::time::sleep;
use rand::Rng;

const MAX_RETRIES: u32 = 5;
const INITIAL_BACKOFF_MS: u64 = 1000; // 1 second
const MAX_BACKOFF_MS: u64 = 32000; // 32 seconds

#[derive(Debug)]
pub struct RetryClient {
    client: Client,
}

impl RetryClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Execute a GET request with exponential backoff retry
    pub async fn get_with_retry(
        &self,
        url: &str,
        token: &str,
        params: &[(String, String)],
    ) -> Result<Response, String> {
        let mut retries = 0;
        let mut backoff_ms = INITIAL_BACKOFF_MS;

        loop {
            let response = self
                .client
                .get(url)
                .bearer_auth(token)
                .query(params)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;

            let status = response.status();

            // Check if we should retry
            if should_retry(status) && retries < MAX_RETRIES {
                retries += 1;
                
                // Check for rate limit headers
                if let Some(retry_after) = response.headers().get("retry-after") {
                    if let Ok(retry_str) = retry_after.to_str() {
                        if let Ok(retry_seconds) = retry_str.parse::<u64>() {
                            eprintln!("⏳ [RETRY] Rate limited, waiting {} seconds (Retry-After header)", retry_seconds);
                            sleep(Duration::from_secs(retry_seconds)).await;
                            continue;
                        }
                    }
                }

                // Add jitter to prevent thundering herd
                let jitter = rand::thread_rng().gen_range(0..1000);
                let delay = backoff_ms + jitter;
                
                eprintln!(
                    "⏳ [RETRY] Request failed with status {}, retrying in {} ms (attempt {}/{})",
                    status, delay, retries, MAX_RETRIES
                );
                
                sleep(Duration::from_millis(delay)).await;
                
                // Exponential backoff with cap
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
            } else {
                return Ok(response);
            }
        }
    }

    /// Execute a POST request with exponential backoff retry
    pub async fn post_with_retry(
        &self,
        url: &str,
        token: &str,
        json_body: &Value,
    ) -> Result<Response, String> {
        let mut retries = 0;
        let mut backoff_ms = INITIAL_BACKOFF_MS;

        loop {
            let response = self
                .client
                .post(url)
                .bearer_auth(token)
                .json(json_body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;

            let status = response.status();

            if should_retry(status) && retries < MAX_RETRIES {
                retries += 1;
                
                // Check for rate limit headers
                if let Some(retry_after) = response.headers().get("retry-after") {
                    if let Ok(retry_str) = retry_after.to_str() {
                        if let Ok(retry_seconds) = retry_str.parse::<u64>() {
                            eprintln!("⏳ [RETRY] Rate limited, waiting {} seconds (Retry-After header)", retry_seconds);
                            sleep(Duration::from_secs(retry_seconds)).await;
                            continue;
                        }
                    }
                }

                let jitter = rand::thread_rng().gen_range(0..1000);
                let delay = backoff_ms + jitter;
                
                eprintln!(
                    "⏳ [RETRY] Request failed with status {}, retrying in {} ms (attempt {}/{})",
                    status, delay, retries, MAX_RETRIES
                );
                
                sleep(Duration::from_millis(delay)).await;
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
            } else {
                return Ok(response);
            }
        }
    }

    /// Execute a PUT request with exponential backoff retry
    pub async fn put_with_retry(
        &self,
        url: &str,
        token: &str,
        json_body: &Value,
    ) -> Result<Response, String> {
        let mut retries = 0;
        let mut backoff_ms = INITIAL_BACKOFF_MS;

        loop {
            let response = self
                .client
                .put(url)
                .bearer_auth(token)
                .json(json_body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;

            let status = response.status();

            if should_retry(status) && retries < MAX_RETRIES {
                retries += 1;
                
                // Check for rate limit headers
                if let Some(retry_after) = response.headers().get("retry-after") {
                    if let Ok(retry_str) = retry_after.to_str() {
                        if let Ok(retry_seconds) = retry_str.parse::<u64>() {
                            eprintln!("⏳ [RETRY] Rate limited, waiting {} seconds (Retry-After header)", retry_seconds);
                            sleep(Duration::from_secs(retry_seconds)).await;
                            continue;
                        }
                    }
                }

                let jitter = rand::thread_rng().gen_range(0..1000);
                let delay = backoff_ms + jitter;
                
                eprintln!(
                    "⏳ [RETRY] Request failed with status {}, retrying in {} ms (attempt {}/{})",
                    status, delay, retries, MAX_RETRIES
                );
                
                sleep(Duration::from_millis(delay)).await;
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
            } else {
                return Ok(response);
            }
        }
    }

    /// Execute a DELETE request with exponential backoff retry
    pub async fn delete_with_retry(
        &self,
        url: &str,
        token: &str,
    ) -> Result<Response, String> {
        let mut retries = 0;
        let mut backoff_ms = INITIAL_BACKOFF_MS;

        loop {
            let response = self
                .client
                .delete(url)
                .bearer_auth(token)
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;

            let status = response.status();

            if should_retry(status) && retries < MAX_RETRIES {
                retries += 1;
                
                // Check for rate limit headers
                if let Some(retry_after) = response.headers().get("retry-after") {
                    if let Ok(retry_str) = retry_after.to_str() {
                        if let Ok(retry_seconds) = retry_str.parse::<u64>() {
                            eprintln!("⏳ [RETRY] Rate limited, waiting {} seconds (Retry-After header)", retry_seconds);
                            sleep(Duration::from_secs(retry_seconds)).await;
                            continue;
                        }
                    }
                }

                let jitter = rand::thread_rng().gen_range(0..1000);
                let delay = backoff_ms + jitter;
                
                eprintln!(
                    "⏳ [RETRY] Request failed with status {}, retrying in {} ms (attempt {}/{})",
                    status, delay, retries, MAX_RETRIES
                );
                
                sleep(Duration::from_millis(delay)).await;
                backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF_MS);
            } else {
                return Ok(response);
            }
        }
    }
}

/// Determine if a status code is retryable
fn should_retry(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS  // 429
        | StatusCode::REQUEST_TIMEOUT   // 408
        | StatusCode::INTERNAL_SERVER_ERROR  // 500
        | StatusCode::BAD_GATEWAY       // 502
        | StatusCode::SERVICE_UNAVAILABLE  // 503
        | StatusCode::GATEWAY_TIMEOUT   // 504
    )
}
