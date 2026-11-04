//! WebDAV 传输层。
//!
//! **为什么不直接在前端 `fetch`。** WebView 里的请求受 CORS 约束：`PROPFIND`、`MKCOL`
//! 这类方法属于非简单请求，浏览器会先发预检，而坚果云这类服务根本不回
//! `Access-Control-Allow-Origin` —— 预检都过不去，一个字节也发不出去。放到这一层发出，
//! 跨域规则管不到，浏览器端那份实现则继续走 `fetch`（服务端自己配了 CORS 时可用）。
//!
//! 这一层只做「把请求原样发出去、把响应原样带回来」，不理解 WebDAV 语义：
//! 方法、头、XML 全由前端组装与解析。这样加一个新动作（比如 COPY）不必动 Rust。

use std::collections::HashMap;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};

/// 入参字段用 camelCase：Tauri 的 IPC 不做命名转换，前端写的是 `bodyBase64`，
/// 少了这一行两边会在运行时对不上（编译期看不出来）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DavRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    /// 请求体。二进制走 base64：IPC 参数是 JSON，直接塞字节数组会膨胀成四倍的数字列表，
    /// 编码一次反而更省，也顺带避开了「`Uint8Array` 能不能过 IPC」这类问题。
    body_base64: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DavResponse {
    status: u16,
    /// 响应体同样以 base64 回去 —— 连图片、视频都是同一个通道，前端按需解码。
    body_base64: String,
}

/// 一次 WebDAV 请求。
///
/// 超时给 60 秒：坚果云对大文件上传偶尔要这么久，而 PROPFIND 正常在几百毫秒内回来。
/// 不重试：写操作重试一次就是重复执行一次，语义上不安全。
#[tauri::command]
pub async fn webdav_request(request: DavRequest) -> Result<DavResponse, String> {
    if !(request.url.starts_with("http://") || request.url.starts_with("https://")) {
        return Err("只支持 http / https 地址".into());
    }

    let body = match request.body_base64 {
        Some(encoded) => base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|error| format!("请求体解码失败：{error}"))?,
        None => Vec::new(),
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        // 有些服务器（含坚果云）对没有 User-Agent 的请求直接回 403 —— 报出来是
        // 「服务器拒绝访问」，很容易被误判成密码错。明确带上自己的标识。
        .user_agent(concat!("WebNote/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))?;

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|error| format!("不支持的方法 {}：{error}", request.method))?;

    let mut builder = client.request(method, &request.url).body(body);
    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;

    Ok(DavResponse {
        status,
        body_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}
