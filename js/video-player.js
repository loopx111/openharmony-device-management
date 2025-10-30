class VideoPlayer {
    constructor() {
        this.video1 = document.getElementById('video1');
        this.video2 = document.getElementById('video2');
        this.currentPlayer = this.video1;
        this.nextPlayer = this.video2;
        this.isSwitching = false;
        
        // 播放列表和状态
        this.playlist = [];
        this.currentIndex = 0;
        this.preloadedVideos = new Map(); // 预加载视频缓存
        
        // 本地文件存储
        this.localFiles = new Map(); // 本地文件路径映射
        this.downloadQueue = []; // 下载队列
        this.isDownloading = false;
        
        // 播放配置
        this.playMode = 'sequential'; // sequential, random, loop
        this.playOrder = []; // 播放顺序
        
        // 图片显示元素
        this.imageContainer = document.getElementById('image-container');
        this.imageDisplay = document.getElementById('image-display');
        
        // 支持的图片格式
        this.supportedImageFormats = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
        this.supportedVideoFormats = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
        
        // 性能监控
        this.performanceStats = {
            frameRate: 0,
            stutterCount: 0,
            totalFrames: 0
        };
        
        this.initEventListeners();
        this.startPerformanceMonitoring();
        this.loadLocalPlaylist(); // 加载本地播放列表
    }
    
    initEventListeners() {
        // 视频事件监听
        [this.video1, this.video2].forEach(video => {
            video.addEventListener('loadeddata', this.onVideoLoaded.bind(this));
            video.addEventListener('canplay', this.onVideoCanPlay.bind(this));
            video.addEventListener('ended', this.onVideoEnded.bind(this));
            video.addEventListener('error', this.onVideoError.bind(this));
            video.addEventListener('waiting', this.onVideoWaiting.bind(this));
            video.addEventListener('playing', this.onVideoPlaying.bind(this));
        });
        
        // 错误重试按钮
        document.getElementById('retry-btn').addEventListener('click', () => {
            this.retryCurrentVideo();
        });
    }
    
    // 设置播放列表（从服务器分发消息）
    async setPlaylist(videos, playMode = 'sequential') {
        this.playMode = playMode;
        this.playlist = videos;
        this.currentIndex = 0;
        this.preloadedVideos.clear();
        
        // 保存播放列表到本地
        await this.saveLocalPlaylist();
        
        // 下载播放列表中的文件
        await this.downloadPlaylistFiles();
        
        if (videos.length > 0) {
            this.generatePlayOrder();
            this.loadCurrentVideo();
            this.preloadNextVideos(3); // 预加载接下来3个视频
        }
    }
    
    // 加载当前文件（自动识别视频或图片）
    async loadCurrentVideo() {
        if (this.playlist.length === 0) return;
        
        const currentVideo = this.playlist[this.playOrder[this.currentIndex]];
        const fileUrl = currentVideo.downloadUrl || currentVideo.url;
        
        // 获取文件格式
        const fileFormat = this.getFileFormat(fileUrl);
        console.log('检测到文件格式:', fileFormat, 'URL:', fileUrl);
        
        this.showLoading();
        
        try {
            // 首先检查VideoPlayer的本地文件映射
            const localFilePath = this.localFiles.get(currentVideo.id || currentVideo.url);
            
            if (localFilePath) {
                // 检查文件路径是否有效
                if (this.isAppEnvironment()) {
                    // App环境：检查文件是否存在
                    try {
                        // 根据文件格式选择显示方式
                        if (fileFormat === 'image') {
                            this.showImage(localFilePath);
                        } else {
                            this.showVideo(localFilePath);
                        }
                        console.log('从App本地文件播放:', localFilePath);
                    } catch (error) {
                        console.warn('App本地文件加载失败，重新下载:', error);
                        await this.downloadFile(fileUrl, currentVideo.id || currentVideo.url);
                        const newLocalFilePath = this.localFiles.get(currentVideo.id || currentVideo.url);
                        if (newLocalFilePath) {
                            if (fileFormat === 'image') {
                                this.showImage(newLocalFilePath);
                            } else {
                                this.showVideo(newLocalFilePath);
                            }
                        } else {
                            throw new Error('文件重新下载失败');
                        }
                    }
                } else {
                    // 浏览器环境：检查Blob URL是否有效（页面刷新后Blob URL会失效）
                    if (localFilePath.startsWith('blob:') && !this.isValidBlobUrl(localFilePath)) {
                        console.warn('Blob URL已失效，从缓存或网络重新加载:', localFilePath);
                        // 移除失效的Blob URL映射
                        this.localFiles.delete(currentVideo.id || currentVideo.url);
                        await this.saveLocalFiles();
                        
                        // 重新下载文件
                        await this.downloadFile(fileUrl, currentVideo.id || currentVideo.url);
                        
                        // 重新获取有效的文件路径
                        const newLocalFilePath = this.localFiles.get(currentVideo.id || currentVideo.url);
                        if (newLocalFilePath) {
                            if (fileFormat === 'image') {
                                this.showImage(newLocalFilePath);
                            } else {
                                this.showVideo(newLocalFilePath);
                            }
                            console.log('重新下载后从本地文件播放:', newLocalFilePath);
                        } else {
                            throw new Error('文件重新下载失败');
                        }
                    } else {
                        // 从本地文件播放
                        if (fileFormat === 'image') {
                            this.showImage(localFilePath);
                        } else {
                            this.showVideo(localFilePath);
                        }
                        console.log('从VideoPlayer本地文件播放:', localFilePath);
                    }
                }
            } else {
                // App环境：尝试从App文件系统加载
                if (this.isAppEnvironment()) {
                    try {
                        const appFilePath = await this.loadFromAppFileSystem(currentVideo.id || currentVideo.url);
                        this.localFiles.set(currentVideo.id || currentVideo.url, appFilePath);
                        if (fileFormat === 'image') {
                            this.showImage(appFilePath);
                        } else {
                            this.showVideo(appFilePath);
                        }
                        console.log('从App文件系统加载文件:', appFilePath);
                        await this.saveLocalFiles();
                    } catch (error) {
                        console.log('App文件系统中未找到文件，尝试下载:', error.message);
                        // 文件不存在，下载文件
                        await this.downloadFile(fileUrl, currentVideo.id || currentVideo.url);
                        const newLocalFilePath = this.localFiles.get(currentVideo.id || currentVideo.url);
                        if (newLocalFilePath) {
                            if (fileFormat === 'image') {
                                this.showImage(newLocalFilePath);
                            } else {
                                this.showVideo(newLocalFilePath);
                            }
                        } else {
                            throw new Error('文件下载失败');
                        }
                    }
                } else {
                    // 浏览器环境：如果VideoPlayer本地文件不存在，检查CacheManager的IndexedDB
                    if (window.CacheManager && window.adScreenPlayer && window.adScreenPlayer.modules.cacheManager) {
                        try {
                            const cachedUrl = await window.adScreenPlayer.modules.cacheManager.getVideo(fileUrl);
                            if (cachedUrl) {
                                if (fileFormat === 'image') {
                                    this.showImage(cachedUrl);
                                } else {
                                    this.showVideo(cachedUrl);
                                }
                                console.log('从CacheManager缓存播放:', cachedUrl);
                            } else {
                                // 如果缓存也不存在，尝试从网络播放
                                if (fileFormat === 'image') {
                                    this.showImage(fileUrl);
                                } else {
                                    this.showVideo(fileUrl);
                                }
                                console.warn('本地文件不存在，从网络播放:', fileUrl);
                            }
                        } catch (cacheError) {
                            console.warn('从CacheManager加载失败:', cacheError);
                            // 缓存加载失败，回退到网络播放
                            if (fileFormat === 'image') {
                                this.showImage(fileUrl);
                            } else {
                                this.showVideo(fileUrl);
                            }
                            console.warn('缓存加载失败，从网络播放:', fileUrl);
                        }
                    } else {
                        // CacheManager不可用，直接网络播放
                        if (fileFormat === 'image') {
                            this.showImage(fileUrl);
                        } else {
                            this.showVideo(fileUrl);
                        }
                        console.warn('CacheManager不可用，从网络播放:', fileUrl);
                    }
                }
            }
            
        } catch (error) {
            this.showError(`文件加载失败: ${error.message}`);
        }
    }
    
    // 预加载接下来的视频
    async preloadNextVideos(count = 3) {
        for (let i = 1; i <= count; i++) {
            const nextIndex = (this.currentIndex + i) % this.playlist.length;
            const nextVideo = this.playlist[nextIndex];
            
            if (!this.preloadedVideos.has(nextVideo.url)) {
                try {
                    const videoElement = document.createElement('video');
                    videoElement.preload = 'auto';
                    videoElement.style.display = 'none';
                    
                    const cachedVideo = await this.getCachedVideo(nextVideo.url);
                    videoElement.src = cachedVideo || nextVideo.url;
                    videoElement.load();
                    
                    this.preloadedVideos.set(nextVideo.url, videoElement);
                } catch (error) {
                    console.warn(`预加载视频失败: ${nextVideo.url}`, error);
                }
            }
        }
    }
    
    // 无缝切换视频
    switchToNextVideo() {
        if (this.isSwitching || this.playlist.length === 0) return;
        
        this.isSwitching = true;
        
        // 更新索引
        this.currentIndex = (this.currentIndex + 1) % this.playOrder.length;
        
        // 交换播放器角色
        const oldPlayer = this.currentPlayer;
        this.currentPlayer = this.nextPlayer;
        this.nextPlayer = oldPlayer;
        
        // 设置新视频
        const nextVideo = this.playlist[this.playOrder[this.currentIndex]];
        
        // 检查本地文件
        const localFilePath = this.localFiles.get(nextVideo.id || nextVideo.url);
        
        if (localFilePath) {
            this.currentPlayer.src = localFilePath;
        } else {
            this.currentPlayer.src = nextVideo.downloadUrl || nextVideo.url;
        }
        
        // 设置视频属性，确保声音状态一致
        this.currentPlayer.muted = true; // 新视频默认静音
        this.currentPlayer.volume = 0.8;
        this.currentPlayer.autoplay = true;
        this.currentPlayer.loop = false;
        
        // 淡入淡出切换
        this.currentPlayer.classList.add('active');
        this.currentPlayer.classList.remove('inactive');
        
        this.nextPlayer.classList.add('inactive');
        this.nextPlayer.classList.remove('active');
        
        // 播放新视频
        this.currentPlayer.play().then(() => {
            console.log('视频切换播放成功');
            
            // 重新设置用户交互监听以激活声音
            this.setupUserInteractionForAudio();
            
        }).catch(error => {
            console.error('播放失败:', error);
            this.showError('播放失败，请检查网络连接');
        });
        
        // 继续预加载
        this.preloadNextVideos(3);
        
        this.isSwitching = false;
    }
    
    // 事件处理
    onVideoLoaded() {
        this.hideLoading();
    }
    
    onVideoCanPlay() {
        this.hideLoading();
    }
    
    onVideoEnded() {
        // 检查下一个媒体类型，如果是图片则使用switchToNextMedia，否则使用switchToNextVideo
        const nextIndex = (this.currentIndex + 1) % this.playOrder.length;
        const nextVideo = this.playlist[this.playOrder[nextIndex]];
        const fileUrl = nextVideo.downloadUrl || nextVideo.url;
        const fileFormat = this.getFileFormat(fileUrl);
        
        if (fileFormat === 'image') {
            this.switchToNextMedia();
        } else {
            this.switchToNextVideo();
        }
    }
    
    onVideoError(event) {
        const error = event.target.error;
        let errorMessage = '视频播放错误';
        
        if (error) {
            switch (error.code) {
                case error.MEDIA_ERR_NETWORK:
                    errorMessage = '网络错误，请检查连接';
                    break;
                case error.MEDIA_ERR_DECODE:
                    errorMessage = '视频解码错误';
                    break;
                case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    errorMessage = '视频格式不支持';
                    break;
            }
        }
        
        this.showError(errorMessage);
    }
    
    onVideoWaiting() {
        console.log('视频缓冲中...');
        this.showLoading();
        
        // 清除之前的缓冲超时
        if (this.bufferTimeout) {
            clearTimeout(this.bufferTimeout);
        }
        
        // 设置缓冲超时监控
        this.bufferTimeout = setTimeout(() => {
            console.warn('视频缓冲超时，检查缓冲状态');
            
            // 检查缓冲状态
            const buffered = this.currentPlayer.buffered;
            const currentTime = this.currentPlayer.currentTime;
            
            // 检查是否有足够的缓冲数据
            let hasEnoughBuffer = false;
            for (let i = 0; i < buffered.length; i++) {
                if (buffered.start(i) <= currentTime && buffered.end(i) > currentTime + 5) {
                    hasEnoughBuffer = true;
                    break;
                }
            }
            
            if (!hasEnoughBuffer && this.currentPlayer.readyState < 3) {
                console.warn('缓冲不足且状态不佳，尝试重新加载');
                this.retryCurrentVideo();
            } else if (hasEnoughBuffer) {
                console.log('有足够缓冲数据，尝试继续播放');
                this.currentPlayer.play().catch(error => {
                    console.warn('继续播放失败:', error);
                });
            }
        }, 15000); // 15秒缓冲超时
        
        // 添加缓冲进度监控
        this.startBufferMonitoring();
    }
    
    onVideoPlaying() {
        console.log('视频开始播放');
        this.hideLoading();
        this.performanceStats.totalFrames++;
        
        // 清除缓冲超时
        if (this.bufferTimeout) {
            clearTimeout(this.bufferTimeout);
            this.bufferTimeout = null;
        }
        
        // 停止缓冲监控
        this.stopBufferMonitoring();
        
        // 监控播放进度，防止卡顿
        this.startPlaybackMonitoring();
        
        // 记录播放开始时间
        this.playStartTime = Date.now();
        
        // 发送播放成功事件
        window.dispatchEvent(new CustomEvent('video:playing', {
            detail: {
                src: this.currentPlayer.src,
                timestamp: Date.now(),
                duration: this.currentPlayer.duration
            }
        }));
    }
    

    
    retryCurrentVideo() {
        this.hideError();
        this.loadCurrentVideo();
    }
    
    // 文件下载和本地存储管理
    
    // 清空本地文件
    async clearLocalFiles() {
        try {
            // 释放所有本地文件URL
            this.localFiles.forEach(url => {
                if (url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            });
            
            // 清空本地文件映射
            this.localFiles.clear();
            
            // 清空预加载视频
            this.preloadedVideos.forEach(video => {
                video.pause();
                video.src = '';
            });
            this.preloadedVideos.clear();
            
            // 清空播放列表
            this.playlist = [];
            this.playOrder = [];
            this.currentIndex = 0;
            
            // 清空本地存储
            localStorage.removeItem('local-playlist');
            localStorage.removeItem('local-files');
            
            console.log('本地文件已清空');
        } catch (error) {
            console.error('清空本地文件失败:', error);
        }
    }
    
    // 下载播放列表中的所有文件
    async downloadPlaylistFiles() {
        for (const video of this.playlist) {
            if (video.downloadUrl) {
                await this.downloadFile(video.downloadUrl, video.id || video.url);
            }
        }
    }
    
    // 检查是否在HBuilderX App环境中
    isAppEnvironment() {
        return typeof plus !== 'undefined' && plus.io;
    }
    
    // 获取App本地文件路径
    getAppFilePath(fileId) {
        if (!this.isAppEnvironment()) return null;
        
        // 使用H5+ API获取应用私有目录
        const basePath = plus.io.PRIVATE_WWW;
        const fileName = `${fileId}.mp4`; // 假设都是mp4文件
        return `${basePath}downloads/${fileName}`;
    }
    
    // 下载单个文件（兼容浏览器和App环境）
    async downloadFile(downloadUrl, fileId) {
        try {
            console.log('开始下载文件:', downloadUrl);
            
            // 检查URL有效性
            if (!downloadUrl || !downloadUrl.startsWith('http')) {
                throw new Error(`无效的下载URL: ${downloadUrl}`);
            }
            
            console.log('尝试下载文件:', downloadUrl);
            
            // 从下载URL中提取token参数
            const url = new URL(downloadUrl);
            const urlToken = url.searchParams.get('token');
            console.log('从URL提取的下载令牌:', urlToken);
            
            if (!urlToken) {
                throw new Error('下载URL中未找到token参数');
            }
            
            const response = await fetch(downloadUrl, {
                headers: {
                    'Authorization': `Bearer ${urlToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('响应状态:', response.status, response.statusText);
            if (!response.ok) {
                throw new Error(`下载失败: ${response.status} ${response.statusText}`);
            }
            
            // 获取文件大小
            const contentLength = response.headers.get('content-length');
            console.log(`文件大小: ${contentLength || '未知'} bytes`);
            
            const reader = response.body.getReader();
            const chunks = [];
            let receivedLength = 0;
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
                receivedLength += value.length;
                
                // 记录下载进度
                if (contentLength) {
                    const percent = Math.round((receivedLength / contentLength) * 100);
                    console.log(`下载进度: ${percent}%`);
                }
            }
            
            // 合并数据块
            const blob = new Blob(chunks);
            
            let localUrl;
            
            // 根据环境选择存储方式
            if (this.isAppEnvironment()) {
                // App环境：保存到文件系统
                localUrl = await this.saveToAppFileSystem(fileId, blob);
            } else {
                // 浏览器环境：使用Blob URL
                localUrl = URL.createObjectURL(blob);
            }
            
            // 保存到本地映射
            this.localFiles.set(fileId, localUrl);
            
            console.log('文件下载完成:', fileId, localUrl, `大小: ${receivedLength} bytes`);
            
            // 保存本地文件映射到存储
            await this.saveLocalFiles();
            
            // 同时保存到CacheManager的IndexedDB（如果可用且浏览器环境）
            if (!this.isAppEnvironment() && window.CacheManager && window.adScreenPlayer && window.adScreenPlayer.modules.cacheManager) {
                try {
                    await window.adScreenPlayer.modules.cacheManager.cacheVideo(downloadUrl, blob);
                    console.log('文件已保存到CacheManager');
                } catch (cacheError) {
                    console.warn('保存到CacheManager失败:', cacheError);
                }
            }
            
            return localUrl;
        } catch (error) {
            console.error('文件下载失败:', error);
            throw error;
        }
    }
    
    // 保存文件到App文件系统
    async saveToAppFileSystem(fileId, blob) {
        return new Promise((resolve, reject) => {
            try {
                // 确保downloads目录存在
                const downloadsDir = '_downloads';
                plus.io.requestFileSystem(plus.io.PRIVATE_WWW, (fs) => {
                    fs.root.getDirectory(downloadsDir, { create: true }, (dirEntry) => {
                        // 创建文件
                        const fileName = `${fileId}.mp4`;
                        dirEntry.getFile(fileName, { create: true }, (fileEntry) => {
                            fileEntry.createWriter((writer) => {
                                writer.onwriteend = () => {
                                    // 返回文件URL
                                    const fileUrl = fileEntry.toLocalURL();
                                    console.log('文件已保存到App文件系统:', fileUrl);
                                    resolve(fileUrl);
                                };
                                writer.onerror = (e) => {
                                    console.error('文件写入失败:', e);
                                    reject(e);
                                };
                                
                                // 将Blob转换为ArrayBuffer写入
                                const reader = new FileReader();
                                reader.onload = () => {
                                    writer.write(new Uint8Array(reader.result));
                                };
                                reader.onerror = () => reject(reader.error);
                                reader.readAsArrayBuffer(blob);
                            }, reject);
                        }, reject);
                    }, reject);
                }, reject);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 从App文件系统加载文件
    async loadFromAppFileSystem(fileId) {
        return new Promise((resolve, reject) => {
            try {
                const fileName = `${fileId}.mp4`;
                const filePath = `_downloads/${fileName}`;
                
                plus.io.resolveLocalFileSystemURL(`_www/${filePath}`, (fileEntry) => {
                    const fileUrl = fileEntry.toLocalURL();
                    console.log('从App文件系统加载文件:', fileUrl);
                    resolve(fileUrl);
                }, (error) => {
                    console.log('App文件系统中未找到文件:', filePath);
                    reject(new Error('文件不存在'));
                });
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 清理App文件系统中的过期文件
    async cleanupAppFiles() {
        if (!this.isAppEnvironment()) return;
        
        return new Promise((resolve, reject) => {
            try {
                plus.io.requestFileSystem(plus.io.PRIVATE_WWW, (fs) => {
                    fs.root.getDirectory('_downloads', { create: false }, (dirEntry) => {
                        const directoryReader = dirEntry.createReader();
                        directoryReader.readEntries((entries) => {
                            const cleanupPromises = [];
                            const currentTime = Date.now();
                            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天
                            
                            for (const entry of entries) {
                                if (entry.isFile) {
                                    entry.file((file) => {
                                        if (currentTime - file.lastModifiedDate > maxAge) {
                                            cleanupPromises.push(new Promise((res) => {
                                                entry.remove(() => {
                                                    console.log('清理过期文件:', entry.name);
                                                    res();
                                                }, (error) => {
                                                    console.warn('清理文件失败:', entry.name, error);
                                                    res();
                                                });
                                            }));
                                        }
                                    });
                                }
                            }
                            
                            Promise.all(cleanupPromises).then(resolve).catch(reject);
                        }, reject);
                    }, (error) => {
                        // _downloads目录不存在，无需清理
                        console.log('_downloads目录不存在，无需清理');
                        resolve();
                    });
                }, reject);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 获取App文件系统使用情况
    async getAppStorageInfo() {
        if (!this.isAppEnvironment()) return null;
        
        return new Promise((resolve) => {
            plus.io.requestFileSystem(plus.io.PRIVATE_WWW, (fs) => {
                fs.root.getDirectory('_downloads', { create: false }, (dirEntry) => {
                    const directoryReader = dirEntry.createReader();
                    directoryReader.readEntries((entries) => {
                        let totalSize = 0;
                        let fileCount = 0;
                        
                        const sizePromises = entries.map(entry => {
                            if (entry.isFile) {
                                return new Promise((res) => {
                                    entry.file((file) => {
                                        totalSize += file.size;
                                        fileCount++;
                                        res();
                                    }, () => res());
                                });
                            }
                            return Promise.resolve();
                        });
                        
                        Promise.all(sizePromises).then(() => {
                            resolve({
                                fileCount,
                                totalSize: totalSize,
                                totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
                            });
                        });
                    }, () => resolve({ fileCount: 0, totalSize: 0, totalSizeMB: '0.00' }));
                }, () => resolve({ fileCount: 0, totalSize: 0, totalSizeMB: '0.00' }));
            }, () => resolve(null));
        });
    }
    
    // 清理App文件系统中的过期文件
    async cleanupAppFiles() {
        if (!this.isAppEnvironment()) return;
        
        return new Promise((resolve, reject) => {
            try {
                plus.io.requestFileSystem(plus.io.PRIVATE_WWW, (fs) => {
                    fs.root.getDirectory('_downloads', { create: false }, (dirEntry) => {
                        const directoryReader = dirEntry.createReader();
                        directoryReader.readEntries((entries) => {
                            const cleanupPromises = [];
                            const currentTime = Date.now();
                            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天
                            
                            for (const entry of entries) {
                                if (entry.isFile) {
                                    entry.file((file) => {
                                        if (currentTime - file.lastModifiedDate > maxAge) {
                                            cleanupPromises.push(new Promise((res) => {
                                                entry.remove(() => {
                                                    console.log('清理过期文件:', entry.name);
                                                    res();
                                                }, (error) => {
                                                    console.warn('清理文件失败:', entry.name, error);
                                                    res();
                                                });
                                            }));
                                        }
                                    });
                                }
                            }
                            
                            Promise.all(cleanupPromises).then(resolve).catch(reject);
                        }, reject);
                    }, (error) => {
                        // _downloads目录不存在，无需清理
                        console.log('_downloads目录不存在，无需清理');
                        resolve();
                    });
                }, reject);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 获取App文件系统使用情况
    async getAppStorageInfo() {
        if (!this.isAppEnvironment()) return null;
        
        return new Promise((resolve) => {
            plus.io.requestFileSystem(plus.io.PRIVATE_WWW, (fs) => {
                fs.root.getDirectory('_downloads', { create: false }, (dirEntry) => {
                    const directoryReader = dirEntry.createReader();
                    directoryReader.readEntries((entries) => {
                        let totalSize = 0;
                        let fileCount = 0;
                        
                        const sizePromises = entries.map(entry => {
                            if (entry.isFile) {
                                return new Promise((res) => {
                                    entry.file((file) => {
                                        totalSize += file.size;
                                        fileCount++;
                                        res();
                                    }, () => res());
                                });
                            }
                            return Promise.resolve();
                        });
                        
                        Promise.all(sizePromises).then(() => {
                            resolve({
                                fileCount,
                                totalSize: totalSize,
                                totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
                            });
                        });
                    }, () => resolve({ fileCount: 0, totalSize: 0, totalSizeMB: '0.00' }));
                }, () => resolve({ fileCount: 0, totalSize: 0, totalSizeMB: '0.00' }));
            }, () => resolve(null));
        });
    }
    
    // 保存本地播放列表到存储
    async saveLocalPlaylist() {
        try {
            const playlistData = {
                playlist: this.playlist,
                playMode: this.playMode,
                timestamp: Date.now()
            };
            
            localStorage.setItem('local-playlist', JSON.stringify(playlistData));
            console.log('本地播放列表已保存');
        } catch (error) {
            console.error('保存播放列表失败:', error);
        }
    }
    
    // 加载本地播放列表
    async loadLocalPlaylist() {
        try {
            const savedData = localStorage.getItem('local-playlist');
            if (savedData) {
                const playlistData = JSON.parse(savedData);
                this.playlist = playlistData.playlist || [];
                this.playMode = playlistData.playMode || 'sequential';
                
                console.log('本地播放列表已加载:', this.playlist.length + '个视频');
                
                // 加载本地文件映射
                await this.loadLocalFiles();
                
                if (this.playlist.length > 0) {
                    this.generatePlayOrder();
                    this.loadCurrentVideo();
                }
            }
        } catch (error) {
            console.error('加载播放列表失败:', error);
        }
    }
    
    // 保存本地文件映射
    async saveLocalFiles() {
        try {
            const filesData = Array.from(this.localFiles.entries());
            localStorage.setItem('local-files', JSON.stringify(filesData));
        } catch (error) {
            console.error('保存文件映射失败:', error);
        }
    }
    
    // 加载本地文件映射
    async loadLocalFiles() {
        try {
            const savedData = localStorage.getItem('local-files');
            if (savedData) {
                const filesData = JSON.parse(savedData);
                this.localFiles = new Map(filesData);
                console.log('本地文件映射已加载:', this.localFiles.size + '个文件');
                
                // 检查并清理失效的Blob URL
                const validFiles = new Map();
                for (const [fileId, fileUrl] of this.localFiles.entries()) {
                    if (fileUrl.startsWith('blob:') && !this.isValidBlobUrl(fileUrl)) {
                        console.warn('移除失效的Blob URL:', fileId, fileUrl);
                    } else {
                        validFiles.set(fileId, fileUrl);
                    }
                }
                
                // 如果有失效的文件，更新本地存储
                if (validFiles.size !== this.localFiles.size) {
                    this.localFiles = validFiles;
                    await this.saveLocalFiles();
                    console.log('已清理失效文件映射，剩余有效文件:', this.localFiles.size + '个');
                }
            }
        } catch (error) {
            console.error('加载文件映射失败:', error);
        }
    }
    
    // 生成播放顺序
    generatePlayOrder() {
        this.playOrder = [];
        
        switch (this.playMode) {
            case 'sequential':
                // 顺序播放
                for (let i = 0; i < this.playlist.length; i++) {
                    this.playOrder.push(i);
                }
                break;
                
            case 'random':
                // 随机播放
                const indices = Array.from({length: this.playlist.length}, (_, i) => i);
                for (let i = indices.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [indices[i], indices[j]] = [indices[j], indices[i]];
                }
                this.playOrder = indices;
                break;
                
            case 'loop':
                // 循环播放（与顺序相同，但播放器会循环）
                for (let i = 0; i < this.playlist.length; i++) {
                    this.playOrder.push(i);
                }
                break;
                
            default:
                for (let i = 0; i < this.playlist.length; i++) {
                    this.playOrder.push(i);
                }
        }
        
        console.log('播放顺序已生成:', this.playMode, this.playOrder);
    }
    
    // 预加载接下来的视频（从本地文件）
    async preloadNextVideos(count = 3) {
        for (let i = 1; i <= count; i++) {
            const nextIndex = (this.currentIndex + i) % this.playOrder.length;
            const nextVideo = this.playlist[this.playOrder[nextIndex]];
            
            if (!this.preloadedVideos.has(nextVideo.id || nextVideo.url)) {
                try {
                    const videoElement = document.createElement('video');
                    videoElement.preload = 'auto';
                    videoElement.style.display = 'none';
                    
                    // 检查本地文件
                    const localFilePath = this.localFiles.get(nextVideo.id || nextVideo.url);
                    
                    if (localFilePath) {
                        videoElement.src = localFilePath;
                    } else {
                        videoElement.src = nextVideo.downloadUrl || nextVideo.url;
                    }
                    
                    videoElement.load();
                    this.preloadedVideos.set(nextVideo.id || nextVideo.url, videoElement);
                } catch (error) {
                    console.warn(`预加载视频失败:`, nextVideo, error);
                }
            }
        }
    }
    
    // 性能监控
    startPerformanceMonitoring() {
        let lastTime = performance.now();
        let frames = 0;
        
        const calculateFPS = () => {
            frames++;
            const currentTime = performance.now();
            
            if (currentTime - lastTime >= 1000) {
                this.performanceStats.frameRate = Math.round((frames * 1000) / (currentTime - lastTime));
                frames = 0;
                lastTime = currentTime;
                
                // 更新UI显示
                this.updatePerformanceDisplay();
            }
            
            requestAnimationFrame(calculateFPS);
        };
        
        calculateFPS();
    }
    
    updatePerformanceDisplay() {
        const fpsElement = document.getElementById('fps-counter');
        if (fpsElement) {
            fpsElement.textContent = this.performanceStats.frameRate;
        }
    }
    
    // 公共方法
    play() {
        if (!this.currentPlayer || !this.currentPlayer.src) {
            console.warn('没有可播放的视频源，尝试重新加载当前视频');
            this.loadCurrentVideo();
            return;
        }
        
        // 重置视频状态
        this.currentPlayer.currentTime = 0;
        this.currentPlayer.muted = true; // 保持静音避免自动播放限制
        this.currentPlayer.volume = 0.8; // 设置默认音量
        this.currentPlayer.autoplay = true;
        this.currentPlayer.loop = false;
        
        // 确保另一个播放器也是静音状态
        this.nextPlayer.muted = true;
        this.nextPlayer.volume = 0.8;
        
        console.log('开始播放视频:', this.currentPlayer.src);
        console.log('视频属性:', {
            muted: this.currentPlayer.muted,
            volume: this.currentPlayer.volume,
            autoplay: this.currentPlayer.autoplay,
            loop: this.currentPlayer.loop
        });
        
        // 直接静音播放，不尝试取消静音
        const playPromise = this.currentPlayer.play();
        
        if (playPromise !== undefined) {
            playPromise.then(() => {
                console.log('静音播放成功');
                
                // 触发播放事件
                window.dispatchEvent(new CustomEvent('video:play', {
                    detail: {
                        src: this.currentPlayer.src,
                        timestamp: Date.now(),
                        muted: true // 标记为静音播放
                    }
                }));
                
                // 添加用户交互监听，允许用户点击后激活声音
                this.setupUserInteractionForAudio();
                
            }).catch(error => {
                console.error('播放失败:', error);
                
                // 根据错误类型处理
                if (error.name === 'AbortError') {
                    // 播放被中断，可能是页面失去焦点或浏览器节能模式
                    console.warn('播放被中断，等待页面激活后重试');
                    
                    // 监听页面可见性变化
                    const handleVisibilityChange = () => {
                        if (!document.hidden) {
                            console.log('页面恢复可见，重新尝试播放');
                            document.removeEventListener('visibilitychange', handleVisibilityChange);
                            
                            // 延迟重试
                            setTimeout(() => {
                                this.play();
                            }, 100);
                        }
                    };
                    
                    document.addEventListener('visibilitychange', handleVisibilityChange);
                    
                    // 设置超时，如果页面长时间不激活则显示错误
                    setTimeout(() => {
                        document.removeEventListener('visibilitychange', handleVisibilityChange);
                        if (document.hidden) {
                            this.showError('播放被中断，请确保页面处于激活状态');
                        }
                    }, 5000);
                    
                } else if (error.name === 'NotAllowedError') {
                    // 自动播放被阻止，需要用户交互
                    console.warn('自动播放被阻止，需要用户交互');
                    this.showError('请点击页面任意位置开始播放');
                    
                    // 添加点击事件监听
                    const handleUserInteraction = () => {
                        document.removeEventListener('click', handleUserInteraction);
                        this.hideError();
                        
                        // 用户交互后重新尝试播放
                        setTimeout(() => {
                            this.play();
                        }, 100);
                    };
                    
                    document.addEventListener('click', handleUserInteraction);
                    
                } else {
                    // 其他错误
                    this.showError(`播放失败: ${error.message}`);
                    
                    // 如果静音播放也失败，尝试其他方案
                    console.log('尝试其他播放方案...');
                    
                    // 尝试从网络播放
                    const currentVideo = this.playlist[this.playOrder[this.currentIndex]];
                    if (currentVideo && currentVideo.downloadUrl) {
                        console.log('尝试从网络播放:', currentVideo.downloadUrl);
                        this.currentPlayer.src = currentVideo.downloadUrl;
                        this.currentPlayer.play().catch(networkError => {
                            console.error('网络播放失败:', networkError);
                        });
                    }
                }
            });
        }
    }
    
    pause() {
        this.currentPlayer.pause();
    }
    
    stop() {
        this.currentPlayer.pause();
        this.currentPlayer.currentTime = 0;
    }
    
    // 检查Blob URL是否有效
    isValidBlobUrl(blobUrl) {
        if (!blobUrl || !blobUrl.startsWith('blob:')) {
            return false;
        }
        
        // 页面刷新后，blob:null/格式的URL确实会失效，需要特殊处理
        if (blobUrl.startsWith('blob:null/')) {
            console.warn('检测到页面刷新后失效的Blob URL:', blobUrl);
            return false;
        }
        
        // 检查URL格式是否有效
        try {
            const urlObj = new URL(blobUrl);
            if (urlObj.protocol !== 'blob:' || urlObj.href.length <= 10) {
                console.warn('Blob URL格式无效:', blobUrl);
                return false;
            }
        } catch (error) {
            console.warn('Blob URL解析失败:', blobUrl, error);
            return false;
        }
        
        return true;
    }
    

    

    
    // 开始播放监控
    startPlaybackMonitoring() {
        if (this.playbackMonitor) {
            clearInterval(this.playbackMonitor);
        }
        
        let lastPlaybackTime = this.currentPlayer.currentTime;
        let stuckCount = 0;
        let lastCheckTime = Date.now();
        
        this.playbackMonitor = setInterval(() => {
            const currentTime = this.currentPlayer.currentTime;
            const currentCheckTime = Date.now();
            
            // 检查播放是否卡住 - 增加容错时间，避免误判
            if (currentTime === lastPlaybackTime && !this.currentPlayer.paused) {
                stuckCount++;
                console.warn(`播放卡住检测: ${stuckCount}次, 当前时间: ${currentTime}`);
                
                // 根据卡顿次数采取不同措施，增加阈值避免过度干预
                if (stuckCount >= 2) { // 第二次卡顿，轻微调整
                    console.warn('检测到轻微卡顿，尝试轻微调整');
                    this.currentPlayer.currentTime += 0.1; // 轻微跳帧
                }
                
                if (stuckCount >= 4) { // 第四次卡顿，暂停重播
                    console.warn('播放卡顿，尝试暂停重播');
                    this.recoverPlayback();
                }
                
                if (stuckCount >= 6) { // 连续6次检测到卡顿，重新加载视频
                    console.warn('播放严重卡顿，重新加载视频');
                    this.retryCurrentVideo();
                    stuckCount = 0;
                }
            } else {
                stuckCount = 0; // 播放正常，重置计数器
            }
            
            lastPlaybackTime = currentTime;
            lastCheckTime = currentCheckTime;
        }, 1000); // 每1000毫秒检查一次，降低检测频率
    }
    
    // 恢复播放
    recoverPlayback() {
        console.log('尝试恢复播放...');
        
        // 记录当前播放时间
        const currentTime = this.currentPlayer.currentTime;
        
        // 暂停并重新播放
        this.currentPlayer.pause();
        
        // 检查视频缓冲状态
        if (this.currentPlayer.readyState < 3) { // HAVE_FUTURE_DATA
            console.warn('视频缓冲不足，尝试重新加载');
            this.retryCurrentVideo();
            return;
        }
        
        setTimeout(() => {
            // 尝试从当前位置继续播放
            this.currentPlayer.currentTime = currentTime;
            
            this.currentPlayer.play().then(() => {
                console.log('播放恢复成功');
            }).catch(error => {
                console.error('恢复播放失败:', error);
                
                // 如果恢复失败，尝试不同的恢复策略
                if (error.name === 'NotAllowedError') {
                    console.warn('播放权限问题，尝试静音播放');
                    this.currentPlayer.muted = true;
                    this.currentPlayer.play().then(() => {
                        console.log('静音播放成功');
                        // 延迟恢复声音
                        setTimeout(() => {
                            this.currentPlayer.muted = false;
                        }, 1000);
                    }).catch(mutedError => {
                        console.error('静音播放也失败:', mutedError);
                        this.retryCurrentVideo();
                    });
                } else {
                    // 其他错误，重新加载视频
                    setTimeout(() => {
                        this.retryCurrentVideo();
                    }, 500);
                }
            });
        }, 200);
    }
    
    // 开始缓冲监控
    startBufferMonitoring() {
        if (this.bufferMonitor) {
            clearInterval(this.bufferMonitor);
        }
        
        this.bufferMonitor = setInterval(() => {
            const buffered = this.currentPlayer.buffered;
            const currentTime = this.currentPlayer.currentTime;
            
            if (buffered.length > 0) {
                let bufferEnd = 0;
                for (let i = 0; i < buffered.length; i++) {
                    if (buffered.start(i) <= currentTime && buffered.end(i) > currentTime) {
                        bufferEnd = buffered.end(i);
                        break;
                    }
                }
                
                const bufferAhead = bufferEnd - currentTime;
                console.log(`缓冲状态: 当前时间 ${currentTime.toFixed(1)}s, 缓冲到 ${bufferEnd.toFixed(1)}s, 缓冲量 ${bufferAhead.toFixed(1)}s`);
                
                // 如果缓冲量不足且正在等待，尝试主动缓冲
                if (bufferAhead < 5 && this.currentPlayer.readyState < 3) {
                    console.warn('缓冲量不足，尝试主动缓冲');
                    // 轻微调整播放位置以触发缓冲
                    this.currentPlayer.currentTime += 0.01;
                }
            }
        }, 2000); // 每2秒检查一次缓冲状态
    }
    
    // 设置用户交互监听以激活声音
    setupUserInteractionForAudio() {
        // 如果已经设置过监听器，先移除
        if (this.userInteractionHandler) {
            document.removeEventListener('click', this.userInteractionHandler);
            this.userInteractionHandler = null;
        }
        
        this.userInteractionHandler = () => {
            console.log('用户交互，尝试激活声音...');
            
            // 检查视频是否正在播放
            if (!this.currentPlayer.paused) {
                // 尝试取消静音
                this.currentPlayer.muted = false;
                console.log('声音已激活');
                
                // 同时确保另一个播放器也是非静音状态
                this.nextPlayer.muted = false;
                
                // 移除监听器，避免重复触发
                document.removeEventListener('click', this.userInteractionHandler);
                this.userInteractionHandler = null;
                
                // 发送声音激活事件
                window.dispatchEvent(new CustomEvent('video:audio-activated', {
                    detail: {
                        src: this.currentPlayer.src,
                        timestamp: Date.now()
                    }
                }));
            }
        };
        
        // 添加点击事件监听
        document.addEventListener('click', this.userInteractionHandler);
        
        console.log('已设置用户交互监听，点击页面可激活声音');
    }
    
    // 停止缓冲监控
    stopBufferMonitoring() {
        if (this.bufferMonitor) {
            clearInterval(this.bufferMonitor);
            this.bufferMonitor = null;
        }
    }
    
    // 停止播放监控
    stopPlaybackMonitoring() {
        if (this.playbackMonitor) {
            clearInterval(this.playbackMonitor);
            this.playbackMonitor = null;
        }
        this.stopBufferMonitoring();
    }
    
    // 销毁资源
    destroy() {
        this.stopPlaybackMonitoring();
        
        if (this.bufferTimeout) {
            clearTimeout(this.bufferTimeout);
            this.bufferTimeout = null;
        }
        
        [this.video1, this.video2].forEach(video => {
            video.pause();
            video.src = '';
            video.load();
        });
        
        this.preloadedVideos.forEach(video => {
            video.pause();
            video.src = '';
        });
        this.preloadedVideos.clear();
    }
    
    // 获取文件格式
    getFileFormat(url) {
        if (!url) return 'unknown';
        
        // 从URL中提取文件扩展名
        const urlObj = new URL(url);
        const pathname = urlObj.pathname.toLowerCase();
        const extension = pathname.split('.').pop();
        
        if (this.supportedImageFormats.includes(extension)) {
            return 'image';
        } else if (this.supportedVideoFormats.includes(extension)) {
            return 'video';
        } else {
            return 'unknown';
        }
    }
    
    // 显示视频
    showVideo(url) {
        console.log('显示视频:', url);
        
        // 隐藏图片容器
        if (this.imageContainer) {
            this.imageContainer.classList.add('hidden');
        }
        
        // 显示视频播放器
        if (this.currentPlayer) {
            this.currentPlayer.classList.remove('hidden');
            
            // 检查是否需要更新视频源
            if (this.currentPlayer.src !== url) {
                this.currentPlayer.src = url;
                
                // 设置视频属性
                this.currentPlayer.muted = true; // 默认静音
                this.currentPlayer.playsInline = true;
                
                // 等待视频加载完成后再播放
                this.currentPlayer.onloadeddata = () => {
                    this.playVideoSafely();
                };
                
                // 如果视频已经加载完成，直接播放
                if (this.currentPlayer.readyState >= 3) {
                    this.playVideoSafely();
                }
            } else {
                // 如果视频源相同，直接播放
                this.playVideoSafely();
            }
        }
    }
    
    // 安全播放视频（避免重复播放请求）
    playVideoSafely() {
        if (this.currentPlayer.paused) {
            this.currentPlayer.play().then(() => {
                console.log('视频播放成功');
                this.hideLoading();
                
                // 设置用户交互监听以激活声音
                this.setupUserInteractionForAudio();
                
                // 开始播放监控
                this.startPlaybackMonitoring();
                
            }).catch(error => {
                // 如果是播放请求被中断的错误，忽略它（视频可能已经在播放）
                if (error.name === 'AbortError' && error.message.includes('interrupted by a new load request')) {
                    console.log('播放请求被中断，视频可能已经在播放中');
                    this.hideLoading();
                } else {
                    console.error('视频播放失败:', error);
                    this.showError(`视频播放失败: ${error.message}`);
                }
            });
        } else {
            console.log('视频已经在播放中');
            this.hideLoading();
        }
    }
    
    // 显示图片
    showImage(url) {
        console.log('显示图片:', url);
        
        // 检查是否已经在显示相同的图片，避免重复加载
        if (this.imageDisplay && this.imageDisplay.src === url) {
            console.log('图片已经在显示中，跳过重复加载');
            this.hideLoading();
            return;
        }
        
        // 隐藏视频播放器
        if (this.currentPlayer) {
            this.currentPlayer.classList.add('hidden');
            this.currentPlayer.pause();
        }
        if (this.nextPlayer) {
            this.nextPlayer.classList.add('hidden');
            this.nextPlayer.pause();
        }
        
        // 显示图片容器
        if (this.imageContainer && this.imageDisplay) {
            this.imageContainer.classList.remove('hidden');
            this.imageDisplay.src = url;
            
            // 图片加载完成事件
            this.imageDisplay.onload = () => {
                console.log('图片加载成功');
                this.hideLoading();
                
                // 只有当播放列表中有多个媒体时才自动切换
                if (this.playlist.length > 1) {
                    // 图片显示完成后，设置定时切换到下一个媒体
                    setTimeout(() => {
                        this.switchToNextMedia();
                    }, 5000); // 图片显示5秒后切换
                } else {
                    console.log('播放列表中只有一个媒体，保持显示不切换');
                }
            };
            
            this.imageDisplay.onerror = async (error) => {
                console.error('图片加载失败:', error);
                
                // 如果是Blob URL失效导致的错误，尝试重新下载文件
                if (url.startsWith('blob:') && url.startsWith('blob:null/')) {
                    console.warn('Blob URL失效，尝试重新下载文件');
                    
                    try {
                        const currentVideo = this.playlist[this.playOrder[this.currentIndex]];
                        const fileUrl = currentVideo.downloadUrl || currentVideo.url;
                        
                        // 重新下载文件
                        await this.downloadFile(fileUrl, currentVideo.id || currentVideo.url);
                        
                        // 获取新的文件路径
                        const newLocalFilePath = this.localFiles.get(currentVideo.id || currentVideo.url);
                        if (newLocalFilePath) {
                            console.log('文件重新下载成功，重新显示图片');
                            this.imageDisplay.src = newLocalFilePath;
                            return;
                        }
                    } catch (downloadError) {
                        console.error('文件重新下载失败:', downloadError);
                    }
                }
                
                this.showError('图片加载失败');
            };
        }
    }
    
    // 切换到下一个媒体（视频或图片）
    switchToNextMedia() {
        if (this.playlist.length === 0) return;
        
        // 如果只有一个媒体，不进行切换
        if (this.playlist.length === 1) {
            console.log('播放列表中只有一个媒体，不进行切换');
            return;
        }
        
        // 更新索引
        this.currentIndex = (this.currentIndex + 1) % this.playOrder.length;
        
        // 加载下一个媒体
        this.loadCurrentVideo();
    }
    
    // 开始播放监控
    startPlaybackMonitoring() {
        if (this.playbackMonitor) {
            clearInterval(this.playbackMonitor);
        }
        
        this.playbackMonitor = setInterval(() => {
            // 检查当前播放状态
            if (this.currentPlayer && !this.currentPlayer.paused) {
                // 播放正常，更新性能统计
                this.updatePerformanceStats();
            }
        }, 1000);
    }
    
    // 更新性能统计
    updatePerformanceStats() {
        // 这里可以添加性能监控逻辑
        if (this.currentPlayer) {
            const currentTime = this.currentPlayer.currentTime;
            const duration = this.currentPlayer.duration;
            
            // 记录播放进度等信息
            if (duration > 0) {
                const progress = (currentTime / duration) * 100;
                console.log(`播放进度: ${progress.toFixed(1)}%`);
            }
        }
    }
    
    // 显示加载动画
    showLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.classList.remove('hidden');
        }
    }
    
    // 隐藏加载动画
    hideLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
        }
    }
    
    // 显示错误信息
    showError(message) {
        const errorOverlay = document.getElementById('error-overlay');
        const errorMessage = document.getElementById('error-message');
        
        if (errorOverlay && errorMessage) {
            errorMessage.textContent = message;
            errorOverlay.classList.remove('hidden');
        }
        
        console.error('播放器错误:', message);
    }
    
    // 隐藏错误信息
    hideError() {
        const errorOverlay = document.getElementById('error-overlay');
        if (errorOverlay) {
            errorOverlay.classList.add('hidden');
        }
    }
}

// 导出单例
window.VideoPlayer = VideoPlayer;