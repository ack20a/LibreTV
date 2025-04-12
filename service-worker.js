// 缓存名称，修改此值可强制更新缓存
const CACHE_NAME = 'yongkang-tv-cache-v2';
const STATIC_CACHE_NAME = 'yongkang-tv-static-v2';
const DYNAMIC_CACHE_NAME = 'yongkang-tv-dynamic-v2';
const OFFLINE_PAGE = '/index.html';

// 需要缓存的核心静态资源
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/player.html',
  '/about.html',
  '/privacy.html',
  '/css/styles.css',
  '/js/api.js',
  '/js/app.js',
  '/js/config.js',
  '/js/ui.js',
  '/favicon.ico',
  'https://tv.ack20.eu.org/logo.png',
  'https://cdn.tailwindcss.com'
];

// 不应该缓存的资源类型
const EXCLUDE_FROM_CACHE = [
  '.m3u8',
  '.ts',
  '.mp4',
  'analytics',
  'track',
  'stats'
];

// 检查请求是否是API请求
const isApiRequest = (url) => {
  return url.includes('/api/') || url.includes('?ac=') || url.includes('?wd=');
};

// 检查是否应该缓存资源
const shouldCache = (url) => {
  if (!url) return false;
  return !EXCLUDE_FROM_CACHE.some(exclude => url.includes(exclude)) && !isApiRequest(url);
};

// 安装 Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker 正在安装...');
  
  // 执行安装步骤
  event.waitUntil(
    Promise.all([
      // 缓存核心静态资源
      caches.open(STATIC_CACHE_NAME)
        .then(cache => {
          console.log('缓存核心静态资源');
          return cache.addAll(CORE_ASSETS);
        }),
      
      // 创建动态缓存
      caches.open(DYNAMIC_CACHE_NAME)
        .then(cache => {
          console.log('创建动态缓存');
          return cache;
        })
    ])
    .then(() => self.skipWaiting())
  );
});

// 激活 Service Worker
self.addEventListener('activate', event => {
  console.log('Service Worker 已激活');
  
  // 清理旧版本缓存
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cacheName => {
          return cacheName !== STATIC_CACHE_NAME && 
                 cacheName !== DYNAMIC_CACHE_NAME && 
                 cacheName !== CACHE_NAME;
        }).map(cacheName => {
          console.log('清理旧缓存:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 网络请求拦截
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // 跳过不应该缓存的请求
  if (!shouldCache(event.request.url)) {
    return;
  }
  
  // 网站页面路由请求 - 采用 Cache First 策略
  if (event.request.mode === 'navigate' || 
      (event.request.method === 'GET' && 
       event.request.headers.get('accept').includes('text/html'))) {
    
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          return response || fetch(event.request)
            .then(fetchResponse => {
              // 主页和核心页面缓存
              if (CORE_ASSETS.some(asset => 
                  asset === '/' || 
                  url.pathname.endsWith(asset))) {
                
                return caches.open(STATIC_CACHE_NAME)
                  .then(cache => {
                    cache.put(event.request, fetchResponse.clone());
                    return fetchResponse;
                  });
              }
              return fetchResponse;
            })
            .catch(() => {
              // 离线时返回首页
              return caches.match(OFFLINE_PAGE);
            });
        })
    );
    return;
  }
  
  // 静态资源请求 - 采用 Cache First 策略
  if (event.request.method === 'GET' &&
     (url.pathname.startsWith('/css/') || 
      url.pathname.startsWith('/js/') || 
      url.pathname.endsWith('.png') || 
      url.pathname.endsWith('.ico'))) {
    
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          return response || fetch(event.request)
            .then(fetchResponse => {
              // 缓存请求资源
              return caches.open(STATIC_CACHE_NAME)
                .then(cache => {
                  cache.put(event.request, fetchResponse.clone());
                  return fetchResponse;
                });
            });
        })
    );
    return;
  }
  
  // API请求 - 采用 Network First 策略
  if (isApiRequest(event.request.url)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          return response;
        })
        .catch(() => {
          // API请求失败时尝试从缓存获取
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // 其他GET请求 - 采用混合策略
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          // 同时发送网络请求更新缓存
          const fetchPromise = fetch(event.request)
            .then(networkResponse => {
              // 更新缓存
              if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                caches.open(DYNAMIC_CACHE_NAME)
                  .then(cache => {
                    cache.put(event.request, responseToCache);
                  });
              }
              return networkResponse;
            })
            .catch(() => {
              console.log('离线模式，从缓存获取');
            });
          
          // 返回缓存的响应或等待网络响应
          return response || fetchPromise;
        })
    );
    return;
  }
});

// 接收消息
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 定期清理过旧的动态缓存
self.addEventListener('periodicsync', event => {
  if (event.tag === 'clear-old-caches') {
    event.waitUntil(
      caches.open(DYNAMIC_CACHE_NAME).then(cache => {
        cache.keys().then(keys => {
          // 清理超过7天的资源
          const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          keys.forEach(key => {
            cache.match(key).then(response => {
              if (response && response.headers.get('date')) {
                const dateHeader = response.headers.get('date');
                const responseDate = new Date(dateHeader).getTime();
                
                if (responseDate < sevenDaysAgo) {
                  cache.delete(key);
                }
              }
            });
          });
        });
      })
    );
  }
});