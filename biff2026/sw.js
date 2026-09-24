/* 오프라인용 서비스 워커
 * - 처음 열 때 앱 파일을 모두 휴대폰에 저장합니다. 네트워크가 없으면 저장본으로 열립니다.
 * - 온라인이면 저장본을 바로 보여 주고, 뒤에서 새 파일을 받아 저장본을 바꿉니다.
 *   내용이 바뀌었으면 화면에 '새로고침' 안내를 띄웁니다.
 *   (schedule.js만 고쳤다면 이 파일은 건드리지 않아도 됩니다.)
 * - 파일을 새로 추가하거나 이름을 바꿨을 때만 VERSION 숫자를 올리고 CORE 목록을 고치세요. */
const VERSION = 'biff26-v1';
const CORE = [
  './index.html',
  './styles.css',
  './app.js',
  './schedule.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];
const INDEX = new URL('./index.html', self.registration.scope).href;
const TEXT = /\.(html|css|js|json)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // 지도 등 외부 주소는 그대로 통과
  const isPage = req.mode === 'navigate';
  const key = isPage ? INDEX : url.origin + url.pathname;   // ?now= 같은 쿼리는 무시
  event.respondWith(respond(event, key, isPage));
});

async function respond(event, key, isPage) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(key);
  // 저장본은 곧 화면으로 보내져 읽히므로, 비교용 사본을 미리 떠 둡니다.
  const before = cached && TEXT.test(key) ? cached.clone().text() : null;
  const fresh = fetch(key, { cache: 'no-cache' })
    .then(async (res) => {
      if (!res || !res.ok) return res;
      let changed = false;
      if (before) changed = (await before) !== (await res.clone().text());
      await cache.put(key, res.clone());
      if (changed) await notifyUpdated();
      return res;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }
  const res = await fresh;
  if (res) return res;
  if (isPage) {
    const page = await cache.match(INDEX);
    if (page) return page;
  }
  return new Response('오프라인 상태이고 저장된 파일이 없습니다.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// 새로 연 화면이 아직 준비 중일 수 있어 몇 번 나눠 알립니다 (화면 쪽은 한 번만 표시).
async function notifyUpdated() {
  for (const wait of [0, 1500, 4000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const list = await self.clients.matchAll({ type: 'window' });
    list.forEach((c) => c.postMessage({ type: 'updated' }));
  }
}
