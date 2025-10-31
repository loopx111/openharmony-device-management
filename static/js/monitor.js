class PerformanceMonitor {
    constructor() {
        this.metrics = {
            fps: 0,
            memory: 0,
            stutterRate: 0,
            cpuLoad: 0,
            networkLatency: 0
        };
        
        this.stats = {
            playCount: 0,
            completeRate: 0,
            avgWatchTime: 0,
            errorCount: 0
        };
        
        this.logs = [];
        this.maxLogSize = 1000;
        
        this.init();
    }
    
    init() {
        this.startFPSCounter();
        this.startMemoryMonitor();
        this.startStutterDetection();
        this.startPerformanceLogging();
    }
    
    // FPS计数器
    startFPSCounter() {
        let lastTime = performance.now();
        let frames = 0;
        
        const calculateFPS = () => {
            frames++;
            const currentTime = performance.now();
            
            if (currentTime - lastTime >= 1000) {
                this.metrics.fps = Math.round((frames * 1000) / (currentTime - lastTime));
                frames = 0;
                lastTime = currentTime;
                
                this.updateDisplay();
            }
            
            requestAnimationFrame(calculateFPS);
        };
        
        calculateFPS();
    }
    
    // 内存监控
    startMemoryMonitor() {
        if (performance.memory) {
            setInterval(() => {
                this.metrics.memory = performance.memory.usedJSHeapSize;
            }, 5000);
        }
    }
    
    // 卡顿检测
    startStutterDetection() {
        let lastFrameTime = performance.now();
        let stutterFrames = 0;
        let totalFrames = 0;
        
        const checkStutter = () => {
            const currentTime = performance.now();
            const frameTime = currentTime - lastFrameTime;
            
            // 如果帧时间超过33ms（30fps），认为是卡顿
            // 仅记录严重卡顿(>100ms)
            if (frameTime > 100) {
                stutterFrames++;
                this.logStutter(frameTime);
            }
            
            totalFrames++;
            lastFrameTime = currentTime;
            
            // 每5秒计算一次卡顿率
            if (totalFrames >= 150) { // 5秒 * 30fps
                this.metrics.stutterRate = (stutterFrames / totalFrames * 100).toFixed(1);
                stutterFrames = 0;
                totalFrames = 0;
            }
            
            requestAnimationFrame(checkStutter);
        };
        
        checkStutter();
    }
    
    // 卡顿日志
    logStutter(frameTime) {
        // 仅记录严重卡顿(>100ms)
        if (frameTime > 100) {
            this.addLog('stutter', {
                frameTime,
                timestamp: Date.now(),
                fps: this.metrics.fps
            });
        }
    }
    
    // 性能日志记录
    startPerformanceLogging() {
        setInterval(() => {
            this.recordPerformanceSnapshot();
        }, 30000); // 每30秒记录一次
    }
    
    recordPerformanceSnapshot() {
        const snapshot = {
            timestamp: Date.now(),
            metrics: { ...this.metrics },
            stats: { ...this.stats }
        };
        
        this.addLog('performance_snapshot', snapshot);
        
        // 发布到MQTT（如果可用）
        if (window.mqttClient && window.mqttClient.isConnected) {
            window.mqttClient.publishStatus({
                type: 'performance_snapshot',
                ...snapshot
            });
        }
    }
    
    // 播放统计
    trackPlaybackStart(videoInfo) {
        this.stats.playCount++;
        this.currentVideoStartTime = Date.now();
        this.currentVideo = videoInfo;
        
        this.addLog('playback_start', {
            video: videoInfo,
            timestamp: this.currentVideoStartTime
        });
    }
    
    trackPlaybackComplete() {
        if (this.currentVideoStartTime) {
            const watchTime = Date.now() - this.currentVideoStartTime;
            
            // 更新平均观看时间
            this.stats.avgWatchTime = (
                (this.stats.avgWatchTime * (this.stats.playCount - 1) + watchTime) / 
                this.stats.playCount
            );
            
            // 计算完成率（观看时间超过视频长度的80%视为完成）
            if (this.currentVideo && this.currentVideo.duration) {
                const completionRate = Math.min(watchTime / this.currentVideo.duration, 1);
                if (completionRate > 0.8) {
                    this.stats.completeRate = (
                        (this.stats.completeRate * (this.stats.playCount - 1) + 1) / 
                        this.stats.playCount
                    );
                }
            }
            
            this.addLog('playback_complete', {
                video: this.currentVideo,
                watchTime,
                completionRate: watchTime / (this.currentVideo.duration || watchTime)
            });
            
            this.currentVideoStartTime = null;
            this.currentVideo = null;
        }
    }
    
    // 错误跟踪
    trackError(errorType, errorDetails) {
        this.stats.errorCount++;
        
        this.addLog('error', {
            type: errorType,
            details: errorDetails,
            timestamp: Date.now()
        });
        
        // 发布错误报告
        if (window.mqttClient && window.mqttClient.isConnected) {
            window.mqttClient.publishStatus({
                type: 'error_report',
                errorType,
                errorDetails,
                timestamp: Date.now()
            });
        }
    }
    
    // 网络性能监控
    trackNetworkPerformance(url, loadTime, success) {
        this.addLog('network_performance', {
            url,
            loadTime,
            success,
            timestamp: Date.now()
        });
        
        if (!success) {
            this.trackError('network_error', { url, loadTime });
        }
    }
    
    // 日志管理
    addLog(type, data) {
        const logEntry = {
            id: this.generateLogId(),
            type,
            timestamp: Date.now(),
            data
        };
        
        this.logs.push(logEntry);
        
        // 限制日志大小
        if (this.logs.length > this.maxLogSize) {
            this.logs = this.logs.slice(-this.maxLogSize);
        }
        
        // 控制台输出（开发模式）
        if (this.isDevelopmentMode()) {
            console.log(`[${type}]`, data);
        }
    }
    
    generateLogId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
    
    // 获取日志
    getLogs(filter = {}, limit = 100) {
        let filteredLogs = this.logs;
        
        if (filter.type) {
            filteredLogs = filteredLogs.filter(log => log.type === filter.type);
        }
        
        if (filter.startTime) {
            filteredLogs = filteredLogs.filter(log => log.timestamp >= filter.startTime);
        }
        
        if (filter.endTime) {
            filteredLogs = filteredLogs.filter(log => log.timestamp <= filter.endTime);
        }
        
        return filteredLogs.slice(-limit);
    }
    
    // 导出日志
    exportLogs() {
        const logData = {
            exportTime: Date.now(),
            metrics: this.metrics,
            stats: this.stats,
            logs: this.logs
        };
        
        const blob = new Blob([JSON.stringify(logData, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ad-screen-logs-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    // 屏幕截图（需要用户交互）
    async takeScreenshot() {
        try {
            // 使用Canvas截图
            const canvas = document.createElement('canvas');
            const video = document.querySelector('.video-player.active');
            const ctx = canvas.getContext('2d');
            
            canvas.width = video.videoWidth || window.innerWidth;
            canvas.height = video.videoHeight || window.innerHeight;
            
            if (video.videoWidth > 0) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            } else {
                // 截图当前页面
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            
            return canvas.toDataURL('image/jpeg', 0.8);
        } catch (error) {
            console.error('截图失败:', error);
            return null;
        }
    }
    
    // 远程诊断
    async generateDiagnosticReport() {
        const report = {
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screen: {
                width: screen.width,
                height: screen.height,
                colorDepth: screen.colorDepth
            },
            connection: navigator.connection ? {
                effectiveType: navigator.connection.effectiveType,
                downlink: navigator.connection.downlink,
                rtt: navigator.connection.rtt
            } : null,
            performance: {
                timing: performance.timing,
                navigation: performance.navigation
            },
            metrics: this.metrics,
            stats: this.stats,
            recentLogs: this.getLogs({}, 50)
        };
        
        // 添加截图
        try {
            report.screenshot = await this.takeScreenshot();
        } catch (error) {
            report.screenshotError = error.message;
        }
        
        return report;
    }
    
    // 更新显示
    updateDisplay() {
        // 更新FPS显示
        const fpsElement = document.getElementById('fps-counter');
        if (fpsElement) {
            fpsElement.textContent = this.metrics.fps;
        }
        
        // 更新内存显示
        const memoryElement = document.getElementById('memory-usage');
        if (memoryElement) {
            const memoryMB = (this.metrics.memory / (1024 * 1024)).toFixed(1);
            memoryElement.textContent = `${memoryMB}MB`;
        }
        
        // 更新卡顿率显示
        const stutterElement = document.getElementById('stutter-rate');
        if (stutterElement) {
            stutterElement.textContent = `${this.metrics.stutterRate}%`;
        }
    }
    
    // 开发模式检测
    isDevelopmentMode() {
        return window.location.hostname === 'localhost' || 
               window.location.hostname === '127.0.0.1' ||
               window.location.protocol === 'file:';
    }
    
    // 获取性能报告
    getPerformanceReport() {
        return {
            metrics: { ...this.metrics },
            stats: { ...this.stats },
            summary: this.getPerformanceSummary()
        };
    }
    
    getPerformanceSummary() {
        const grade = this.calculatePerformanceGrade();
        
        return {
            grade,
            recommendations: this.getRecommendations(),
            issues: this.detectIssues()
        };
    }
    
    calculatePerformanceGrade() {
        let score = 100;
        
        // FPS评分
        if (this.metrics.fps < 24) score -= 30;
        else if (this.metrics.fps < 30) score -= 15;
        
        // 卡顿率评分
        if (this.metrics.stutterRate > 10) score -= 25;
        else if (this.metrics.stutterRate > 5) score -= 10;
        
        // 内存评分
        if (this.metrics.memory > 500 * 1024 * 1024) score -= 20;
        
        // 错误率评分
        const errorRate = this.stats.errorCount / Math.max(this.stats.playCount, 1);
        if (errorRate > 0.1) score -= 25;
        
        return Math.max(0, Math.min(100, score));
    }
    
    getRecommendations() {
        const recommendations = [];
        
        if (this.metrics.fps < 24) {
            recommendations.push('优化视频编码或降低分辨率以提高帧率');
        }
        
        if (this.metrics.stutterRate > 5) {
            recommendations.push('检查网络连接或优化缓存策略');
        }
        
        if (this.metrics.memory > 400 * 1024 * 1024) {
            recommendations.push('清理缓存或减少同时预加载的视频数量');
        }
        
        return recommendations;
    }
    
    detectIssues() {
        const issues = [];
        
        if (this.metrics.fps < 20) {
            issues.push('帧率过低，影响观看体验');
        }
        
        if (this.metrics.stutterRate > 10) {
            issues.push('卡顿频繁，需要优化');
        }
        
        if (this.stats.errorCount > this.stats.playCount * 0.2) {
            issues.push('错误率过高，需要检查网络或视频源');
        }
        
        return issues;
    }
    
    // 销毁资源
    destroy() {
        // 清理资源
        this.logs = [];
    }
}

// 导出单例
window.PerformanceMonitor = PerformanceMonitor;