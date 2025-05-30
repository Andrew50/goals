mod ai;
mod jobs;
mod server;
mod tools;

fn main() {
    if let Err(e) = server::main::main() {
        eprintln!("Application error: {}", e);
        std::process::exit(1);
    }
}
