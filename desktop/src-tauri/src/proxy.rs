//! Встроенный сервер приложения: раздаёт CRM и проксирует API на бэкенд.
//!
//! Зачем он нужен. Фронтенд ходит на относительные пути (`/api/admin/crm/...`
//! и `/uploads/...`) — таких мест 320, переписывать их нельзя: сломается
//! веб-версия и телефон. Поэтому приложение поднимает свой сервер на
//! 127.0.0.1 и само раздаёт статику, а запросы к API и картинкам передаёт
//! на бэкенд. Для окна Tauri фронт и API оказываются одним origin, поэтому
//! не мешают ни `sameSite=strict`, ни CORS, ни CSP.
//!
//! Почему hyper, а не tiny_http. Поток SSE (`/api/admin/crm/events`) не
//! заканчивается никогда, и события должны доходить до окна сразу. tiny_http
//! оборачивает ответ в chunked-кодировщик, который копит байты до заполнения
//! чанка: события приходили пачками с задержкой, а на этом держатся живой
//! канбан и уведомления. hyper отдаёт тело по мере поступления байт.

use std::convert::Infallible;
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{HeaderName, HeaderValue, CONTENT_LENGTH, CONTENT_TYPE};
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

/// Куда уходят запросы к API. Прод по умолчанию: приложение должно работать
/// без запущенного локального сервера, а данные там настоящие.
/// Переключается на `http://127.0.0.1:3001` через переменную окружения
/// `CRM_BACKEND` — так удобно тестировать на локальной базе.
const DEFAULT_BACKEND: &str = "https://navalivay.store";

/// Порт внутреннего сервера. Слушаем только localhost: наружу он не торчит.
const PORT: u16 = 47203;

type ProxyBody = BoxBody<Bytes, std::io::Error>;

pub struct ServerHandle {
    pub port: u16,
}

/// Запускает сервер в собственном потоке с асинхронным рантаймом.
pub fn start() -> Result<ServerHandle, String> {
    let backend = std::env::var("CRM_BACKEND").unwrap_or_else(|_| DEFAULT_BACKEND.to_string());
    let backend = Arc::new(backend.trim_end_matches('/').to_string());
    println!("[server] бэкенд: {backend}");

    let client = reqwest::Client::builder()
        // Поток SSE живёт долго и молчит между событиями: обычный таймаут
        // обрывал бы его, поэтому ограничение только на установку связи.
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("не удалось создать HTTP-клиент: {e}"))?;
    let client = Arc::new(client);

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u16, String>>();

    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("не удалось создать рантайм: {e}")));
                return;
            }
        };

        runtime.block_on(async move {
            let listener = match TcpListener::bind(("127.0.0.1", PORT)).await {
                Ok(listener) => listener,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("не удалось занять порт {PORT}: {e}")));
                    return;
                }
            };
            let _ = ready_tx.send(Ok(PORT));
            println!("[server] слушаю http://127.0.0.1:{PORT}");

            loop {
                let (stream, _) = match listener.accept().await {
                    Ok(pair) => pair,
                    Err(e) => {
                        eprintln!("[server] ошибка соединения: {e}");
                        continue;
                    }
                };
                let client = client.clone();
                let backend = backend.clone();
                tokio::spawn(async move {
                    let io = TokioIo::new(stream);
                    let service = service_fn(move |req| {
                        let client = client.clone();
                        let backend = backend.clone();
                        async move { handle(req, client, backend).await }
                    });
                    if let Err(e) = hyper::server::conn::http1::Builder::new()
                        .serve_connection(io, service)
                        .await
                    {
                        eprintln!("[server] соединение закрыто: {e}");
                    }
                });
            }
        });
    });

    match ready_rx.recv() {
        Ok(Ok(port)) => Ok(ServerHandle { port }),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("сервер не запустился: {e}")),
    }
}

async fn handle(
    req: Request<Incoming>,
    client: Arc<reqwest::Client>,
    backend: Arc<String>,
) -> Result<Response<ProxyBody>, Infallible> {
    let path = req.uri().path().to_string();
    let is_api = path.starts_with("/api") || path.starts_with("/uploads");
    let result = if is_api {
        proxy(req, client, backend).await
    } else {
        serve_static(req, &path).await
    };
    Ok(result.unwrap_or_else(|e| {
        eprintln!("[server] ошибка обработки {path}: {e}");
        text_response(StatusCode::INTERNAL_SERVER_ERROR, "Внутренняя ошибка")
    }))
}

/// Пересылает запрос на бэкенд и возвращает ответ как есть.
///
/// Тело не накапливается: и запрос, и ответ передаются потоком, поэтому
/// SSE доходит до окна сразу после события, а выгрузки не съедают память.
async fn proxy(
    req: Request<Incoming>,
    client: Arc<reqwest::Client>,
    backend: Arc<String>,
) -> Result<Response<ProxyBody>, String> {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let target = format!("{backend}{uri}");

    let mut outgoing = client.request(
        reqwest::Method::from_bytes(method.as_str().as_bytes())
            .map_err(|e| format!("неподдерживаемый метод {method}: {e}"))?,
        &target,
    );

    for (name, value) in req.headers() {
        // Host подменять нельзя — иначе nginx отдаст не тот сайт.
        // Content-Length и Transfer-Encoding пересчитает reqwest.
        let lower = name.as_str().to_lowercase();
        if lower == "host" || lower == "content-length" || lower == "transfer-encoding" {
            continue;
        }
        outgoing = outgoing.header(&lower, value.as_bytes());
    }

    let body = req.into_body();
    outgoing = outgoing.body(reqwest::Body::wrap_stream(body.into_data_stream()));

    let upstream = match outgoing.send().await {
        Ok(response) => response,
        Err(e) => {
            eprintln!("[server] бэкенд недоступен ({target}): {e}");
            return Ok(text_response(
                StatusCode::BAD_GATEWAY,
                "Нет связи с сервером. Проверьте интернет и повторите.",
            ));
        }
    };

    let status = upstream.status();
    let headers = upstream.headers().clone();

    // Ответ отдаём потоком байт: для SSE он не заканчивается, и попытка
    // собрать его целиком подвесила бы приложение навсегда.
    let stream = upstream.bytes_stream();
    let body = StreamBody::new(futures_util::StreamExt::map(stream, |chunk| {
        chunk
            .map(Frame::data)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
    }));
    // Приводим поток к тому же типу тела, что и статику: иначе функции
    // возвращали бы разные типы ответов.
    let body: ProxyBody = BodyExt::boxed(body);

    let mut response = Response::builder().status(status.as_u16());
    for (name, value) in headers.iter() {
        let lower = name.as_str().to_lowercase();
        // Длину и способ кодирования пересчитает hyper: reqwest уже распаковал
        // тело, и старые заголовки стали бы враньём.
        if lower == "content-length" || lower == "transfer-encoding" || lower == "content-encoding"
        {
            continue;
        }
        // Соединение держим сами: у SSE оно должно остаться открытым.
        if lower == "connection" {
            continue;
        }
        if let Ok(header_name) = HeaderName::from_bytes(name.as_str().as_bytes()) {
            if let Ok(header_value) = HeaderValue::from_bytes(value.as_bytes()) {
                response = response.header(header_name, header_value);
            }
        }
    }

    response
        .body(body)
        .map_err(|e| format!("не удалось собрать ответ: {e}"))
}

/// Раздаёт собранный фронтенд.
///
/// SPA-роутинг: неизвестный путь отдаёт index.html, иначе перезагрузка на
/// внутренней странице давала бы 404 — на проде это делает nginx.
async fn serve_static(req: Request<Incoming>, path: &str) -> Result<Response<ProxyBody>, String> {
    if req.method() != hyper::Method::GET && req.method() != hyper::Method::HEAD {
        return Ok(text_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "Метод не поддерживается",
        ));
    }

    let decoded = percent_decode(path);
    // Защита от выхода за пределы папки: `..` в пути не должен ничего открыть.
    if decoded.contains("..") {
        return Ok(text_response(StatusCode::NOT_FOUND, "Не найдено"));
    }

    let root = match asset_root() {
        Some(root) => root,
        None => {
            return Ok(html_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "<h1>Не найден собранный фронтенд</h1>\
                 <p>Соберите его: <code>cd app/frontend &amp;&amp; npm run build</code>, \
                 затем скопируйте <code>dist</code> в приложение.</p>",
            ))
        }
    };

    let relative = decoded.trim_start_matches('/');
    let mut file = root.join(relative);
    if relative.is_empty() || file.is_dir() {
        file = root.join("index.html");
    }
    if !file.exists() {
        // Как в nginx: неизвестный путь — это внутренний маршрут SPA.
        file = root.join("index.html");
    }

    let data = match tokio::fs::read(&file).await {
        Ok(data) => data,
        Err(_) => return Ok(text_response(StatusCode::NOT_FOUND, "Не найдено")),
    };

    let content_type = content_type_for(&file);
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, data.len())
        // Кэш выключен: приложение локальное, а устаревший бандл после
        // пересборки сбивал бы с толку сильнее, чем экономил миллисекунды.
        .header("cache-control", "no-store")
        .body(full_body(data))
        .map_err(|e| format!("не удалось собрать ответ: {e}"))
}

/// Ищет папку с собранным фронтендом.
///
/// В собранном `.app` она лежит в `Contents/Resources/dist`, в разработке —
/// рядом с бинарником или с проектом. Проверяем все варианты по очереди.
fn asset_root() -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("dist"));
            candidates.push(dir.join("../Resources/dist"));
        }
    }
    candidates.push(std::path::PathBuf::from("dist"));
    candidates.push(std::path::PathBuf::from("../dist"));

    candidates.into_iter().find(|p| p.is_dir())
}

fn content_type_for(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        "map" => "application/json; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Минимальное раскодирование `%D0%9F` в путь: имена файлов сборки бывают
/// с кириллицей, а hyper отдаёт путь как есть.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Тело ответа: либо цельные байты (статика), либо поток от бэкенда (API).
/// Оба приводим к одному типу через `boxed`, чтобы функция возвращала
/// единый `Response`.
fn full_body(data: Vec<u8>) -> ProxyBody {
    Full::new(Bytes::from(data))
        .map_err(|never| match never {})
        .boxed()
}

fn text_response(status: StatusCode, message: &str) -> Response<ProxyBody> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(full_body(message.as_bytes().to_vec()))
        .expect("корректный ответ")
}

fn html_response(status: StatusCode, html: &str) -> Response<ProxyBody> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/html; charset=utf-8")
        .body(full_body(html.as_bytes().to_vec()))
        .expect("корректный ответ")
}
