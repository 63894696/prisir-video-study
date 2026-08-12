// Prisir 视频学习 · Service Worker
// 职责:把 content script 的字幕翻译(translate/translate-batch)与帧笔记多模态(vision-note)
// 交给内置引擎(engines.js),扩展内直连用户配置的 OpenAI 兼容端点。无本地后端、无右键菜单、
// 无整页翻译——本扩展只做「视频学习」:双语字幕 + AI 帧笔记。
//
// 隐私红线:帧图仅经用户配置端点,不收集、不上传、不落盘;密钥仅存 chrome.storage.local;
// fetch-text 代取仅白名单 youtube.com/api/timedtext,不作通用代理。

// MV3 classic service worker:importScripts 引入引擎 + 语言清单 + 角色提示词。
// 顺序:prompts 必须在 engines 前(engines 的 buildTranslatePrompt 依赖 CT_PROMPTS)。
try { importScripts('langs.js', 'prompts.js', 'engines.js'); } catch (e) { console.warn('[PVS] import langs/prompts/engines failed', e); }

const TIMEOUT_MS = 30000;
const inflight = new Map(); // key -> Promise(同 key 并发只发一次)

// 批量翻译的简单并发限制(扩展内直连,无后端节流)
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run);
  await Promise.all(runners);
  return results;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'translate') {
    handleTranslate(msg).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'translate-batch') {
    handleTranslateBatch(msg).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'health') {
    handleHealth().then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'redetect-engine') {
    self.CT_ENGINES.detectEngine(true).then((r) => sendResponse({ ok: true, detected: r })).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'list-models') {
    handleListModels(msg).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'test-service') {
    handleTestService(msg).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === 'fetch-text') {
    handleFetchText(msg).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  // 视频帧笔记:多模态帧理解。帧图(base64 dataURL)+ 笔记提示词 → 用户配置的 OpenAI 兼容
  // 多模态端点(Agnes / Kimi / MiniMax 等)。仅识别当前帧,不收集、不落盘。
  if (msg.type === 'vision-note') {
    handleVisionNote(msg).then((r) => sendResponse(r)).catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  return false;
});

// ---------- 字幕翻译管线 ----------
async function handleTranslate({ key, text, srcLang = '', dstLang = '' }) {
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const { dstLang: stored } = await chrome.storage.local.get('dstLang');
    const finalDst = dstLang || stored || 'zh';
    const r = await self.CT_ENGINES.engineTranslate({ text, srcLang, dstLang: finalDst });
    if (r && !r.ok && !r.needConfig) logFailure(r.provider || 'engine', r.model || '', r, (text || '').length);
    return { ...r, key };
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

async function handleTranslateBatch({ items = [], dstLang = '', concurrency = 6 }) {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'items 必须是非空数组' };
  const { dstLang: stored } = await chrome.storage.local.get('dstLang');
  const finalDst = dstLang || stored || 'zh';
  const conc = Math.max(1, Math.min(20, Number(concurrency) || 6));
  const norm = items.map((it) => {
    const text = it && it.text != null ? it.text : (typeof it === 'string' ? it : '');
    const id = (it && (it.id != null ? it.id : it.key)) || '';
    const srcLang = (it && it.srcLang) || '';
    return { id, text, srcLang };
  });

  // 先试 %% 多段批量(openai_compat 且角色 batchOK),一次请求拿全部;失败回退逐条并发。
  if (norm.length >= 2) {
    try {
      const br = await self.CT_ENGINES.engineTranslateBatch({ texts: norm.map((x) => x.text), srcLang: norm[0].srcLang || '', dstLang: finalDst });
      if (br && br.ok && Array.isArray(br.parts) && br.parts.length === norm.length) {
        const results = norm.map((x, i) => ({ id: x.id, ok: true, text: br.parts[i] || '', error: null, provider: br.provider, model: br.model }));
        const usedByProvider = {}; usedByProvider[(br.provider || 'engine') + '/' + (br.model || '?')] = norm.length;
        return { ok: true, needConfig: false, results, success: norm.length, fail: 0, total: norm.length, usedByProvider,
                 lastResp: { provider: br.provider, model: br.model, durationMs: br.durationMs, batched: true, count: br.count } };
      }
      if (br && !br.ok && !br.retryable && !['batch_split_mismatch', 'too_few', 'not_openai_compat', 'role_no_batch', 'no_prompts'].includes(br.error)) {
        logFailure(br.provider || 'engine', br.model || '', br, norm.join('').length);
      }
    } catch (e) { console.warn('[PVS] %% batch 异常,回退逐条', e); }
  }

  let success = 0, fail = 0, needConfig = false;
  const usedByProvider = {}; let lastResp = null;
  const results = await mapLimit(norm, conc, async (it) => {
    const r = await self.CT_ENGINES.engineTranslate({ text: it.text, srcLang: it.srcLang, dstLang: finalDst });
    if (r.needConfig) needConfig = true;
    if (r && r.ok) { success++; const prov = r.provider || 'engine'; usedByProvider[prov] = (usedByProvider[prov] || 0) + 1; lastResp = r; }
    else { fail++; if (r && !r.needConfig) logFailure(r.provider || 'engine', r.model || '', r, (it.text || '').length); }
    return { id: it.id, ok: !!(r && r.ok), text: (r && r.text) || '', error: (r && r.error) || null, provider: r && r.provider, model: r && r.model };
  });
  return { ok: !needConfig, needConfig, results, success, fail, total: norm.length, usedByProvider,
           lastResp: lastResp ? { provider: lastResp.provider, model: lastResp.model, durationMs: lastResp.durationMs, fallbackUsed: !!lastResp.fallbackUsed } : null };
}

// ---------- 引擎状态 / 模型列表 / 测试服务 ----------
async function handleHealth() {
  try {
    const s = await self.CT_ENGINES.engineStatus();
    return { ok: !!s.ok, data: s, needConfig: !!s.needConfig };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

async function handleListModels(msg) {
  let { baseURL, apiKey } = msg;
  if (!baseURL) { const s = await chrome.storage.local.get(['baseURL', 'apiKey']); baseURL = baseURL || s.baseURL; apiKey = apiKey || s.apiKey; }
  return await self.CT_ENGINES.listModels({ baseURL, apiKey: apiKey || '' });
}

async function handleTestService(msg) {
  let { baseURL, apiKey, model } = msg || {};
  if (!baseURL || !model) { const s = await chrome.storage.local.get(['baseURL', 'apiKey', 'model']); baseURL = baseURL || s.baseURL; apiKey = apiKey !== undefined ? apiKey : s.apiKey; model = model || s.model; }
  if (!baseURL || !model) return { ok: false, needConfig: true, error: '请先填 API Base URL 和模型名' };
  const t0 = Date.now();
  const r = await self.CT_ENGINES.callOpenAICompat({ baseURL, apiKey: apiKey || '', model, text: 'Hello', srcLang: 'en', dstLang: 'zh', promptRole: 'general', terms: '' });
  const durationMs = Date.now() - t0;
  if (r && r.ok) return { ok: true, model: r.model || model, durationMs, sample: (r.text || '').slice(0, 40) };
  return { ok: false, error: (r && r.error) || 'unknown', httpStatus: r && r.httpStatus, durationMs };
}

// ---------- 字幕轨代取:仅允许 youtube.com timedtext(防滥用为通用代理) ----------
async function handleFetchText(msg) {
  const url = msg && msg.url;
  if (!url || typeof url !== 'string') return { ok: false, error: 'no_url' };
  if (!/^https:\/\/(www\.)?youtube\.com\/api\/timedtext/.test(url)) return { ok: false, error: 'url_not_allowed' };
  try {
    const r = await fetch(url, { credentials: 'include', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await r.text();
    return { ok: r.ok && text.length > 0, status: r.status, text };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---------- 多模态帧理解:{base64, system, user, maxTokens} → {baseURL}/chat/completions 的 image_url ----------
async function handleVisionNote(msg) {
  const s = await chrome.storage.local.get(['baseURL', 'apiKey', 'model', 'visionModel']);
  const baseURL = (s.baseURL || '').replace(/\/+$/, '');
  const model = s.visionModel || s.model; // 允许单独配多模态模型,缺省复用主模型
  if (!baseURL || !model) return { ok: false, needConfig: true, error: '请先在设置里配置端点与模型' };
  const dataUrl = msg && msg.base64;
  if (!dataUrl || typeof dataUrl !== 'string' || !/^data:image\//.test(dataUrl)) return { ok: false, error: 'no_image' };
  const body = {
    model,
    messages: [
      { role: 'system', content: msg.system || '你是视频笔记助手。' },
      { role: 'user', content: [ { type: 'text', text: msg.user || '描述这一帧。' }, { type: 'image_url', image_url: { url: dataUrl } } ] },
    ],
    max_tokens: Number(msg.maxTokens) || 700,
    stream: false,
  };
  // 多模态推理模型(Agnes 2.5 / Kimi k3 等)可能强制 temperature 或需更大 max_tokens,不设 temperature 用各家默认,避免 400。
  const headers = { 'Content-Type': 'application/json' };
  if (s.apiKey) headers['Authorization'] = `Bearer ${s.apiKey}`;
  const t0 = Date.now();
  try {
    const r = await fetch(`${baseURL}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
    const durationMs = Date.now() - t0;
    if (!r.ok) { const txt = await r.text().catch(() => ''); return { ok: false, error: `HTTP ${r.status}`, httpStatus: r.status, detail: txt.slice(0, 200), durationMs }; }
    const data = await r.json();
    const ch = data && data.choices && data.choices[0];
    let content = ch && ch.message && ch.message.content;
    if (Array.isArray(content)) content = content.map((c) => (c && c.text) || '').join('');
    const text = (content || '').trim();
    if (!text) return { ok: false, error: 'empty', httpStatus: r.status, durationMs };
    return { ok: true, text, model, durationMs };
  } catch (e) { return { ok: false, error: String((e && e.message) || e), durationMs: Date.now() - t0 }; }
}

// ---------- 失败诊断日志(只存本机 _ct_log 环形 ≤100 条,不上行;不记文本内容) ----------
async function logCT(entry) {
  try {
    const { _ct_log } = await chrome.storage.local.get('_ct_log');
    const arr = Array.isArray(_ct_log) ? _ct_log : [];
    arr.push({ ts: Date.now(), ...entry });
    while (arr.length > 100) arr.shift();
    await chrome.storage.local.set({ _ct_log: arr });
  } catch {}
}
function logFailure(provider, model, r, textLen) {
  console.warn(`[PVS] 翻译失败 provider=${provider} model=${model} err=${r && r.error} http=${r && r.httpStatus || ''} len=${textLen}`);
  logCT({ kind: 'fail', provider, model, error: (r && r.error) || 'unknown', httpStatus: r && r.httpStatus, durationMs: r && r.durationMs, textLen });
}

// ---------- 安装/启动默认值 ----------
chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(['dstLang', 'engine']);
  const patch = {};
  if (!cur.dstLang) patch.dstLang = self.CT_LANGS.guessTargetLang(); // 默认按系统语言
  if (!cur.engine) patch.engine = 'auto';
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  try { await self.CT_ENGINES.detectEngine(true); } catch {}
});
