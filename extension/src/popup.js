// popup.js — Prisir 视频学习弹层:状态灯 + 端点配置 + 设置入口
const $ = (id) => document.getElementById(id);

async function refreshStatus() {
  const led = $('led'), line = $('status-line'), meta = $('status-meta');
  try {
    const s = await chrome.storage.local.get(['engine', 'baseURL', 'model', 'visionModel', 'apiKey']);
    const hasCustom = s.baseURL && s.model;
    const visionReady = hasCustom && s.apiKey; // 帧笔记需自定义多模态端点
    if (s.engine === 'openai_compat' && hasCustom) {
      led.className = 'led ok';
      line.textContent = '自定义端点已配置';
      meta.textContent = `字幕:${s.model} · 笔记:${s.visionModel || s.model}${visionReady ? '' : ' · 缺 Key'}`;
    } else if (s.engine === 'google_gtx' || s.engine === 'auto') {
      led.className = 'led warn';
      line.textContent = '字幕:内置免 Key 引擎';
      meta.textContent = visionReady ? `笔记:${s.visionModel || s.model} 已配` : '帧笔记需配自定义多模态端点(下方)';
    } else {
      led.className = 'led warn';
      line.textContent = '自动模式';
      meta.textContent = visionReady ? `笔记:${s.visionModel || s.model} 已配` : '帧笔记需配自定义多模态端点';
    }
  } catch (e) { line.textContent = '状态读取失败'; }
}

async function loadForm() {
  const s = await chrome.storage.local.get(['baseURL', 'model', 'visionModel', 'apiKey']);
  $('baseURL').value = s.baseURL || '';
  $('model').value = s.model || '';
  $('visionModel').value = s.visionModel || '';
  $('apiKey').value = s.apiKey || '';
}

$('save-adv').addEventListener('click', async () => {
  const payload = {
    engine: 'openai_compat',
    baseURL: $('baseURL').value.trim(),
    model: $('model').value.trim(),
    visionModel: $('visionModel').value.trim(),
  };
  const apiKey = $('apiKey').value.trim();
  if (apiKey) payload.apiKey = apiKey;
  await chrome.storage.local.set(payload);
  $('adv-msg').textContent = '已保存(引擎切为自定义端点)';
  $('adv-msg').style.color = '#1e8449';
  refreshStatus();
  setTimeout(() => { $('adv-msg').textContent = ''; }, 4000);
});

$('test-service').addEventListener('click', async () => {
  const baseURL = $('baseURL').value.trim(), apiKey = $('apiKey').value.trim(), model = $('model').value.trim() || $('visionModel').value.trim();
  const msg = $('adv-msg');
  if (!baseURL || !model) { msg.textContent = '先填 URL 和模型名'; msg.style.color = '#c0392b'; return; }
  msg.textContent = '测试中…'; msg.style.color = '#9aa3b2';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'test-service', baseURL, apiKey, model });
    if (resp && resp.ok) { msg.textContent = `✓ 通了 · ${resp.model} · ${resp.durationMs}ms`; msg.style.color = '#1e8449'; }
    else { msg.textContent = `✗ ${(resp && resp.error) || '失败'}`; msg.style.color = '#c0392b'; }
  } catch (e) { msg.textContent = `✗ ${(e && e.message) || e}`; msg.style.color = '#c0392b'; }
  setTimeout(() => { msg.textContent = ''; }, 6000);
});

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

document.addEventListener('DOMContentLoaded', () => { refreshStatus(); loadForm(); });
