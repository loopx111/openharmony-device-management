class AdScreenPlayer {
    constructor() {
        this.modules = {};
        this.isInitialized = false;
        this.config = {
            autoPlay: true,
            loopPlaylist: true,
            preloadCount: 3,
            showPerformance: false,
            mqttEnabled: true
        };
        
        this.init();
    }
    
    async init() {
        try {
            // 加载配置
            await this.loadConfig();
            
            // 初始化模块
            await this.initializeModules();
            
            // 设置事件监听
            this.setupEventListeners();
            
            // 启动播放器
            await this.startPlayer();
            
            this.isInitialized = true;
            console.log('广告屏播放器初始化完成');
            
        } catch (error) {
            console.error('播放器初始化失败:', error);
            this.showFatalError('播放器初始化失败: ' + error.message);
        }
    }
    
    async initializeModules() {
        // 初始化缓存管理器
        this.modules.cacheManager = new CacheManager();
        await this.modules.cacheManager.initDatabase();
        
        // 初始化MQTT客户端
        if (this.config.mqttEnabled) {
            this.modules.mqttClient = new MQTTClient();
            // 先加载配置，再初始化连接
            await this.modules.mqttClient.loadConfig();
            await this.modules.mqttClient.init();
        }
        
        // 初始化性能监控
        this.modules.monitor = new PerformanceMonitor();
        
        // 初始化视频播放器
        this.modules.videoPlayer = new VideoPlayer();
        
        console.log('所有模块初始化完成');
    }
    
    async startPlayer() {
        // 尝试加载缓存的播放列表
        const cachedPlaylist = await this.modules.cacheManager.getPlaylist();
        
        if (cachedPlaylist && cachedPlaylist.length > 0) {
            console.log('加载缓存的播放列表:', cachedPlaylist.length + '个视频');
            this.modules.videoPlayer.setPlaylist(cachedPlaylist);
        } else {
            // 使用默认播放列表
            const defaultPlaylist = this.getDefaultPlaylist();
            this.modules.videoPlayer.setPlaylist(defaultPlaylist);
            await this.modules.cacheManager.savePlaylist(defaultPlaylist);
        }
        
        // 开始播放
        if (this.config.autoPlay) {
            setTimeout(() => {
                this.modules.videoPlayer.play();
            }, 1000);
        }
        
        // 设置MQTT消息处理
        if (this.modules.mqttClient) {
            this.setupMQTTHandlers();
        }
        
        // 性能面板控制
        this.setupPerformancePanel();
    }
    
    setupMQTTHandlers() {
        const mqtt = this.modules.mqttClient;
        const app = this; // 保存当前作用域
        
        // 确保在连接成功后注册处理器
        const registerHandlers = () => {
            const commandTopics = mqtt.getAllCommandTopics();
            console.log('注册消息处理器 for 命令主题列表:', commandTopics);
            
            commandTopics.forEach(topic => {
                // 显式绑定作用域
                const handler = function(data) {
                    console.log(`收到消息 [${topic}]:`, data);
                    
                    if ((data.type === 'file-distribution' || data.type === 'file_distribution') && data.files && Array.isArray(data.files)) {
                        console.log('检测到文件分发消息，开始处理:', data);
                        app.handleFileDistribution(data);
                        return;
                    }
                    
                    console.log('检测到常规控制命令:', data);
                }.bind(app);
                
                // 注册处理器并打印确认日志
                mqtt.on(topic, handler);
                console.log(`已注册处理器 for ${topic}`);
            });
        };
        
        // 若已连接则直接注册，否则监听连接事件
        if (mqtt.isConnected) {
            registerHandlers();
        } else {
            mqtt.client.on('connect', registerHandlers);
        }
        
        // 注意：控制主题已在命令主题列表中注册，无需重复注册
        
        // 播放列表消息处理（兼容旧逻辑）
        mqtt.on(mqtt.topics.playlist, (data) => {
            console.log('收到消息 [主题: playlist]:', data);
            
            if (data.playlist && Array.isArray(data.playlist)) {
                console.log('检测到播放列表消息，开始处理:', data);
                const playMode = data.playMode || 'sequential';
                this.modules.videoPlayer.setPlaylist(data.playlist, playMode);
                
                // 跟踪播放列表更新
                this.modules.monitor.addLog('playlist_update', {
                    source: 'mqtt',
                    videoCount: data.playlist.length,
                    playMode: playMode,
                    timestamp: Date.now()
                });
                
                // 发布播放列表接收确认
                this.modules.mqttClient.publishResponse({
                    type: 'playlist_received',
                    videoCount: data.playlist.length,
                    playMode: playMode
                });
            }
        });
        
        // 控制命令
        mqtt.on(mqtt.topics.control, (data) => {
            console.log('收到控制命令 [主题: control]:', data);
            
            // 检查是否是文件分发消息
            if ((data.type === 'file_distribution' || data.type === 'file-distribution') && data.files && Array.isArray(data.files)) {
                console.log('通过命令主题收到文件分发消息，开始处理:', data);
                this.handleFileDistribution(data);
                return;
            }
            
            // 处理常规控制命令
            switch (data.command) {
                case 'play':
                    this.modules.videoPlayer.play();
                    break;
                case 'pause':
                    this.modules.videoPlayer.pause();
                    break;
                case 'stop':
                    this.modules.videoPlayer.stop();
                    break;
                case 'next':
                    this.modules.videoPlayer.switchToNextVideo();
                    break;
                case 'volume':
                    this.setVolume(data.value);
                    break;
            }
            
            this.modules.monitor.addLog('control_command', data);
        });
        
        // 配置更新
        mqtt.on(mqtt.topics.config, (data) => {
            console.log('收到配置更新:', data);
            this.updateConfig(data);
        });
    }
    
    setupEventListeners() {
        // 视频播放事件
        window.addEventListener('video:play', (event) => {
            this.modules.monitor.trackPlaybackStart(event.detail);
        });
        
        window.addEventListener('video:ended', (event) => {
            this.modules.monitor.trackPlaybackComplete();
            
            // 发布播放统计
            if (this.modules.mqttClient) {
                this.modules.mqttClient.publishPlaybackStats({
                    video: event.detail,
                    playCount: this.modules.monitor.stats.playCount,
                    completeRate: this.modules.monitor.stats.completeRate
                });
            }
        });
        
        window.addEventListener('video:error', (event) => {
            this.modules.monitor.trackError('playback_error', event.detail);
        });
        
        // 键盘快捷键（开发模式）
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey || event.metaKey) {
                switch (event.key) {
                    case 'p': // Ctrl+P 显示性能面板
                        event.preventDefault();
                        this.togglePerformancePanel();
                        break;
                    case 'l': // Ctrl+L 导出日志
                        event.preventDefault();
                        this.modules.monitor.exportLogs();
                        break;
                    case 'd': // Ctrl+D 生成诊断报告
                        event.preventDefault();
                        this.generateDiagnosticReport();
                        break;
                }
            }
            
            // 空格键控制播放/暂停
            if (event.code === 'Space') {
                event.preventDefault();
                this.togglePlayPause();
            }
            
            // 方向键控制
            if (event.code === 'ArrowRight') {
                event.preventDefault();
                this.modules.videoPlayer.switchToNextVideo();
            }
            
            if (event.code === 'ArrowLeft') {
                event.preventDefault();
                this.switchToPreviousVideo();
            }
        });
        
        // 全屏控制
        document.addEventListener('fullscreenchange', () => {
            this.handleFullscreenChange();
        });
        
        // 网络状态监听
        window.addEventListener('online', () => {
            this.handleNetworkStatusChange(true);
        });
        
        window.addEventListener('offline', () => {
            this.handleNetworkStatusChange(false);
        });
    }
    
    // 处理文件分发消息
    async handleFileDistribution(data) {
        // 消息去重检查
        const messageId = data.timestamp || Date.now();
        if (this.processedFileDistributionMessages && this.processedFileDistributionMessages.has(messageId)) {
            console.log('文件分发消息已处理，跳过重复处理:', messageId);
            return;
        }
        
        // 初始化去重集合
        if (!this.processedFileDistributionMessages) {
            this.processedFileDistributionMessages = new Set();
        }
        this.processedFileDistributionMessages.add(messageId);
        
        try {
            console.log('开始处理文件分发:', data);
            
            // 验证文件列表
            if (!data.files || !Array.isArray(data.files)) {
                console.error('无效的文件分发消息: 缺少files数组');
                return;
            }
            
            console.log(`需要下载${data.files.length}个文件`, data.files);
            
            // 检查下载URL
            data.files.forEach(file => {
                if (!file.downloadUrl) {
                    console.error('文件缺少downloadUrl:', file);
                }
            });
            
            // 清空本地旧文件
            console.log('清空本地旧文件...');
            await this.modules.videoPlayer.clearLocalFiles();
            console.log('本地旧文件已清空');
            
            // 下载新文件
            const downloadedFiles = [];
            for (const file of data.files) {
                try {
                    console.log(`开始下载文件: ${file.name} (${file.downloadUrl})`);
                    const localUrl = await this.modules.videoPlayer.downloadFile(file.downloadUrl, file.uuid || file.id);
                    
                    // 检测文件类型
                    const fileFormat = this.modules.videoPlayer.getFileFormat(file.downloadUrl || file.name);
                    console.log(`检测到文件格式: ${fileFormat} 文件: ${file.name}`);
                    
                    downloadedFiles.push({
                        ...file,
                        localUrl: localUrl,
                        fileFormat: fileFormat
                    });
                    
                    console.log('文件下载完成:', file.name, localUrl, '格式:', fileFormat);
                } catch (error) {
                    console.error('文件下载失败:', file.name, error);
                }
            }
            
            // 创建播放列表
            const playlist = downloadedFiles.map(file => ({
                id: file.uuid || file.id,
                downloadUrl: file.downloadUrl,
                title: file.name,
                localUrl: file.localUrl,
                fileFormat: file.fileFormat
            }));
            
            // 设置播放列表并立即播放
            const playMode = data.mode === 'immediate' ? 'sequential' : (data.playMode || 'sequential');
            await this.modules.videoPlayer.setPlaylist(playlist, playMode);
            
            // 保存播放列表到CacheManager的IndexedDB
            if (this.modules.cacheManager) {
                try {
                    await this.modules.cacheManager.savePlaylist(playlist);
                    console.log('播放列表已保存到CacheManager');
                } catch (cacheError) {
                    console.warn('保存播放列表到CacheManager失败:', cacheError);
                }
            }
            
            // 立即开始播放
            if (data.mode === 'immediate' && downloadedFiles.length > 0) {
                console.log('开始播放下载的视频...');
                this.modules.videoPlayer.play();
            }
            
            // 跟踪文件分发
            this.modules.monitor.addLog('file_distribution', {
                source: 'mqtt',
                fileCount: data.files.length,
                downloadedCount: downloadedFiles.length,
                mode: data.mode,
                timestamp: Date.now()
            });
            
            // 发布文件分发接收确认
            this.modules.mqttClient.publishResponse({
                type: 'file_distribution_received',
                fileCount: data.files.length,
                downloadedCount: downloadedFiles.length,
                mode: data.mode
            });
            
            console.log('文件分发处理完成');
            
        } catch (error) {
            console.error('处理文件分发失败:', error);
            
            // 发布错误响应
            this.modules.mqttClient.publishResponse({
                type: 'file_distribution_error',
                error: error.message
            });
        }
    }
    
    setupPerformancePanel() {
        // 双击显示/隐藏性能面板
        document.addEventListener('dblclick', (event) => {
            if (event.target.tagName !== 'VIDEO') {
                this.togglePerformancePanel();
            }
        });
    }
    
    togglePerformancePanel() {
        const panel = document.getElementById('performance-panel');
        if (panel) {
            panel.classList.toggle('hidden');
            this.config.showPerformance = !panel.classList.contains('hidden');
            this.saveConfig();
        }
    }
    
    togglePlayPause() {
        const video = this.modules.videoPlayer.currentPlayer;
        if (video.paused) {
            video.play().catch(error => {
                console.error('播放失败:', error);
            });
        } else {
            video.pause();
        }
    }
    
    switchToPreviousVideo() {
        // 实现上一个视频切换逻辑
        const player = this.modules.videoPlayer;
        if (player.playlist.length === 0) return;
        
        player.currentIndex = (player.currentIndex - 1 + player.playlist.length) % player.playlist.length;
        player.loadCurrentVideo();
    }
    
    setVolume(volume) {
        const normalizedVolume = Math.max(0, Math.min(1, volume));
        [this.modules.videoPlayer.video1, this.modules.videoPlayer.video2].forEach(video => {
            video.volume = normalizedVolume;
        });
    }
    
    handleFullscreenChange() {
        const isFullscreen = !!document.fullscreenElement;
        console.log('全屏状态:', isFullscreen ? '进入全屏' : '退出全屏');
        
        this.modules.monitor.addLog('fullscreen_change', { isFullscreen });
    }
    
    handleNetworkStatusChange(isOnline) {
        console.log('网络状态:', isOnline ? '在线' : '离线');
        
        this.modules.monitor.addLog('network_status', { isOnline });
        
        if (isOnline && this.modules.mqttClient) {
            // 网络恢复后重新连接MQTT
            setTimeout(() => {
                this.modules.mqttClient.reconnect();
            }, 1000);
        }
    }
    
    async updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        await this.saveConfig();
        
        // 应用配置变更
        this.applyConfigChanges();
    }
    
    applyConfigChanges() {
        // 应用配置到各个模块
        if (this.config.mqttEnabled && !this.modules.mqttClient) {
            this.modules.mqttClient = new MQTTClient();
            this.modules.mqttClient.init();
        } else if (!this.config.mqttEnabled && this.modules.mqttClient) {
            this.modules.mqttClient.destroy();
            this.modules.mqttClient = null;
        }
        
        // 更新预加载数量
        this.modules.videoPlayer.preloadCount = this.config.preloadCount;
    }
    
    getDefaultPlaylist() {
        // 默认播放列表（演示用）
        return [
            {
                id: 'demo1',
                url: '',
                title: '等待文件分发',
                duration: 0,
                thumbnail: ''
            }
        ];
    }
    
    async loadConfig() {
        try {
            const savedConfig = localStorage.getItem('ad-screen-config');
            if (savedConfig) {
                this.config = { ...this.config, ...JSON.parse(savedConfig) };
            }
        } catch (error) {
            console.warn('加载配置失败:', error);
        }
    }
    
    async saveConfig() {
        try {
            localStorage.setItem('ad-screen-config', JSON.stringify(this.config));
        } catch (error) {
            console.error('保存配置失败:', error);
        }
    }
    
    async generateDiagnosticReport() {
        try {
            const report = await this.modules.monitor.generateDiagnosticReport();
            
            // 保存报告到本地
            const blob = new Blob([JSON.stringify(report, null, 2)], {
                type: 'application/json'
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ad-screen-diagnostic-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            
            console.log('诊断报告已生成');
            
        } catch (error) {
            console.error('生成诊断报告失败:', error);
        }
    }
    
    showFatalError(message) {
        const errorOverlay = document.getElementById('error-overlay');
        const errorMessage = document.getElementById('error-message');
        const retryBtn = document.getElementById('retry-btn');
        
        if (errorOverlay && errorMessage) {
            errorMessage.textContent = message;
            errorOverlay.classList.remove('hidden');
            
            // 重试按钮重新初始化
            if (retryBtn) {
                retryBtn.onclick = () => {
                    location.reload();
                };
            }
        }
    }
    
    // 公共API
    getStatus() {
        return {
            initialized: this.isInitialized,
            config: this.config,
            modules: {
                videoPlayer: !!this.modules.videoPlayer,
                cacheManager: !!this.modules.cacheManager,
                mqttClient: !!this.modules.mqttClient,
                monitor: !!this.modules.monitor
            },
            performance: this.modules.monitor.getPerformanceReport()
        };
    }
    
    // 销毁资源
    destroy() {
        if (this.modules.videoPlayer) {
            this.modules.videoPlayer.destroy();
        }
        
        if (this.modules.mqttClient) {
            this.modules.mqttClient.destroy();
        }
        
        if (this.modules.monitor) {
            this.modules.monitor.destroy();
        }
        
        if (this.modules.cacheManager) {
            // 缓存管理器不需要特殊销毁
        }
        
        console.log('广告屏播放器已销毁');
    }
}

// 全局错误处理
window.addEventListener('error', (event) => {
    console.error('全局错误:', event.error);
    
    // 发送错误报告
    if (window.adScreenPlayer && window.adScreenPlayer.modules.monitor) {
        window.adScreenPlayer.modules.monitor.trackError('global_error', {
            message: event.error.message,
            stack: event.error.stack,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
    }
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('未处理的Promise拒绝:', event.reason);
    
    if (window.adScreenPlayer && window.adScreenPlayer.modules.monitor) {
        window.adScreenPlayer.modules.monitor.trackError('unhandled_rejection', {
            reason: event.reason
        });
    }
});

// 应用启动
document.addEventListener('DOMContentLoaded', () => {
    // 设置全局对象
    window.adScreenPlayer = new AdScreenPlayer();
    
    // 开发工具（仅开发模式）
    if (window.location.hostname === 'localhost' || window.location.protocol === 'file:') {
        console.log('开发模式已启用');
        console.log('快捷键: Ctrl+P - 性能面板, Ctrl+L - 导出日志, Ctrl+D - 诊断报告');
        console.log('空格键 - 播放/暂停, 方向键 - 切换视频');
    }
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    if (window.adScreenPlayer) {
        window.adScreenPlayer.destroy();
    }
});