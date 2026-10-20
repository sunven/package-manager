use reqwest::blocking::{Client, Response};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

const PAGE_SIZE: usize = 100;
const MAX_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PAGES: usize = 10_000;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OpenCodeScanStatus {
    Ready,
    Unavailable,
    Failed,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeSessionScan {
    pub status: OpenCodeScanStatus,
    pub records: Vec<OpenCodeSessionRecord>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeSessionRecord {
    pub id: String,
    pub title: String,
    pub last_activity_ms: i64,
    pub working_directory: String,
    pub archived: bool,
    pub parent_id: Option<String>,
    pub parent_title: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeDeletionResult {
    pub preflight_error: Option<String>,
    pub items: Vec<OpenCodeDeletionItem>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeDeletionItem {
    pub id: String,
    pub status: OpenCodeDeletionStatus,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OpenCodeDeletionStatus {
    Deleted,
    Failed,
    NotAttempted,
}

#[derive(Clone)]
struct Service {
    url: Url,
    password: Option<String>,
    version: String,
    pid: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registration {
    id: String,
    version: String,
    url: String,
    pid: u32,
    password: Option<String>,
}

#[derive(Deserialize)]
struct ServerInfo {
    version: String,
    pid: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionPage {
    data: Vec<SessionInfo>,
    cursor: SessionCursor,
}

#[derive(Deserialize)]
struct SessionResponse {
    data: SessionInfo,
}

#[derive(Deserialize)]
struct ActiveSessionsResponse {
    data: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SessionDeleteResponse {
    Boolean(bool),
    Data { data: bool },
}

#[derive(Deserialize)]
struct SessionCursor {
    next: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    id: String,
    #[serde(rename = "parentID")]
    parent_id: Option<String>,
    time: SessionTime,
    title: Option<String>,
    location: SessionLocation,
}

#[derive(Deserialize)]
struct SessionTime {
    updated: i64,
    archived: Option<i64>,
}

#[derive(Deserialize)]
struct SessionLocation {
    directory: String,
}

pub(crate) fn scan_default() -> OpenCodeSessionScan {
    match scan() {
        Ok(records) => OpenCodeSessionScan {
            status: OpenCodeScanStatus::Ready,
            records,
            message: None,
        },
        Err(ScanError::Unavailable(message)) => OpenCodeSessionScan {
            status: OpenCodeScanStatus::Unavailable,
            records: Vec::new(),
            message: Some(message),
        },
        Err(ScanError::Failed(message)) => OpenCodeSessionScan {
            status: OpenCodeScanStatus::Failed,
            records: Vec::new(),
            message: Some(message),
        },
    }
}

pub(crate) fn open_default(session_id: &str) -> Result<(), String> {
    if !valid_session_id(session_id) {
        return Err("OpenCode 会话标识无效，请刷新后重试。".into());
    }
    let service = discover_service()
        .map_err(|error| error.message())?
        .ok_or_else(|| "未发现正在运行的 OpenCode 服务，请启动 OpenCode 后重试。".to_string())?;
    let client = client()?;
    let directory_path = session_directory(&client, &service, session_id)
        .map_err(|error| error.message())?
        .ok_or_else(|| "该 OpenCode 会话已不存在，请刷新会话记录后重试。".to_string())?;
    launch_terminal(&service, session_id, &directory_path)
}

pub(crate) fn delete_default(session_id: &str) -> Result<(), String> {
    if !valid_session_id(session_id) {
        return Err("OpenCode 会话标识无效，请刷新后重试。".into());
    }
    let service = discover_service()
        .map_err(|error| error.message())?
        .ok_or_else(|| "未发现正在运行的 OpenCode 服务，请启动 OpenCode 后重试。".to_string())?;
    let client = client()?;
    delete_session(&client, &service, session_id)
}

pub(crate) fn delete_many_default(
    session_ids: &[String],
) -> Result<OpenCodeDeletionResult, String> {
    let session_ids = unique_valid_session_ids(session_ids)?;
    if session_ids.is_empty() {
        return Err("OpenCode 会话标识无效，请刷新后重试。".into());
    }
    let service = discover_service()
        .map_err(|error| error.message())?
        .ok_or_else(|| "未发现正在运行的 OpenCode 服务，请启动 OpenCode 后重试。".to_string())?;
    let client = client()?;
    let records = scan_service(&service).map_err(|error| match error {
        ScanError::Unavailable(message) | ScanError::Failed(message) => {
            format!("无法核对当前 OpenCode 会话，未删除任何会话：{message}")
        }
    })?;
    let (roots, preflight_session_ids) = open_code_deletion_plan(&records, &session_ids);
    if roots.is_empty() {
        return Ok(OpenCodeDeletionResult {
            preflight_error: Some("所选 OpenCode 会话已不存在，未删除任何会话。请刷新后重试。".into()),
            items: Vec::new(),
        });
    }
    if roots.iter().any(|id| !preflight_session_ids.contains(id)) {
        return Err("OpenCode 会话删除计划无效，未删除任何会话。".into());
    }
    delete_many(&client, &service, &roots, &preflight_session_ids)
}

fn open_code_deletion_plan(
    records: &[OpenCodeSessionRecord],
    selected_ids: &[String],
) -> (Vec<String>, Vec<String>) {
    let records_by_id = records
        .iter()
        .map(|record| (record.id.as_str(), record))
        .collect::<std::collections::HashMap<_, _>>();
    let selected = selected_ids
        .iter()
        .filter(|id| records_by_id.contains_key(id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let selected_set = selected.iter().cloned().collect::<std::collections::HashSet<_>>();
    let roots = selected
        .iter()
        .filter(|id| {
            let mut visited = std::collections::HashSet::from([id.as_str()]);
            let mut parent_id = records_by_id.get(id.as_str()).and_then(|record| record.parent_id.as_deref());
            while let Some(parent) = parent_id {
                if !visited.insert(parent) {
                    break;
                }
                if selected_set.contains(parent) {
                    return false;
                }
                parent_id = records_by_id.get(parent).and_then(|record| record.parent_id.as_deref());
            }
            true
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut affected = roots.iter().cloned().collect::<std::collections::HashSet<_>>();
    loop {
        let mut changed = false;
        for record in records {
            if record.parent_id.as_ref().is_some_and(|parent| affected.contains(parent)) {
                changed |= affected.insert(record.id.clone());
            }
        }
        if !changed {
            break;
        }
    }
    let preflight_ids = records
        .iter()
        .filter(|record| affected.contains(&record.id))
        .map(|record| record.id.clone())
        .collect();
    (roots, preflight_ids)
}

fn unique_valid_session_ids(session_ids: &[String]) -> Result<Vec<String>, String> {
    let mut seen = std::collections::HashSet::new();
    let unique = session_ids
        .iter()
        .filter(|session_id| seen.insert((*session_id).clone()))
        .cloned()
        .collect::<Vec<_>>();
    if unique.iter().any(|id| !valid_session_id(id)) {
        return Err("OpenCode 会话标识无效，请刷新后重试。".into());
    }
    Ok(unique)
}

fn delete_many(
    client: &Client,
    service: &Service,
    session_ids: &[String],
    preflight_session_ids: &[String],
) -> Result<OpenCodeDeletionResult, String> {
    for session_id in preflight_session_ids {
        if let Err(message) = check_session_delete(client, service, session_id) {
            return Ok(OpenCodeDeletionResult {
                preflight_error: Some(format!(
                    "未删除任何会话。「{session_id}」预检失败：{message}"
                )),
                items: Vec::new(),
            });
        }
    }

    let mut items = Vec::with_capacity(session_ids.len());
    for (index, session_id) in session_ids.iter().enumerate() {
        match delete_session(client, service, session_id) {
            Ok(()) => items.push(OpenCodeDeletionItem {
                id: session_id.clone(),
                status: OpenCodeDeletionStatus::Deleted,
                message: None,
            }),
            Err(message) => {
                items.push(OpenCodeDeletionItem {
                    id: session_id.clone(),
                    status: OpenCodeDeletionStatus::Failed,
                    message: Some(message.clone()),
                });
                items.extend(session_ids[index + 1..].iter().map(|id| OpenCodeDeletionItem {
                    id: id.clone(),
                    status: OpenCodeDeletionStatus::NotAttempted,
                    message: Some("前一项删除失败，已停止后续删除。".into()),
                }));
                return Ok(OpenCodeDeletionResult {
                    preflight_error: None,
                    items,
                });
            }
        }
    }
    Ok(OpenCodeDeletionResult {
        preflight_error: None,
        items,
    })
}

fn delete_session(client: &Client, service: &Service, session_id: &str) -> Result<(), String> {
    check_session_delete(client, service, session_id)?;

    let url = service_url(service, &format!("/api/session/{session_id}"))?;
    let mut request = client.delete(url);
    if let Some(password) = service.password.as_deref() {
        request = request.basic_auth("opencode", Some(password));
    }
    let response = request.send().map_err(|_| {
        "OpenCode 服务当前无法连接，删除结果未能确认，请刷新会话记录核对。".to_string()
    })?;
    match response.status().as_u16() {
        200 => {
            let result: SessionDeleteResponse =
                response_json(response).map_err(ApiError::message)?;
            let deleted = match result {
                SessionDeleteResponse::Boolean(value)
                | SessionDeleteResponse::Data { data: value } => value,
            };
            if deleted {
                Ok(())
            } else {
                Err("OpenCode 未确认该会话已删除，请刷新会话记录核对。".into())
            }
        }
        204 => Ok(()),
        401 | 403 => Err("OpenCode 服务拒绝认证，请重启服务后重试。".into()),
        404 => Err("该 OpenCode 会话已不存在，请刷新会话记录后重试。".into()),
        409 => Err("该 OpenCode 会话仍在运行，请先在 OpenCode 中结束后再删除。".into()),
        _ => Err("OpenCode 服务未能删除该会话，请刷新会话记录核对后重试。".into()),
    }
}

fn check_session_delete(client: &Client, service: &Service, session_id: &str) -> Result<(), String> {
    if !valid_session_id(session_id) {
        return Err("OpenCode 会话标识无效，请刷新后重试。".into());
    }
    session_directory(client, service, session_id)
        .map_err(|error| error.message())?
        .ok_or_else(|| "该 OpenCode 会话已不存在，请刷新会话记录后重试。".to_string())?;

    let active_url = service_url(service, "/api/session/active")?;
    let active_response = request(client, service, active_url).map_err(ApiError::message)?;
    let active_sessions: ActiveSessionsResponse =
        response_json(active_response).map_err(ApiError::message)?;
    if active_sessions.data.contains_key(session_id) {
        return Err("该 OpenCode 会话仍在运行，请先在 OpenCode 中结束后再删除。".into());
    }
    Ok(())
}

fn scan() -> Result<Vec<OpenCodeSessionRecord>, ScanError> {
    let service = discover_service()?.ok_or_else(|| {
        ScanError::Unavailable("未发现正在运行的 OpenCode 服务。启动 OpenCode 后可重试。".into())
    })?;
    scan_service(&service)
}

fn scan_service(service: &Service) -> Result<Vec<OpenCodeSessionRecord>, ScanError> {
    let client = client().map_err(ScanError::Failed)?;
    let mut cursor: Option<String> = None;
    let mut seen_cursors = std::collections::HashSet::new();
    let mut sessions = Vec::new();
    for page_number in 0..MAX_PAGES {
        let mut url = service_url(service, "/api/session").map_err(ScanError::Failed)?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("limit", &PAGE_SIZE.to_string());
            query.append_pair("order", "desc");
            if let Some(value) = &cursor {
                query.append_pair("cursor", value);
            }
        }
        let response = request(&client, service, url)
            .map_err(|error| ScanError::from_api(error, "会话列表读取失败"))?;
        let page: SessionPage = response_json(response)
            .map_err(|error| ScanError::from_api(error, "会话列表响应无法读取"))?;
        let next = page.cursor.next;
        sessions.extend(page.data);
        match next {
            Some(next)
                if !next.is_empty() && next.len() <= 4096 && seen_cursors.insert(next.clone()) =>
            {
                if page_number + 1 == MAX_PAGES {
                    return Err(ScanError::Failed(
                        "OpenCode 会话数量超出本次读取上限。".into(),
                    ));
                }
                cursor = Some(next);
            }
            Some(_) => {
                return Err(ScanError::Failed(
                    "OpenCode 会话分页游标无效，读取已停止。".into(),
                ))
            }
            None => break,
        }
        if sessions.len() > MAX_PAGES * PAGE_SIZE {
            return Err(ScanError::Failed(
                "OpenCode 会话数量超出本次读取上限。".into(),
            ));
        }
    }

    let titles = sessions
        .iter()
        .map(|session| {
            (
                session.id.clone(),
                session.title.as_deref().unwrap_or("未命名会话").to_string(),
            )
        })
        .collect::<std::collections::HashMap<_, _>>();
    Ok(sessions
        .into_iter()
        .filter(|session| valid_session_id(&session.id))
        .map(|session| OpenCodeSessionRecord {
            id: session.id,
            title: session
                .title
                .filter(|title| !title.trim().is_empty())
                .unwrap_or_else(|| "未命名会话".into()),
            last_activity_ms: session.time.updated,
            working_directory: session.location.directory,
            archived: session.time.archived.is_some(),
            parent_title: session
                .parent_id
                .as_deref()
                .and_then(|id| titles.get(id).cloned()),
            parent_id: session.parent_id,
        })
        .collect())
}

#[derive(Debug)]
enum ScanError {
    Unavailable(String),
    Failed(String),
}

impl ScanError {
    fn from_api(error: ApiError, action: &str) -> Self {
        match error {
            ApiError::Unavailable(message) => Self::Unavailable(message),
            ApiError::Failed(message) => Self::Failed(format!("{action}：{message}")),
        }
    }
}

impl From<ApiError> for ScanError {
    fn from(error: ApiError) -> Self {
        Self::from_api(error, "OpenCode 服务读取失败")
    }
}

#[derive(Debug)]
enum ApiError {
    Unavailable(String),
    Failed(String),
}

impl ApiError {
    fn message(self) -> String {
        match self {
            Self::Unavailable(message) | Self::Failed(message) => message,
        }
    }
}

fn discover_service() -> Result<Option<Service>, ApiError> {
    let directory = state_directory().map_err(ApiError::Failed)?;
    discover_service_at(&directory)
}

fn discover_service_at(directory: &Path) -> Result<Option<Service>, ApiError> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(ApiError::Failed("无法读取 OpenCode 服务登记目录。".into())),
    };
    let mut services = Vec::new();
    let mut found_registration = false;
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_registration_name(&path) {
            continue;
        }
        found_registration = true;
        if !is_private_regular_file(&path) {
            continue;
        }
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > 32 * 1024 {
            continue;
        }
        let Ok(contents) = fs::read(&path) else {
            continue;
        };
        let Ok(registration) = serde_json::from_slice::<Registration>(&contents) else {
            continue;
        };
        if registration.id.is_empty() || registration.version.is_empty() || registration.pid == 0 {
            continue;
        }
        let Ok(url) = Url::parse(&registration.url) else {
            continue;
        };
        if !is_local_http_url(&url) {
            continue;
        }
        services.push(Service {
            url,
            password: registration.password,
            version: registration.version,
            pid: registration.pid,
        });
    }
    if services.is_empty() {
        if found_registration {
            return Err(ApiError::Failed(
                "OpenCode 服务登记无效或权限不安全，请重启服务后重试。".into(),
            ));
        }
        return Ok(None);
    }

    let client = client().map_err(ApiError::Failed)?;
    let mut healthy = Vec::new();
    let mut authentication_failed = false;
    let mut incompatible_api = false;
    for service in services {
        let Ok(response) = request(
            &client,
            &service,
            service_url(&service, "/api/info").map_err(ApiError::Failed)?,
        ) else {
            continue;
        };
        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            authentication_failed = true;
            continue;
        }
        if response.status().as_u16() == 404 {
            incompatible_api = true;
            continue;
        }
        if !response.status().is_success() {
            continue;
        }
        let Ok(info) = response_json::<ServerInfo>(response) else {
            continue;
        };
        if info.pid == service.pid && info.version == service.version {
            healthy.push(service);
        }
    }
    match healthy.len() {
        0 if authentication_failed => Err(ApiError::Failed(
            "OpenCode 服务拒绝认证，请重启服务后重试。".into(),
        )),
        0 if incompatible_api => Err(ApiError::Unavailable(
            "OpenCode 服务不再提供所需接口，请更新服务后重试。".into(),
        )),
        0 => Ok(None),
        1 => Ok(healthy.pop()),
        _ => Err(ApiError::Failed(
            "发现多个正在运行的 OpenCode 服务，无法确定应连接哪一个。".into(),
        )),
    }
}

fn state_directory() -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os("XDG_STATE_HOME").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        if !path.is_absolute() {
            return Err("XDG_STATE_HOME 必须是绝对路径。".into());
        }
        return Ok(path.join("opencode"));
    }
    let home = std::env::var_os("HOME")
        .filter(|value| Path::new(value).is_absolute())
        .ok_or_else(|| "无法确定用户主目录以查找 OpenCode 服务。".to_string())?;
    Ok(PathBuf::from(home).join(".local/state/opencode"))
}

fn is_registration_name(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    name == "service.json" || (name.starts_with("service-") && name.ends_with(".json"))
}

fn is_private_regular_file(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o077 == 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn is_local_http_url(url: &Url) -> bool {
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_start_matches('[')
        .trim_end_matches(']');
    url.scheme() == "http"
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
        && url.port().is_some()
}

fn client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法建立 OpenCode 本地连接。".into())
}

fn service_url(service: &Service, path: &str) -> Result<Url, String> {
    service
        .url
        .join(path)
        .map_err(|_| "OpenCode 服务地址无效。".into())
}

fn request(client: &Client, service: &Service, url: Url) -> Result<Response, ApiError> {
    let request = client.get(url);
    let request = match service.password.as_deref() {
        Some(password) => request.basic_auth("opencode", Some(password)),
        None => request,
    };
    request.send().map_err(|_| {
        ApiError::Unavailable("OpenCode 服务当前无法连接，请确认服务仍在运行后重试。".into())
    })
}

fn session_directory(
    client: &Client,
    service: &Service,
    session_id: &str,
) -> Result<Option<String>, ApiError> {
    let url =
        service_url(service, &format!("/api/session/{session_id}")).map_err(ApiError::Failed)?;
    let response = request(client, service, url)?;
    if response.status().as_u16() == 404 {
        return Ok(None);
    }
    let session: SessionResponse = response_json(response)?;
    Ok(Some(session.data.location.directory))
}

fn response_json<T: for<'de> Deserialize<'de>>(response: Response) -> Result<T, ApiError> {
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Err(ApiError::Failed(
            "OpenCode 服务拒绝认证，请重启服务后重试。".into(),
        ));
    }
    if response.status().as_u16() == 404 {
        return Err(ApiError::Unavailable(
            "OpenCode 服务不再提供所需接口，请更新服务后重试。".into(),
        ));
    }
    if !response.status().is_success() {
        return Err(ApiError::Failed("OpenCode 服务返回错误响应。".into()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES)
    {
        return Err(ApiError::Failed("OpenCode 服务响应超过读取上限。".into()));
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ApiError::Failed("OpenCode 服务响应无法读取。".into()))?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(ApiError::Failed("OpenCode 服务响应超过读取上限。".into()));
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| ApiError::Failed("OpenCode 服务响应格式无效。".into()))
}

fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

fn launch_terminal(
    service: &Service,
    session_id: &str,
    directory_path: &str,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("在 OpenCode 中打开会话目前只支持 macOS。".into());
    }
    let paths = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    let binary = crate::environment_inspection::resolved_target("opencode", &paths)
        .ok_or_else(|| "未找到 OpenCode CLI，请确认应用 PATH 中有 opencode。".to_string())?;

    let directory = tempfile::Builder::new()
        .prefix("opencode-session-")
        .tempdir()
        .map_err(|_| "无法准备 OpenCode 启动脚本。".to_string())?;
    let script = directory.path().join("open-session.sh");
    let script_text = launch_script(
        &binary,
        &service.url,
        service.password.as_deref(),
        session_id,
        directory_path,
    );
    fs::write(&script, script_text).map_err(|_| "无法准备 OpenCode 启动脚本。".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护 OpenCode 启动脚本。".to_string())?;
    }

    let command = format!("{}", shell_quote(&script.to_string_lossy()));
    let apple_script = format!(
        "tell application \"Terminal\" to do script \"{}\"",
        applescript_escape(&command)
    );
    let output = Command::new("osascript")
        .args(["-e", &apple_script])
        .output()
        .map_err(|_| "无法打开 macOS Terminal。".to_string())?;
    if !output.status.success() {
        return Err("无法在 macOS Terminal 中打开 OpenCode 会话。".into());
    }
    let _ = directory.keep();
    Ok(())
}

fn launch_script(
    binary: &str,
    service_url: &Url,
    password: Option<&str>,
    session_id: &str,
    directory_path: &str,
) -> String {
    let mut script = String::from("#!/bin/sh\nscript_path=$0\nscript_dir=$(dirname \"$script_path\")\nrm -f \"$script_path\"\nrmdir \"$script_dir\" 2>/dev/null || true\n");
    if let Some(password) = password {
        script.push_str(&format!(
            "export OPENCODE_SERVER_PASSWORD={}\n",
            shell_quote(password)
        ));
        script.push_str("export OPENCODE_SERVER_USERNAME=opencode\n");
    }
    script.push_str(&format!(
        "exec {} attach {} --dir {} --session {}\n",
        shell_quote(binary),
        shell_quote(service_url.as_str()),
        shell_quote(directory_path),
        shell_quote(session_id)
    ));
    script
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn applescript_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn only_registered_loopback_http_urls_are_accepted() {
        for value in ["http://127.0.0.1:49374", "http://[::1]:49374"] {
            assert!(is_local_http_url(&Url::parse(value).unwrap()));
        }
        for value in [
            "https://127.0.0.1:49374",
            "http://localhost:4096",
            "http://192.168.1.3:49374",
            "http://user:pass@127.0.0.1:4096",
        ] {
            assert!(!is_local_http_url(&Url::parse(value).unwrap()));
        }
    }

    #[test]
    fn launch_script_keeps_credentials_out_of_arguments_and_quotes_values() {
        let url = Url::parse("http://127.0.0.1:49374").unwrap();
        let script = launch_script(
            "/opt/homebrew/bin/opencode",
            &url,
            Some("secret's\nvalue"),
            "ses_abc",
            "/work/project's folder",
        );
        assert!(script.contains("export OPENCODE_SERVER_PASSWORD='secret'\\''s\nvalue'"));
        assert!(script.contains("exec '/opt/homebrew/bin/opencode' attach 'http://127.0.0.1:49374/' --dir '/work/project'\\''s folder' --session 'ses_abc'"));
        assert!(!script.contains("--password"));
    }

    #[test]
    fn session_ids_are_safe_as_encoded_path_segments_and_shell_arguments() {
        assert!(valid_session_id("ses_0123456789abcdef"));
        assert!(!valid_session_id("../session"));
        assert!(!valid_session_id("bad session"));
    }

    #[test]
    fn backend_deletion_plan_collapses_selected_ancestors_and_includes_new_descendants() {
        let records = vec![
            OpenCodeSessionRecord {
                id: "ses_parent".into(), title: "Parent".into(), last_activity_ms: 1,
                working_directory: "/work".into(), archived: false, parent_id: None, parent_title: None,
            },
            OpenCodeSessionRecord {
                id: "ses_child".into(), title: "Child".into(), last_activity_ms: 2,
                working_directory: "/work".into(), archived: false, parent_id: Some("ses_parent".into()), parent_title: Some("Parent".into()),
            },
            OpenCodeSessionRecord {
                id: "ses_new_child".into(), title: "New child".into(), last_activity_ms: 3,
                working_directory: "/work".into(), archived: false, parent_id: Some("ses_child".into()), parent_title: Some("Child".into()),
            },
        ];

        let (roots, preflight_ids) = open_code_deletion_plan(
            &records,
            &["ses_child".into(), "ses_parent".into()],
        );

        assert_eq!(roots, vec!["ses_parent".to_string()]);
        assert_eq!(preflight_ids, vec![
            "ses_parent".to_string(),
            "ses_child".to_string(),
            "ses_new_child".to_string(),
        ]);
    }

    #[test]
    fn batch_deletion_preflights_all_cascade_targets_before_any_delete() {
        let (url, server) = mock_server(vec![
            (200, r#"{"data":{"id":"ses_parent","title":"Parent","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work"}}}"#),
            (200, r#"{"data":{}}"#),
            (200, r#"{"data":{"id":"ses_child","title":"Child","parentID":"ses_parent","time":{"created":1,"updated":10},"location":{"directory":"/work"}}}"#),
            (200, r#"{"data":{"ses_child":{}}}"#),
        ]);
        let service = Service { url, password: None, version: "2.0.32".into(), pid: 1 };

        let result = delete_many(
            &client().unwrap(),
            &service,
            &["ses_parent".into()],
            &["ses_parent".into(), "ses_child".into()],
        ).unwrap();
        let requests = server.join().unwrap();

        assert!(result.preflight_error.as_deref().unwrap().contains("未删除任何会话"));
        assert!(result.items.is_empty());
        assert_eq!(requests.len(), 4);
        assert!(requests.iter().all(|request| !request.starts_with("delete ")));
    }

    #[test]
    fn batch_deletion_stops_after_first_delete_failure_and_marks_rest_unattempted() {
        let (url, server) = mock_server(vec![
            (200, r#"{"data":{"id":"ses_first","title":"First","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work"}}}"#),
            (200, r#"{"data":{}}"#),
            (200, r#"{"data":{"id":"ses_second","title":"Second","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work"}}}"#),
            (200, r#"{"data":{}}"#),
            (200, r#"{"data":{"id":"ses_third","title":"Third","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work"}}}"#),
            (200, r#"{"data":{}}"#),
            (200, r#"{"data":{"id":"ses_first","title":"First","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work"}}}"#),
            (200, r#"{"data":{}}"#),
            (204, ""),
            (200, r#"{"data":{"id":"ses_second","title":"Second","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work"}}}"#),
            (200, r#"{"data":{}}"#),
            (409, ""),
        ]);
        let service = Service { url, password: None, version: "2.0.32".into(), pid: 1 };
        let result = delete_many(
            &client().unwrap(),
            &service,
            &["ses_first".into(), "ses_second".into(), "ses_third".into()],
            &["ses_first".into(), "ses_second".into(), "ses_third".into()],
        ).unwrap();
        let requests = server.join().unwrap();

        assert_eq!(result.items.iter().map(|item| &item.status).collect::<Vec<_>>(), vec![
            &OpenCodeDeletionStatus::Deleted,
            &OpenCodeDeletionStatus::Failed,
            &OpenCodeDeletionStatus::NotAttempted,
        ]);
        assert_eq!(requests.iter().filter(|request| request.starts_with("delete ")).count(), 2);
    }

    #[test]
    fn scan_reads_all_pages_with_metadata_only_and_resolves_parent_labels() {
        let (url, server) = mock_server(vec![
            (
                200,
                r#"{"data":[{"id":"ses_parent","title":"Parent session","time":{"created":1,"updated":10},"location":{"directory":"/work/app"}}],"cursor":{"next":"page-two"}}"#,
            ),
            (
                200,
                r#"{"data":[{"id":"ses_child","parentID":"ses_parent","title":"Child session","time":{"created":2,"updated":20,"archived":19},"location":{"directory":"/work/app/sub"}}],"cursor":{}}"#,
            ),
        ]);
        let service = Service {
            url,
            password: Some("local-secret".into()),
            version: "2.0.32".into(),
            pid: 1,
        };

        let records = scan_service(&service).unwrap();
        let requests = server.join().unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].id, "ses_parent");
        assert_eq!(records[1].id, "ses_child");
        assert_eq!(records[1].parent_title.as_deref(), Some("Parent session"));
        assert!(records[1].archived);
        assert!(requests[0].contains("get /api/session?limit=100&order=desc"));
        assert!(requests[1].contains("cursor=page-two"));
        assert!(requests
            .iter()
            .all(|request| !request.contains("directory=")));
        assert!(requests
            .iter()
            .all(|request| !request.contains("archived=")));
        assert!(requests
            .iter()
            .all(|request| request.contains("authorization: basic ")));
        assert!(requests
            .iter()
            .all(|request| !request.contains("local-secret")));
        assert!(requests
            .iter()
            .all(|request| request.contains("/api/session")));
        assert!(requests.iter().all(|request| !request.contains("/message")));
    }

    #[test]
    fn opening_rechecks_session_and_stops_before_launch_if_missing() {
        let (url, server) = mock_server(vec![(404, String::new())]);
        let service = Service {
            url,
            password: None,
            version: "2.0.32".into(),
            pid: 1,
        };
        assert_eq!(
            session_directory(&client().unwrap(), &service, "ses_missing").unwrap(),
            None
        );
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].contains("get /api/session/ses_missing "));
    }

    #[test]
    fn opening_uses_the_session_directory_returned_by_the_service() {
        let (url, server) = mock_server(vec![(
            200,
            r#"{"data":{"id":"ses_project","title":"Project session","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work/project"}}}"#,
        )]);
        let service = Service {
            url,
            password: None,
            version: "2.0.32".into(),
            pid: 1,
        };

        let directory = session_directory(&client().unwrap(), &service, "ses_project")
            .unwrap()
            .unwrap();
        assert_eq!(directory, "/work/project");
        assert!(server.join().unwrap()[0].contains("get /api/session/ses_project "));
    }

    #[test]
    fn deletion_rechecks_the_session_and_uses_the_registered_service() {
        let (url, server) = mock_server(vec![
            (
                200,
                r#"{"data":{"id":"ses_project","title":"Project session","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work/project"}}}"#,
            ),
            (200, r#"{"data":{}}"#),
            (204, ""),
        ]);
        let service = Service {
            url,
            password: Some("local-secret".into()),
            version: "2.0.32".into(),
            pid: 1,
        };
        assert_eq!(
            delete_session(&client().unwrap(), &service, "ses_project"),
            Ok(())
        );

        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(requests[0].starts_with("get /api/session/ses_project "));
        assert!(requests[1].starts_with("get /api/session/active "));
        assert!(requests[2].starts_with("delete /api/session/ses_project "));
        assert!(requests
            .iter()
            .all(|request| request.contains("authorization: basic ")));
        assert!(requests
            .iter()
            .all(|request| !request.contains("local-secret")));
    }

    #[test]
    fn deletion_does_not_send_a_delete_request_when_the_session_is_missing() {
        let (url, server) = mock_server(vec![(404, "")]);
        let service = Service {
            url,
            password: None,
            version: "2.0.32".into(),
            pid: 1,
        };

        let error = delete_session(&client().unwrap(), &service, "ses_missing").unwrap_err();
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("get /api/session/ses_missing "));
        assert!(error.contains("已不存在"));
    }

    #[test]
    fn deletion_reports_server_rejection_after_rechecking_the_session() {
        let (url, server) = mock_server(vec![
            (
                200,
                r#"{"data":{"id":"ses_project","title":"Project session","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work/project"}}}"#,
            ),
            (200, r#"{"data":{}}"#),
            (403, ""),
        ]);
        let service = Service {
            url,
            password: Some("local-secret".into()),
            version: "2.0.32".into(),
            pid: 1,
        };

        let error = delete_session(&client().unwrap(), &service, "ses_project").unwrap_err();
        let requests = server.join().unwrap();
        assert!(error.contains("拒绝认证"));
        assert_eq!(requests.len(), 3);
        assert!(requests
            .iter()
            .all(|request| request.contains("authorization: basic ")));
        assert!(requests
            .iter()
            .all(|request| !request.contains("local-secret")));
    }

    #[test]
    fn deletion_refuses_an_active_session_before_sending_delete() {
        let (url, server) = mock_server(vec![
            (
                200,
                r#"{"data":{"id":"ses_project","title":"Project session","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work/project"}}}"#,
            ),
            (200, r#"{"data":{"ses_project":{}}}"#),
        ]);
        let service = Service {
            url,
            password: None,
            version: "2.0.32".into(),
            pid: 1,
        };

        let error = delete_session(&client().unwrap(), &service, "ses_project").unwrap_err();
        let requests = server.join().unwrap();
        assert!(error.contains("仍在运行"));
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("get /api/session/ses_project "));
        assert!(requests[1].starts_with("get /api/session/active "));
    }

    #[test]
    fn deletion_reports_a_busy_conflict_from_the_server() {
        let (url, server) = mock_server(vec![
            (
                200,
                r#"{"data":{"id":"ses_project","title":"Project session","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work/project"}}}"#,
            ),
            (200, r#"{"data":{}}"#),
            (409, ""),
        ]);
        let service = Service {
            url,
            password: None,
            version: "2.0.32".into(),
            pid: 1,
        };

        let error = delete_session(&client().unwrap(), &service, "ses_project").unwrap_err();
        let requests = server.join().unwrap();
        assert!(error.contains("仍在运行"));
        assert_eq!(requests.len(), 3);
        assert!(requests[2].starts_with("delete /api/session/ses_project "));
    }

    #[test]
    fn deletion_does_not_report_a_false_result_as_success() {
        let (url, server) = mock_server(vec![
            (
                200,
                r#"{"data":{"id":"ses_project","title":"Project session","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work/project"}}}"#,
            ),
            (200, r#"{"data":{}}"#),
            (200, "false"),
        ]);
        let service = Service {
            url,
            password: None,
            version: "2.0.32".into(),
            pid: 1,
        };

        let error = delete_session(&client().unwrap(), &service, "ses_project").unwrap_err();
        assert!(error.contains("未确认"));
        assert_eq!(server.join().unwrap().len(), 3);
    }

    #[test]
    fn deletion_fails_closed_when_activity_cannot_be_checked() {
        let (url, server) = mock_server(vec![
            (
                200,
                r#"{"data":{"id":"ses_project","title":"Project session","parentID":null,"time":{"created":1,"updated":10},"location":{"directory":"/work/project"}}}"#,
            ),
            (404, ""),
        ]);
        let service = Service {
            url,
            password: None,
            version: "2.0.32".into(),
            pid: 1,
        };

        let error = delete_session(&client().unwrap(), &service, "ses_project").unwrap_err();
        let requests = server.join().unwrap();
        assert!(error.contains("不再提供所需接口"));
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("get /api/session/ses_project "));
        assert!(requests[1].starts_with("get /api/session/active "));
    }

    #[test]
    fn service_discovery_reports_authentication_failures_without_exposing_credentials() {
        let (url, server) = mock_server(vec![(401, String::new())]);
        let directory = tempfile::tempdir().unwrap();
        let registration_path = directory.path().join("service.json");
        fs::write(
            &registration_path,
            serde_json::json!({
                "id": "service-1",
                "version": "2.0.32",
                "url": url.as_str(),
                "pid": 1,
                "password": "fixture-secret"
            })
            .to_string(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&registration_path, fs::Permissions::from_mode(0o600)).unwrap();
        }

        let error = match discover_service_at(directory.path()) {
            Err(ApiError::Failed(message)) => message,
            _ => panic!("expected an authentication error"),
        };
        let requests = server.join().unwrap();
        assert!(error.contains("拒绝认证"));
        assert!(!error.contains("fixture-secret"));
        assert!(requests[0].contains("authorization: basic "));
        assert!(!requests[0].contains("fixture-secret"));
    }

    fn mock_server(
        responses: Vec<(u16, impl AsRef<str>)>,
    ) -> (Url, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let responses = responses
            .into_iter()
            .map(|(status, body)| (status, body.as_ref().to_string()))
            .collect::<Vec<_>>();
        let server = thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 1024];
                loop {
                    let count = stream.read(&mut buffer).unwrap();
                    request.extend_from_slice(&buffer[..count]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") || count == 0 {
                        break;
                    }
                }
                requests.push(String::from_utf8_lossy(&request).to_lowercase());
                let reason = if status == 404 { "Not Found" } else { "OK" };
                write!(
                    stream,
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
            requests
        });
        (Url::parse(&format!("http://{address}")).unwrap(), server)
    }
}
