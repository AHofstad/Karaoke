//! LAN remote: a small axum server that lets guests on the same network
//! browse the library and add songs to the play queue from their phones.
//!
//! The desktop frontend pushes a library snapshot via `set_library` and
//! mirrors the queue through the `queue-updated` event. Song files are never
//! exposed by path — guests only see numeric ids; covers are streamed by id.

use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub const DEFAULT_PORT: u16 = 7777;

#[derive(Clone, Serialize, Deserialize)]
pub struct RemoteSong {
    pub id: usize,
    pub artist: String,
    pub title: String,
    #[serde(rename = "isDuet")]
    pub is_duet: bool,
    #[serde(rename = "hasVideo")]
    pub has_video: bool,
    /// Estimated length for queue ETAs; serialized to guests.
    #[serde(rename = "durationMs", default)]
    pub duration_ms: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<String>,
    /// Accepted from the desktop frontend, never serialized to guests.
    #[serde(rename = "coverPath", skip_serializing, default)]
    pub cover_path: Option<String>,
    #[serde(rename = "txtPath", skip_serializing, default)]
    pub txt_path: String,
}

#[derive(Clone, Serialize)]
pub struct QueueItem {
    pub uid: u64,
    pub song: RemoteSong,
    pub singer: Option<String>,
}

#[derive(Default)]
pub struct RemoteState {
    pub library: Vec<RemoteSong>,
    pub queue: Vec<QueueItem>,
    pub now_playing: Option<QueueItem>,
    /// Time left in the playing song, pushed periodically by the desktop.
    pub now_remaining_ms: Option<f64>,
    /// txt paths of songs played this session (survives rescans, not restarts).
    pub played: HashSet<String>,
    pub port: u16,
}

pub type SharedState = Arc<Mutex<RemoteState>>;

static NEXT_UID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct ServerCtx {
    state: SharedState,
    app: AppHandle,
}

pub fn start(app: AppHandle, state: SharedState) {
    tauri::async_runtime::spawn(async move {
        let ctx = ServerCtx {
            state: state.clone(),
            app,
        };
        let router = Router::new()
            .route("/", get(index))
            .route("/api/songs", get(songs))
            .route("/api/queue", get(queue_get).post(queue_post))
            .route("/api/queue/{uid}", delete(queue_delete))
            .route("/api/skip", post(skip))
            .route("/api/played", get(played))
            .route("/api/cover/{id}", get(cover))
            .with_state(ctx);

        for port in [DEFAULT_PORT, DEFAULT_PORT + 1, DEFAULT_PORT + 2] {
            let addr = SocketAddr::from(([0, 0, 0, 0], port));
            match tokio::net::TcpListener::bind(addr).await {
                Ok(listener) => {
                    state.lock().unwrap().port = port;
                    let _ = axum::serve(listener, router).await;
                    return;
                }
                Err(e) => eprintln!("remote: port {port} unavailable: {e}"),
            }
        }
        eprintln!("remote: could not bind any port; LAN remote disabled");
    });
}

pub fn local_ip() -> Option<IpAddr> {
    local_ip_address::local_ip().ok()
}

async fn index() -> Html<&'static str> {
    Html(include_str!("../remote-ui/index.html"))
}

#[derive(Deserialize)]
struct SongsQuery {
    #[serde(default)]
    q: String,
}

async fn songs(State(ctx): State<ServerCtx>, Query(query): Query<SongsQuery>) -> Json<Vec<RemoteSong>> {
    let state = ctx.state.lock().unwrap();
    let q = normalize(&query.q);
    let list = state
        .library
        .iter()
        .filter(|s| {
            q.is_empty()
                || normalize(&format!(
                    "{} {} {} {}",
                    s.artist,
                    s.title,
                    s.creator.as_deref().unwrap_or(""),
                    s.tags.as_deref().unwrap_or("")
                ))
                .contains(&q)
        })
        .cloned()
        .collect();
    Json(list)
}

#[derive(Serialize)]
struct QueueView {
    #[serde(rename = "nowPlaying")]
    now_playing: Option<QueueItem>,
    #[serde(rename = "remainingMs")]
    remaining_ms: Option<f64>,
    queue: Vec<QueueItem>,
}

fn queue_view(state: &RemoteState) -> QueueView {
    QueueView {
        now_playing: state.now_playing.clone(),
        remaining_ms: state.now_remaining_ms,
        queue: state.queue.clone(),
    }
}

async fn queue_get(State(ctx): State<ServerCtx>) -> Json<QueueView> {
    let state = ctx.state.lock().unwrap();
    Json(queue_view(&state))
}

#[derive(Deserialize)]
struct QueueAdd {
    #[serde(rename = "songId")]
    song_id: usize,
    #[serde(rename = "singerName")]
    singer_name: Option<String>,
}

async fn queue_post(
    State(ctx): State<ServerCtx>,
    Json(body): Json<QueueAdd>,
) -> Result<Json<QueueView>, StatusCode> {
    let view = {
        let mut state = ctx.state.lock().unwrap();
        let song = state
            .library
            .iter()
            .find(|s| s.id == body.song_id)
            .cloned()
            .ok_or(StatusCode::NOT_FOUND)?;
        let singer = body
            .singer_name
            .map(|s| s.trim().chars().take(40).collect::<String>())
            .filter(|s| !s.is_empty());
        state.queue.push(QueueItem {
            uid: NEXT_UID.fetch_add(1, Ordering::Relaxed),
            song,
            singer,
        });
        queue_view(&state)
    };
    let _ = ctx.app.emit("queue-updated", ());
    let _ = ctx.app.emit("queue-added", ());
    Ok(Json(view))
}

async fn queue_delete(State(ctx): State<ServerCtx>, Path(uid): Path<u64>) -> Json<QueueView> {
    let view = {
        let mut state = ctx.state.lock().unwrap();
        state.queue.retain(|item| item.uid != uid);
        queue_view(&state)
    };
    let _ = ctx.app.emit("queue-updated", ());
    Json(view)
}

/// Ids of songs already sung this session, for the phone's ✓ marker.
async fn played(State(ctx): State<ServerCtx>) -> Json<Vec<usize>> {
    let state = ctx.state.lock().unwrap();
    let ids = state
        .library
        .iter()
        .filter(|s| state.played.contains(&s.txt_path))
        .map(|s| s.id)
        .collect();
    Json(ids)
}

async fn skip(State(ctx): State<ServerCtx>) -> StatusCode {
    let _ = ctx.app.emit("remote-skip", ());
    StatusCode::NO_CONTENT
}

async fn cover(State(ctx): State<ServerCtx>, Path(id): Path<usize>) -> impl IntoResponse {
    let path = {
        let state = ctx.state.lock().unwrap();
        state
            .library
            .iter()
            .find(|s| s.id == id)
            .and_then(|s| s.cover_path.clone())
    };
    match path {
        Some(p) => match std::fs::read(&p) {
            Ok(bytes) => {
                let mime = match p.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
                    Some("png") => "image/png",
                    Some("webp") => "image/webp",
                    Some("bmp") => "image/bmp",
                    _ => "image/jpeg",
                };
                ([(header::CONTENT_TYPE, mime)], bytes).into_response()
            }
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        },
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Query params from phones: case-fold and normalize enough for search parity
/// with the desktop (full unicode folding happens client-side there).
fn normalize(s: &str) -> String {
    s.to_lowercase()
}

// ---- Tauri commands (desktop frontend <-> shared state) ----

#[tauri::command]
pub fn set_library(state: tauri::State<'_, SharedState>, songs: Vec<RemoteSong>) {
    let mut s = state.lock().unwrap();
    s.library = songs;
    // Song ids changed; drop stale queue entries.
    s.queue.clear();
}

#[derive(Serialize)]
pub struct RemoteInfo {
    pub url: Option<String>,
    pub port: u16,
}

#[tauri::command]
pub fn get_remote_info(state: tauri::State<'_, SharedState>) -> RemoteInfo {
    let port = {
        let s = state.lock().unwrap();
        if s.port == 0 {
            DEFAULT_PORT
        } else {
            s.port
        }
    };
    RemoteInfo {
        url: local_ip().map(|ip| format!("http://{ip}:{port}")),
        port,
    }
}

#[derive(Serialize)]
pub struct QueueSnapshot {
    #[serde(rename = "nowPlaying")]
    pub now_playing: Option<QueueItem>,
    #[serde(rename = "remainingMs")]
    pub remaining_ms: Option<f64>,
    pub queue: Vec<QueueItem>,
}

#[tauri::command]
pub fn queue_snapshot(state: tauri::State<'_, SharedState>) -> QueueSnapshot {
    let s = state.lock().unwrap();
    QueueSnapshot {
        now_playing: s.now_playing.clone(),
        remaining_ms: s.now_remaining_ms,
        queue: s.queue.clone(),
    }
}

/// Desktop pushes the playing song's remaining time for queue ETAs.
#[tauri::command]
pub fn set_progress(state: tauri::State<'_, SharedState>, remaining_ms: f64) {
    state.lock().unwrap().now_remaining_ms = Some(remaining_ms);
}

#[tauri::command]
pub fn queue_add_local(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    song_id: usize,
    singer: Option<String>,
) -> Result<(), String> {
    {
        let mut s = state.lock().unwrap();
        let song = s
            .library
            .iter()
            .find(|x| x.id == song_id)
            .cloned()
            .ok_or_else(|| format!("unknown song id {song_id}"))?;
        s.queue.push(QueueItem {
            uid: NEXT_UID.fetch_add(1, Ordering::Relaxed),
            song,
            singer,
        });
    }
    let _ = app.emit("queue-updated", ());
    let _ = app.emit("queue-added", ());
    Ok(())
}

#[tauri::command]
pub fn queue_remove(app: AppHandle, state: tauri::State<'_, SharedState>, uid: u64) {
    state.lock().unwrap().queue.retain(|item| item.uid != uid);
    let _ = app.emit("queue-updated", ());
}

#[tauri::command]
pub fn queue_clear(app: AppHandle, state: tauri::State<'_, SharedState>) {
    state.lock().unwrap().queue.clear();
    let _ = app.emit("queue-updated", ());
}

/// Pop the next queued song and mark it as now playing. Returns its txt path
/// alongside the item so the desktop can load it.
#[derive(Serialize)]
pub struct NextSong {
    pub item: QueueItem,
    #[serde(rename = "txtPath")]
    pub txt_path: String,
}

#[tauri::command]
pub fn queue_next(app: AppHandle, state: tauri::State<'_, SharedState>) -> Option<NextSong> {
    let next = {
        let mut s = state.lock().unwrap();
        if s.queue.is_empty() {
            s.now_playing = None;
            None
        } else {
            let item = s.queue.remove(0);
            s.played.insert(item.song.txt_path.clone());
            s.now_playing = Some(item.clone());
            s.now_remaining_ms = Some(item.song.duration_ms);
            let txt_path = item.song.txt_path.clone();
            Some(NextSong { item, txt_path })
        }
    };
    let _ = app.emit("queue-updated", ());
    next
}

/// Desktop reports playback stopped outside the queue flow.
#[tauri::command]
pub fn playing_stopped(app: AppHandle, state: tauri::State<'_, SharedState>) {
    {
        let mut s = state.lock().unwrap();
        s.now_playing = None;
        s.now_remaining_ms = None;
    }
    let _ = app.emit("queue-updated", ());
}
