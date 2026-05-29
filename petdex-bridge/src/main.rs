use std::{env, fs, path::PathBuf, process::ExitCode};

use clap::{Parser, Subcommand};
use serde::Serialize;
use thiserror::Error;

const DEFAULT_PORT: u16 = 7777;
const DATA_DIR_ENV: &str = "BUDDY_DATA_DIR";
const TOKEN_ENV: &str = "BUDDY_TOKEN";
const PORT_ENV: &str = "BUDDY_PORT";
const SOURCE: &str = "claude-code";

#[derive(Debug, Parser)]
#[command(
    name = "petdex-bridge",
    about = "WSL bridge that sends buddy pet state updates to the Windows sidecar"
)]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, PartialEq, Subcommand)]
enum Command {
    /// Send a state update to the buddy sidecar.
    State { name: String },
}

#[derive(Debug, Error)]
enum BridgeError {
    #[error("state name cannot be empty")]
    EmptyState,

    #[error("BUDDY_PORT must be a TCP port number from 1 to 65535")]
    InvalidPort,

    #[error("HOME is not set; cannot resolve ~/.petdex-win/runtime/update-token")]
    MissingHome,

    #[error(
        "update token not found at {path}. Start buddy on Windows, then symlink/copy the Windows .petdex-win directory to WSL or set BUDDY_DATA_DIR. Set BUDDY_TOKEN to override."
    )]
    MissingToken { path: String },

    #[error("sidecar rejected the token (HTTP 401). Restart buddy or refresh the WSL token copy.")]
    Unauthorized,

    #[error("buddy sidecar returned HTTP {status}: {body}")]
    HttpStatus { status: u16, body: String },

    #[error("could not connect to buddy sidecar at {url}. Start buddy or verify WSL localhost passthrough.")]
    Connection { url: String },

    #[error("failed to send state update: {0}")]
    Transport(String),

    #[error("failed to serialize state payload: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Serialize, PartialEq)]
struct StatePayload<'a> {
    state: &'a str,
    source: &'a str,
}

fn main() -> ExitCode {
    match run(Args::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("petdex-bridge: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Args) -> Result<(), BridgeError> {
    match args.command {
        Command::State { name } => send_state(name.trim()),
    }
}

fn send_state(state: &str) -> Result<(), BridgeError> {
    if state.is_empty() {
        return Err(BridgeError::EmptyState);
    }

    let token = read_token()?;
    let url = state_url(buddy_port()?);
    let payload = build_payload(state);
    let body = serde_json::to_string(&payload)?;

    post_state(&url, &token, &body)?;
    println!("state updated: {state}");
    Ok(())
}

fn build_payload(state: &str) -> StatePayload<'_> {
    StatePayload {
        state,
        source: SOURCE,
    }
}

fn buddy_port() -> Result<u16, BridgeError> {
    match env::var(PORT_ENV) {
        Ok(raw) if raw.trim().is_empty() => Ok(DEFAULT_PORT),
        Ok(raw) => parse_port(&raw),
        Err(_) => Ok(DEFAULT_PORT),
    }
}

fn parse_port(raw: &str) -> Result<u16, BridgeError> {
    match raw.parse::<u16>() {
        Ok(0) => Err(BridgeError::InvalidPort),
        Ok(port) => Ok(port),
        Err(_) => Err(BridgeError::InvalidPort),
    }
}

fn state_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/state")
}

fn data_dir() -> Result<PathBuf, BridgeError> {
    if let Ok(raw) = env::var(DATA_DIR_ENV) {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let home = env::var("HOME").map_err(|_| BridgeError::MissingHome)?;
    Ok(PathBuf::from(home).join(".petdex-win"))
}

fn token_path() -> Result<PathBuf, BridgeError> {
    Ok(data_dir()?.join("runtime").join("update-token"))
}

fn read_token() -> Result<String, BridgeError> {
    if let Ok(token) = env::var(TOKEN_ENV) {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_owned());
        }
    }

    let path = token_path()?;
    let token = fs::read_to_string(&path).map_err(|_| BridgeError::MissingToken {
        path: path.display().to_string(),
    })?;
    let token = token.trim().to_owned();
    if token.is_empty() {
        return Err(BridgeError::MissingToken {
            path: path.display().to_string(),
        });
    }
    Ok(token)
}

fn post_state(url: &str, token: &str, body: &str) -> Result<(), BridgeError> {
    match ureq::post(url)
        .set("Content-Type", "application/json")
        .set("X-Petdex-Update-Token", token)
        .send_string(body)
    {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(401, _)) => Err(BridgeError::Unauthorized),
        Err(ureq::Error::Status(status, response)) => Err(BridgeError::HttpStatus {
            status,
            body: response
                .into_string()
                .unwrap_or_else(|_| "unreadable response".into()),
        }),
        Err(ureq::Error::Transport(transport)) => {
            let message = transport.to_string();
            if message.contains("Connection refused") || message.contains("os error 111") {
                Err(BridgeError::Connection {
                    url: url.to_owned(),
                })
            } else {
                Err(BridgeError::Transport(message))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_state_subcommand() {
        let args = Args::parse_from(["petdex-bridge", "state", "running"]);

        assert_eq!(
            args.command,
            Command::State {
                name: "running".to_owned()
            }
        );
    }

    #[test]
    fn builds_state_payload_with_source() {
        let payload = build_payload("waiting");

        assert_eq!(
            payload,
            StatePayload {
                state: "waiting",
                source: "claude-code"
            }
        );
    }

    #[test]
    fn builds_loopback_state_url() {
        assert_eq!(state_url(7778), "http://127.0.0.1:7778/state");
    }

    #[test]
    fn token_path_uses_buddy_data_dir_override() {
        env::set_var(DATA_DIR_ENV, "/mnt/c/Users/Ada/.petdex-win");

        let path = token_path().expect("token path");

        assert_eq!(
            path,
            PathBuf::from("/mnt/c/Users/Ada/.petdex-win")
                .join("runtime")
                .join("update-token")
        );
        env::remove_var(DATA_DIR_ENV);
    }

    #[test]
    fn rejects_zero_port() {
        assert!(matches!(parse_port("0"), Err(BridgeError::InvalidPort)));
    }

    #[test]
    fn empty_state_is_invalid() {
        let error = run(Args {
            command: Command::State {
                name: "  ".to_owned(),
            },
        })
        .unwrap_err();

        assert!(matches!(error, BridgeError::EmptyState));
    }
}
