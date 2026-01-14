// AI is currently disabled (query pipeline not wired up).
// Keep these modules around for later, but don't compile them in normal builds
// to avoid dead_code warnings in Docker logs.
// pub mod query;
// pub mod tool_registry;
pub mod openrouter;
