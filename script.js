const CONFIG = {
  fortunes: [
    { level: '大凶', weight: 3, emoji: '💀' },
    { level: '凶',   weight: 10, emoji: '😈' },
    { level: '末吉', weight: 25, emoji: '🤔' },
    { level: '小吉', weight: 20, emoji: '😊' },
    { level: '吉',   weight: 17, emoji: '🙂' },
    { level: '中吉', weight: 15, emoji: '😄' },
    { level: '大吉', weight: 10, emoji: '🎉' },
  ],
  models: [
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
  ],
  cooldownMs: 60000,
  maxRetries: 2,
  jitterMaxMs: 1500,
  cacheTTLMs: 300000,
};

const CACHE_KEY = 'omikuji_cache';

const $ = id => document.getElementById(id);
const resultDiv = $('result');
const loadingDiv = $('loading');
const fortuneLevel = $('fortune-level');
const fortuneText = $('fortune-text');
const drawBtn = $('draw-btn');
const errorMsg = $('error-msg');
const seal = document.querySelector('.seal');
const fortuneBox = $('fortune-box');
const categoriesEl = $('fortune-categories');
const catHealth = $('cat-health');
const catLove = $('cat-love');
const catWork = $('cat-work');
const catMoney = $('cat-money');

let lastDrawTime = 0;

function pickFortune() {
  const total = CONFIG.fortunes.reduce((s, f) => s + f.weight, 0);
  let r = Math.random() * total;
  for (const f of CONFIG.fortunes) {
    r -= f.weight;
    if (r <= 0) return f;
  }
  return CONFIG.fortunes[CONFIG.fortunes.length - 1];
}

function getCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp > CONFIG.cacheTTLMs) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch { return null; }
}

function setCache(fortune, text) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fortune, text, timestamp: Date.now() }));
  } catch {}
}

function pickModel() {
  return CONFIG.models[Math.floor(Math.random() * CONFIG.models.length)];
}

function jitter() {
  return new Promise(r => setTimeout(r, Math.random() * CONFIG.jitterMaxMs));
}

async function callGemini(fortune) {
  const apiKey = GEMINI_API_KEY;
  const model = pickModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: 'おみくじ占い師。以下の4項目を「健康：…\n恋愛：…\n学業：…\n金運：…」の形式で出力。各40字以内。余計な説明不要。' }]
    },
    contents: [
      { role: 'user', parts: [{ text: `${fortune.level}の運勢を教えて` }] }
    ],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 600,
      responseMimeType: 'text/plain',
    },
  };

  for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const wait = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, wait));
      }
      await jitter();

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status === 503) {
        if (attempt < CONFIG.maxRetries) continue;
        throw new Error('混雑しています。しばらく待ってからもう一度お試しください。');
      }
      if (!res.ok) throw new Error('APIエラーです！スタッフに連絡してください');

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) throw new Error('APIエラーです！スタッフに連絡してください');
      return text;

    } catch (e) {
      if (attempt >= CONFIG.maxRetries) throw e;
    }
  }
}

function showFortune(fortune, text) {
  fortuneLevel.textContent = fortune.emoji + ' ' + fortune.level;
  fortuneText.classList.add('hidden');
  categoriesEl.classList.remove('hidden');

  const cats = { health: '', love: '', work: '', money: '' };
  for (const line of text.split('\n')) {
    const m = line.match(/^(健康|恋愛|学業|金運)\s*[：:]\s*(.+)/);
    if (!m) continue;
    const key = m[1] === '健康' ? 'health' : m[1] === '恋愛' ? 'love' : m[1] === '金運' ? 'money' : 'work';
    cats[key] = m[2];
  }

  catHealth.textContent = cats.health || '';
  catLove.textContent = cats.love || '';
  catWork.textContent = cats.work || '';
  catMoney.textContent = cats.money || '';

  if (seal) seal.style.display = 'none';
  resultDiv.classList.remove('hidden');
  loadingDiv.classList.add('hidden');
  errorMsg.classList.add('hidden');
}

function showLoading() {
  if (seal) seal.style.display = 'none';
  fortuneText.classList.remove('hidden');
  categoriesEl.classList.add('hidden');
  resultDiv.classList.add('hidden');
  loadingDiv.classList.remove('hidden');
  errorMsg.classList.add('hidden');
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  if (seal) seal.style.display = 'none';
  resultDiv.classList.remove('hidden');
  loadingDiv.classList.add('hidden');
}

drawBtn.addEventListener('click', async () => {
  const now = Date.now();
  if (now - lastDrawTime < CONFIG.cooldownMs) {
    const remaining = Math.ceil((CONFIG.cooldownMs - (now - lastDrawTime)) / 1000);
    showError(`少し待ってください（あと${remaining}秒）`);
    return;
  }

  const fortune = pickFortune();
  const cached = getCache();
  if (cached && cached.fortune.level === fortune.level) {
    showFortune(cached.fortune, cached.text);
    lastDrawTime = now;
    return;
  }

  fortuneBox.classList.add('shaking');
  setTimeout(() => fortuneBox.classList.remove('shaking'), 500);

  showLoading();
  drawBtn.disabled = true;
  lastDrawTime = now;

  try {
    const text = await callGemini(fortune);
    setCache(fortune, text);
    showFortune(fortune, text);
  } catch (e) {
    showError(e.message);
    lastDrawTime = 0;
  } finally {
    drawBtn.disabled = false;
  }
});
