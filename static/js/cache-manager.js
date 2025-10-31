class CacheManager {
    constructor() {
        this.dbName = 'AdScreenCache';
        this.dbVersion = 1;
        this.maxMemoryCacheSize = 500 * 1024 * 1024; // 500MB内存缓存
        this.maxDiskCacheSize = 2 * 1024 * 1024 * 1024; // 2GB磁盘缓存
        
        this.memoryCache = new Map(); // L1缓存
        this.diskCache = new Map(); // L2缓存元数据
        this.cacheStats = {
            hits: 0,
            misses: 0,
            memoryUsage: 0,
            diskUsage: 0
        };
        
        this.initDatabase();
        this.startCleanupTimer();
    }
    
    // 初始化IndexedDB
    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // 创建视频缓存存储
                if (!db.objectStoreNames.contains('videos')) {
                    const videoStore = db.createObjectStore('videos', { keyPath: 'url' });
                    videoStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
                    videoStore.createIndex('size', 'size', { unique: false });
                    videoStore.createIndex('playCount', 'playCount', { unique: false });
                }
                
                // 创建播放列表存储
                if (!db.objectStoreNames.contains('playlists')) {
                    db.createObjectStore('playlists', { keyPath: 'id' });
                }
                
                // 创建配置存储
                if (!db.objectStoreNames.contains('config')) {
                    db.createObjectStore('config', { keyPath: 'key' });
                }
            };
        });
    }
    
    // 多级缓存获取
    async getVideo(url) {
        // L1: 内存缓存
        if (this.memoryCache.has(url)) {
            const cached = this.memoryCache.get(url);
            cached.lastAccessed = Date.now();
            cached.accessCount++;
            this.cacheStats.hits++;
            return cached.blobUrl;
        }
        
        // L2: 磁盘缓存
        const diskCached = await this.getFromDiskCache(url);
        if (diskCached) {
            // 提升到内存缓存
            await this.addToMemoryCache(url, diskCached.blob);
            this.cacheStats.hits++;
            return diskCached.blobUrl;
        }
        
        this.cacheStats.misses++;
        return null;
    }
    
    // 缓存视频
    async cacheVideo(url, blob) {
        try {
            // L1: 添加到内存缓存
            await this.addToMemoryCache(url, blob);
            
            // L2: 添加到磁盘缓存
            await this.addToDiskCache(url, blob);
            
            // 更新缓存统计
            this.updateCacheStats();
            
        } catch (error) {
            console.error('缓存视频失败:', error);
        }
    }
    
    // 内存缓存管理
    async addToMemoryCache(url, blob) {
        const blobUrl = URL.createObjectURL(blob);
        const cacheEntry = {
            blobUrl,
            blob,
            size: blob.size,
            lastAccessed: Date.now(),
            accessCount: 1,
            timestamp: Date.now()
        };
        
        this.memoryCache.set(url, cacheEntry);
        this.cacheStats.memoryUsage += blob.size;
        
        // 检查内存限制，执行LRU清理
        if (this.cacheStats.memoryUsage > this.maxMemoryCacheSize) {
            await this.cleanupMemoryCache();
        }
        
        return blobUrl;
    }
    
    // 磁盘缓存管理
    async addToDiskCache(url, blob) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');
            
            const cacheEntry = {
                url,
                blob,
                size: blob.size,
                lastAccessed: Date.now(),
                playCount: 0,
                timestamp: Date.now()
            };
            
            const request = store.put(cacheEntry);
            
            request.onsuccess = () => {
                this.cacheStats.diskUsage += blob.size;
                resolve();
            };
            
            request.onerror = () => reject(request.error);
        });
    }
    
    async getFromDiskCache(url) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videos'], 'readonly');
            const store = transaction.objectStore('videos');
            const request = store.get(url);
            
            request.onsuccess = () => {
                if (request.result) {
                    const result = request.result;
                    result.lastAccessed = Date.now();
                    result.playCount++;
                    
                    // 更新访问时间
                    const updateTransaction = this.db.transaction(['videos'], 'readwrite');
                    const updateStore = updateTransaction.objectStore('videos');
                    updateStore.put(result);
                    
                    resolve(result);
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = () => reject(request.error);
        });
    }
    
    // 缓存清理策略
    async cleanupMemoryCache() {
        const entries = Array.from(this.memoryCache.entries());
        
        // LRU策略：按最后访问时间排序
        entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
        
        let currentSize = this.cacheStats.memoryUsage;
        const targetSize = this.maxMemoryCacheSize * 0.7; // 清理到70%
        
        for (const [url, entry] of entries) {
            if (currentSize <= targetSize) break;
            
            URL.revokeObjectURL(entry.blobUrl);
            this.memoryCache.delete(url);
            currentSize -= entry.size;
        }
        
        this.cacheStats.memoryUsage = currentSize;
    }
    
    async cleanupDiskCache() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');
            const index = store.index('lastAccessed');
            const request = index.openCursor();
            
            let currentSize = this.cacheStats.diskUsage;
            const targetSize = this.maxDiskCacheSize * 0.8; // 清理到80%
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor && currentSize > targetSize) {
                    currentSize -= cursor.value.size;
                    cursor.delete();
                    cursor.continue();
                } else {
                    this.cacheStats.diskUsage = currentSize;
                    resolve();
                }
            };
            
            request.onerror = () => reject(request.error);
        });
    }
    
    // 智能缓存策略
    shouldCache(url, size, popularity) {
        // 基于文件大小、热度、播放频率的智能决策
        const maxFileSize = 100 * 1024 * 1024; // 100MB最大文件
        
        if (size > maxFileSize) {
            return false; // 过大文件不缓存
        }
        
        // 热度评分算法
        const heatScore = popularity * (1 / Math.log(size / 1024 + 1));
        return heatScore > 0.5; // 热度阈值
    }
    
    // 播放列表管理
    async savePlaylist(playlist) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['playlists'], 'readwrite');
            const store = transaction.objectStore('playlists');
            
            const playlistData = {
                id: 'current',
                videos: playlist,
                lastUpdated: Date.now(),
                version: '1.0'
            };
            
            const request = store.put(playlistData);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async getPlaylist() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['playlists'], 'readonly');
            const store = transaction.objectStore('playlists');
            const request = store.get('current');
            
            request.onsuccess = () => {
                resolve(request.result ? request.result.videos : []);
            };
            
            request.onerror = () => reject(request.error);
        });
    }
    
    // 统计和监控
    updateCacheStats() {
        // 更新内存使用显示
        const memoryElement = document.getElementById('memory-usage');
        if (memoryElement) {
            const memoryMB = (this.cacheStats.memoryUsage / (1024 * 1024)).toFixed(1);
            memoryElement.textContent = `${memoryMB}MB`;
        }
        
        // 计算缓存命中率
        const total = this.cacheStats.hits + this.cacheStats.misses;
        const hitRate = total > 0 ? (this.cacheStats.hits / total * 100).toFixed(1) : 0;
        
        console.log(`缓存统计: 命中率 ${hitRate}%, 内存使用: ${(this.cacheStats.memoryUsage / (1024 * 1024)).toFixed(1)}MB`);
    }
    
    // 定期清理
    startCleanupTimer() {
        setInterval(() => {
            this.cleanupMemoryCache();
            this.cleanupDiskCache();
        }, 5 * 60 * 1000); // 每5分钟清理一次
    }
    
    // 清空缓存
    async clearCache() {
        // 清空内存缓存
        this.memoryCache.forEach(entry => {
            URL.revokeObjectURL(entry.blobUrl);
        });
        this.memoryCache.clear();
        
        // 清空磁盘缓存
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videos'], 'readwrite');
            const store = transaction.objectStore('videos');
            const request = store.clear();
            
            request.onsuccess = () => {
                this.cacheStats.memoryUsage = 0;
                this.cacheStats.diskUsage = 0;
                resolve();
            };
            
            request.onerror = () => reject(request.error);
        });
    }
    
    // 获取缓存信息
    getCacheInfo() {
        return {
            memoryCacheSize: this.memoryCache.size,
            memoryUsage: this.cacheStats.memoryUsage,
            diskUsage: this.cacheStats.diskUsage,
            hitRate: this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) || 0
        };
    }
}

// 导出单例
window.CacheManager = CacheManager;