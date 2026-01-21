// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use axum::{
    extract::Path,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

/// UI Bridge element state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElementState {
    pub visible: bool,
    pub enabled: bool,
    pub focused: bool,
    pub text: Option<String>,
    pub value: Option<String>,
}

/// Registered element
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredElement {
    pub id: String,
    pub element_type: String,
    pub label: Option<String>,
    pub state: ElementState,
}

/// Action request
#[derive(Debug, Deserialize)]
pub struct ActionRequest {
    pub action: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// API response wrapper
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: T,
    pub timestamp: u64,
}

/// Shared application state
pub struct AppState {
    pub elements: RwLock<Vec<RegisteredElement>>,
    pub window: Option<tauri::Window>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            elements: RwLock::new(Vec::new()),
            window: None,
        }
    }
}

fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Health check endpoint
async fn health() -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse {
        success: true,
        data: serde_json::json!({ "status": "ok" }),
        timestamp: timestamp(),
    })
}

/// List all registered elements
async fn list_elements(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Json<ApiResponse<Vec<RegisteredElement>>> {
    let elements = state.elements.read().await;
    Json(ApiResponse {
        success: true,
        data: elements.clone(),
        timestamp: timestamp(),
    })
}

/// Get element by ID
async fn get_element(
    Path(id): Path<String>,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> Result<Json<ApiResponse<RegisteredElement>>, StatusCode> {
    let elements = state.elements.read().await;
    if let Some(element) = elements.iter().find(|e| e.id == id) {
        Ok(Json(ApiResponse {
            success: true,
            data: element.clone(),
            timestamp: timestamp(),
        }))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

/// Execute action on element
async fn element_action(
    Path(id): Path<String>,
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(request): Json<ActionRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    // In a real implementation, this would:
    // 1. Find the element in the frontend via Tauri IPC
    // 2. Execute the action (click, type, etc.)
    // 3. Return the updated state

    // For this example, we emit an event to the frontend
    if let Some(ref window) = state.window {
        let _ = window.emit(
            "ui-bridge-action",
            serde_json::json!({
                "elementId": id,
                "action": request.action,
                "params": request.params,
            }),
        );
    }

    Ok(Json(ApiResponse {
        success: true,
        data: serde_json::json!({
            "message": format!("Action '{}' executed on element '{}'", request.action, id),
            "params": request.params,
        }),
        timestamp: timestamp(),
    }))
}

/// Start the UI Bridge HTTP server
async fn start_ui_bridge_server(state: Arc<AppState>, port: u16) {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/control/elements", get(list_elements))
        .route("/control/element/:id", get(get_element))
        .route("/control/element/:id/action", post(element_action))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port))
        .await
        .expect("Failed to bind UI Bridge server");

    println!("UI Bridge server running on http://127.0.0.1:{}", port);

    axum::serve(listener, app).await.expect("Server error");
}

/// Tauri command to register an element from the frontend
#[tauri::command]
async fn register_element(
    state: tauri::State<'_, Arc<AppState>>,
    element: RegisteredElement,
) -> Result<(), String> {
    let mut elements = state.elements.write().await;
    // Remove existing element with same ID
    elements.retain(|e| e.id != element.id);
    elements.push(element);
    Ok(())
}

/// Tauri command to unregister an element
#[tauri::command]
async fn unregister_element(
    state: tauri::State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    let mut elements = state.elements.write().await;
    elements.retain(|e| e.id != id);
    Ok(())
}

fn main() {
    let state = Arc::new(AppState::new());
    let server_state = state.clone();

    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            // Get the main window
            let window = app.get_window("main").expect("Failed to get main window");

            // Update state with window reference (for emitting events)
            // Note: In production, you'd use a proper pattern for this
            let server_state = server_state.clone();

            // Start UI Bridge HTTP server in background
            tauri::async_runtime::spawn(async move {
                start_ui_bridge_server(server_state, 9876).await;
            });

            // Listen for element registration from frontend
            window.listen("ui-bridge-register", move |event| {
                if let Some(payload) = event.payload() {
                    println!("Element registered: {}", payload);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![register_element, unregister_element])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
