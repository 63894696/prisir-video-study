// options.js — Prisir 视频学习设置,保存到 chrome.storage.local(仅存本机)

const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get([
    'engine', 'baseURL', 'model', 'visionModel', 'apiKey',
    'dstLang', 'temperature',
    'subtitlesEnabled', 'subtitleMode', 'subtitlePreferManual',
    'notesIntervalSec',
  ]);
  const eng = s.engine || 'auto';
  const r = document.querySelector(`input[name="engine"][value="${eng}"]`);
  if (r) r.checked = true;
  $('baseURL').value = s.baseURL || '';
  $('model').value = s.model || '';
  $('visionModel').value = s.visionModel || '';
  $('apiKey').value = s.apiKey || '';
  CT_LANGS.fillLangSelect($('dstLang'));
  $('dstLang').value = s.dstLang || CT_LANGS.guessTargetLang();
  $('temperature').value = (s.temperature != null) ? s.temperature : 0.2;
  $('subtitlesEnabled').checked = s.subtitlesEnabled !== false;
  $('subtitleMode').value = s.subtitleMode === 'replace' ? 'replace' : 'bilingual';
  $('subtitlePreferManual').checked = s.subtitlePreferManual !== false;
  $('notesIntervalSec').value = s.notesIntervalSec || 8;
  toggleFieldsets();
}

function toggleFieldsets() {
  const eng = document.querySelector('input[name="engine"]:checked')?.value || 'auto';
  $('custom-fieldset').style.display = eng === 'openai_compat' ? '' : 'none';
}
document.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener('change', toggleFieldsets));

async function save() {
  const engine = document.querySelector('input[name="engine"]:checked')?.value || 'auto';
  const payload = {
    engine,
    dstLang: $('dstLang').value,
    temperature: Math.max(0, Math.min(2, parseFloat($('temperature').value) || 0)),
    subtitlesEnabled: $('subtitlesEnabled').checked,
    subtitleMode: $('subtitleMode').value === 'replace' ? 'replace' : 'bilingual',
    subtitlePreferManual: $('subtitlePreferManual').checked,
    notesIntervalSec: Math.max(3, Math.min(60, parseInt($('notesIntervalSec').value, 10) || 8)),
  };
  const baseURL = $('baseURL').value.trim();
  const model = $('model').value.trim();
  const visionModel = $('visionModel').value.trim();
  const apiKey = $('apiKey').value.trim();
  if (baseURL) payload.baseURL = baseURL;
  if (model) payload.model = model;
  payload.visionModel = visionModel; // 允许清空(留空复用主模型)
  if (apiKey) payload.apiKey = apiKey;

  await chrome.storage.local.set(payload);

  let info = '已保存';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'health' });
    const d = resp && resp.data;
    if (d && d.ok) info = `已保存 · ${d.engine || '引擎就绪'}`;
    else if (d && d.needConfig) info = '已保存 · 帧笔记需配置自定义端点(多模态模型)';
  } catch {}
  $('msg').textContent = info;
  setTimeout(() => { $('msg').textContent = ''; }, 5000);
}

async function reset() {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ engine: 'auto', dstLang: CT_LANGS.guessTargetLang(), enabled: true });
  await load();
  $('msg').textContent = '已恢复默认(自动模式)';
  setTimeout(() => { $('msg').textContent = ''; }, 3000);
}

$('save').addEventListener('click', save);
$('reset').addEventListener('click', reset);

// 拉取模型列表(用填的 URL+Key 查端点,免手输模型名)
$('fetch-models').addEventListener('click', async () => {
  const btn = $('fetch-models'), hint = $('fetch-models-hint');
  const baseURL = $('baseURL').value.trim(), apiKey = $('apiKey').value.trim();
  if (!baseURL) { hint.textContent = '请先填 API Base URL,再拉取模型列表。'; $('baseURL').focus(); return; }
  btn.disabled = true; btn.textContent = '拉取中…';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'list-models', baseURL, apiKey });
    if (resp && resp.ok && resp.models && resp.models.length) {
      const dl = $('model-list'); dl.innerHTML = '';
      resp.models.forEach((m) => { const o = document.createElement('option'); o.value = m; dl.appendChild(o); });
      hint.textContent = `已拉取 ${resp.models.length} 个模型,点模型输入框从下拉选择。`;
      if (!$('model').value.trim()) $('model').value = resp.models[0];
      $('model').focus();
    } else {
      const err = (resp && resp.error) || 'unknown';
      hint.textContent = err === 'empty' ? '端点返回空列表——可能不支持 /models,请手输模型名。' : `拉取失败(${err})。可改用手输模型名。`;
    }
  } catch (e) { hint.textContent = `拉取失败:${(e && e.message) || e}`; }
  finally { btn.disabled = false; btn.textContent = '拉取模型列表'; }
});

// 测试服务:用当前表单填的(未保存也行)端点+Key+模型发一条 "Hello"
$('test-service').addEventListener('click', async () => {
  const btn = $('test-service'), out = $('test-service-result');
  const baseURL = $('baseURL').value.trim(), apiKey = $('apiKey').value.trim(), model = $('model').value.trim();
  if (!baseURL || !model) { out.textContent = '请先填 API Base URL 和模型名。'; out.style.color = '#c0392b'; return; }
  btn.disabled = true; btn.textContent = '测试中…'; out.textContent = '';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'test-service', baseURL, apiKey, model });
    if (resp && resp.ok) { out.textContent = `✓ 通了 · ${resp.model} · ${resp.durationMs}ms${resp.sample ? ` · 回包:${resp.sample}` : ''}`; out.style.color = '#1e8449'; }
    else { out.textContent = `✗ ${(resp && resp.error) || '失败'}${resp && resp.httpStatus ? ` (HTTP ${resp.httpStatus})` : ''}`; out.style.color = '#c0392b'; }
  } catch (e) { out.textContent = `✗ 通信失败:${(e && e.message) || e}`; out.style.color = '#c0392b'; }
  finally { btn.disabled = false; btn.textContent = '测试服务'; setTimeout(() => { out.textContent = ''; }, 8000); }
});

document.addEventListener('DOMContentLoaded', load);
