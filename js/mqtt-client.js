class MQTTClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 3000; // 3秒重连间隔
        this.processedMessages = new Set(); // 用于消息去重
        
        // MQTT配置
        this.config = {
            host: 'broker.emqx.io', // 默认MQTT服务器
            port: 8083,
            clientId: 'ad_001', // 默认设备ID
            username: '',
            password: '',
            devicePath: '设备/区域/南京/鼓楼', // 设备层级路径
            cleanSession: true,
            keepalive: 60 // 心跳间隔
        };
        
        // 订阅主题（基于路径的层级结构）
        this.topics = {
            // 设备注册主题
            deviceRegister: '设备/{clientId}/注册',
            
            // 命令主题（按层级订阅）
            deviceCommand: '设备/{clientId}/命令',
            pathCommand: '设备/{path}/命令',
            control: '设备/{clientId}/命令', // 明确指定控制主题
            
            // 状态上报主题（只发布到设备层级）
            deviceStatus: '设备/{clientId}/状态',
            deviceHeartbeat: '设备/{clientId}/心跳',
            deviceData: '设备/{clientId}/数据',
            deviceAlert: '设备/{clientId}/告警',
            deviceResponse: '设备/{clientId}/响应'
        };
        
        this.messageHandlers = new Map();
        this.init();
    }
    
    async init() {
        await this.loadConfig();
        this.setupEventListeners();
        
        // 注册状态消息处理器
        this.on(this.parseTopicTemplate(this.topics.deviceStatus), (data) => {
            console.log('收到状态消息:', data);
        });
        
        // 注册命令消息处理器
        this.on(this.parseTopicTemplate(this.topics.deviceCommand), (data) => {
            console.log('收到命令消息:', data);
            if (data.type === 'file_distribution') {
                console.log('处理文件分发消息:', data);
                // 触发文件分发逻辑
                this.triggerEvent('fileDistribution', data);
            }
        });
        
        this.connect();
    }
    
    // 加载配置
    async loadConfig() {
        try {
            // 首先尝试从内联配置加载
            if (window.AD_SCREEN_CONFIG && window.AD_SCREEN_CONFIG.mqtt) {
                this.config = { ...this.config, ...window.AD_SCREEN_CONFIG.mqtt };
                console.log('从内联配置加载MQTT配置:', this.config);
            }
            
            // 然后尝试从localStorage加载用户自定义配置
            const savedConfig = localStorage.getItem('mqtt-config');
            if (savedConfig) {
                const userConfig = JSON.parse(savedConfig);
                this.config = { ...this.config, ...userConfig };
                console.log('从localStorage加载用户配置:', userConfig);
            }
            
            // 确保clientId有默认值
            if (!this.config.clientId || this.config.clientId === 'ad-screen-') {
                this.config.clientId = 'ad_001';
            }
            
            console.log('最终MQTT配置:', this.config);
            
        } catch (error) {
            console.warn('加载MQTT配置失败:', error);
        }
    }
    
    // 保存配置
    async saveConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        localStorage.setItem('mqtt-config', JSON.stringify(this.config));
        
        // 重新连接
        if (this.client) {
            this.disconnect();
        }
        this.connect();
    }
    
    // 连接MQTT服务器
    connect() {
        try {
            // 检查是否已连接
            if (this.isConnected) {
                console.log('MQTT已连接，跳过重复连接');
                return;
            }
            
            // 检查重连次数限制
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                console.warn('已达到最大重连次数，停止重连');
                return;
            }
            
            // 构建WebSocket URL
            const protocol = this.config.port === 443 ? 'wss' : 'ws';
            const url = `${protocol}://${this.config.host}:${this.config.port}/mqtt`;
            
            console.log('MQTT连接配置:', {
                url: url,
                clientId: this.config.clientId,
                host: this.config.host,
                port: this.config.port
            });
            
            // 使用真实MQTT.js库连接
            const options = {
                clientId: this.config.clientId,
                username: this.config.username,
                password: this.config.password,
                clean: this.config.cleanSession,
                keepalive: this.config.keepalive,
                reconnectPeriod: 0, // 禁用自动重连，使用自定义逻辑
                connectTimeout: 5000, // 连接超时5秒
                resubscribe: false // 禁用自动重新订阅
            };
            
            this.client = mqtt.connect(url, options);
            
            this.setupClientEvents();
            this.updateConnectionStatus('connecting');
            
        } catch (error) {
            console.error('MQTT连接失败:', error);
            this.handleConnectionError(error);
        }
    }
    
    // 设置客户端事件
    setupClientEvents() {
        this.client.on('connect', () => {
            console.log('MQTT连接成功');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.updateConnectionStatus('connected');
            this.subscribeToTopics();
            this.startHeartbeat();
            
            // 发布设备注册信息和上线通知
            setTimeout(() => {
                this.publishDeviceRegister();
                this.publishDeviceOnline();
            }, 1000);
        });
        
        this.client.on('message', (topic, message) => {
            this.handleMessage(topic, message.toString());
        });
        
        this.client.on('error', (error) => {
            console.error('MQTT错误:', error);
            this.handleConnectionError(error);
        });
        
        this.client.on('close', () => {
            console.log('MQTT连接关闭');
            this.isConnected = false;
            this.updateConnectionStatus('disconnected');
            
            // 检查是否达到最大重连次数
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                // 发布设备离线通知
                this.publishDeviceOffline();
                
                this.handleReconnection();
            } else {
                console.warn('已达到最大重连次数，停止重连');
            }
        });
        
        this.client.on('offline', () => {
            console.log('MQTT客户端离线');
            this.isConnected = false;
            this.updateConnectionStatus('disconnected');
        });
    }
    
    // 解析主题模板
    parseTopicTemplate(template) {
        if (!template) return '';
        return template
            .replace('{clientId}', this.config.clientId)
            .replace('{path}', this.config.devicePath);
    }
    
    // 解析设备路径，生成所有层级路径
    getAllPathLevels() {
        const path = this.config.devicePath;
        const parts = path.split('/');
        const levels = [];
        
        // 生成所有层级路径：设备/区域/南京/鼓楼 → 区域/南京/鼓楼 → 区域/南京 → 区域
        // 注意：设备层级已经在设备级主题中单独处理，这里只生成路径层级
        for (let i = parts.length; i > 1; i--) {
            const levelPath = parts.slice(1, i).join('/');
            if (levelPath) {
                levels.push(levelPath);
            }
        }
        
        return levels;
    }
    
    // 获取所有需要订阅的命令主题列表
    getAllCommandTopics() {
        const topics = [];
        
        // 设备级命令主题：动态解析为实际主题（如 设备/ad_001/命令）
        topics.push(this.parseTopicTemplate(this.topics.deviceCommand));
        
        // 根据设备路径生成所有层级命令主题
        const pathLevels = this.getAllPathLevels();
        pathLevels.forEach(levelPath => {
            // 格式：设备/区域/南京/鼓楼/命令
            const topic = `设备/${levelPath}/命令`;
            topics.push(topic);
        });
        
        console.log('生成的命令主题列表:', topics);
        return topics;
    }
    
    // 获取所有需要订阅的状态主题列表
    getAllStatusTopics() {
        const topics = [];
        
        // 设备级状态主题：设备/ad_001/状态
        topics.push(this.parseTopicTemplate(this.topics.deviceStatus));
        
        // 根据设备路径生成所有层级状态主题
        const pathLevels = this.getAllPathLevels();
        pathLevels.forEach(levelPath => {
            // 格式：设备/区域/南京/鼓楼/状态
            const topic = `设备/${levelPath}/状态`;
            topics.push(topic);
        });
        
        return topics;
    }
    
    // 订阅主题
    subscribeToTopics() {
        if (this.isSubscribed) {
            console.log('主题已订阅，跳过重复订阅');
            return;
        }
        
        const commandTopics = this.getAllCommandTopics();
        const statusTopics = this.getAllStatusTopics();
        
        console.log('开始订阅命令主题:', commandTopics);
        
        // 订阅所有命令主题
        commandTopics.forEach(topic => {
            this.client.subscribe(topic, { qos: 1 }, (error) => {
                if (error) {
                    console.error(`订阅命令主题 ${topic} 失败:`, error);
                } else {
                    console.log(`成功订阅命令主题: ${topic}`);
                }
            });
        });
        
        // 订阅设备状态主题（用于接收状态确认）
        statusTopics.forEach(topic => {
            this.client.subscribe(topic, { qos: 1 }, (error) => {
                if (error) {
                    console.error(`订阅状态主题 ${topic} 失败:`, error);
                }
            });
        });
        
        this.isSubscribed = true;
    }
    
    // 处理消息
    handleMessage(topic, message) {
        try {
            const data = JSON.parse(message);
            console.log(`收到消息 [${topic}]:`, data);
            
            // 检查消息是否包含身份验证令牌
            if (data.authToken) {
                window.authToken = data.authToken;
                console.log('更新身份验证令牌:', window.authToken);
            }
            
            // 调用注册的消息处理器
            if (this.messageHandlers.has(topic)) {
                console.log(`找到消息处理器 for ${topic}`);
                // 去重逻辑：检查是否已处理过该消息
                const messageId = data.id || data.timestamp || `${topic}_${Date.now()}`;
                if (this.processedMessages.has(messageId)) {
                    console.log(`消息已处理，跳过: ${messageId}`);
                    return;
                }
                this.processedMessages.add(messageId);
                
                this.messageHandlers.get(topic).forEach(handler => {
                    try {
                        handler(data, topic);
                    } catch (error) {
                        console.error('消息处理器错误:', error);
                    }
                });
            } else {
                console.log(`未注册消息处理器 for ${topic}`);
            }
            
            // 特定主题处理（支持新的路径层级结构）
            const commandTopics = this.getAllCommandTopics();
            if (commandTopics.includes(topic)) {
                // 检查是否是文件分发消息，如果是则跳过常规命令处理
                if (data.type === 'file_distribution' || data.type === 'file-distribution') {
                    console.log('检测到文件分发消息，跳过常规命令处理');
                    console.log(`当前消息主题: ${topic}, 有效命令主题列表: ${commandTopics.join(', ')}`);
                } else {
                    this.handleControlCommand(data, topic);
                }
            }
            
            // 处理状态主题消息（用于接收管理端确认）
            const statusTopics = this.getAllStatusTopics();
            if (statusTopics.includes(topic)) {
                this.handleStatusMessage(data, topic);
            }
            
        } catch (error) {
            console.error('消息解析失败:', error);
        }
    }
    
    // 处理播放列表更新
    handlePlaylistUpdate(data, topic) {
        if (data.playlist && Array.isArray(data.playlist)) {
            // 添加主题层级信息
            const playlistData = {
                playlist: data.playlist,
                source: this.getTopicLevel(topic),
                priority: this.getTopicPriority(topic),
                timestamp: Date.now()
            };
            
            // 触发播放列表更新事件
            this.triggerEvent('playlistUpdate', playlistData);
        }
    }
    
    // 处理控制命令
    handleControlCommand(data, topic) {
        const commands = {
            play: () => this.triggerEvent('play'),
            pause: () => this.triggerEvent('pause'),
            stop: () => this.triggerEvent('stop'),
            next: () => this.triggerEvent('next'),
            previous: () => this.triggerEvent('previous'),
            volume: (value) => this.triggerEvent('volumeChange', value),
            reboot: () => this.triggerEvent('reboot'),
            update: () => this.triggerEvent('update')
        };
        
        if (data.command && commands[data.command]) {
            // 添加命令来源信息
            const commandData = {
                command: data.command,
                value: data.value,
                source: topic,
                priority: this.getTopicPriority(topic)
            };
            
            commands[data.command](data.value);
            
            // 记录命令执行
            this.logCommandExecution(commandData);
        }
    }
    
    // 处理状态消息
    handleStatusMessage(data, topic) {
        // 处理管理端发送的状态确认消息
        if (data.type === 'command_ack') {
            console.log('收到命令确认:', data);
        }
    }
    
    // 获取主题优先级（路径越具体优先级越高）
    getTopicPriority(topic) {
        const pathParts = topic.split('/');
        // 路径层级数越多，优先级越高
        // 设备/ad_001/命令 (3级) > 设备/区域/南京/鼓楼/命令 (5级) > 设备/命令 (2级)
        return pathParts.length;
    }
    
    // 记录命令执行
    logCommandExecution(commandData) {
        const logEntry = {
            type: 'command_execution',
            id: this.config.clientId,
            path: this.config.devicePath,
            timestamp: Date.now(),
            ...commandData
        };
        
        // 发布到设备状态主题
        this.publish(this.parseTopicTemplate(this.topics.deviceStatus), logEntry);
        
        console.log('命令执行记录:', logEntry);
    }
    
    // 处理配置更新
    handleConfigUpdate(data) {
        if (data.mqttConfig) {
            this.saveConfig(data.mqttConfig);
        }
    }
    
    // 发布消息
    publish(topic, message, options = {}) {
        if (!this.isConnected) {
            console.warn('MQTT未连接，无法发布消息');
            return false;
        }
        
        try {
            const payload = typeof message === 'string' ? message : JSON.stringify(message);
            
            // 使用回调确保消息发送状态
            return new Promise((resolve) => {
                this.client.publish(topic, payload, { qos: 1, ...options }, (error) => {
                    if (error) {
                        console.error('发布消息失败:', error);
                        resolve(false);
                    } else {
                        console.log('消息发布成功:', topic, message);
                        resolve(true);
                    }
                });
            });
        } catch (error) {
            console.error('发布消息异常:', error);
            return false;
        }
    }
    
    // 发布状态信息（只发布到设备层级）
    publishStatus(status) {
        const statusMessage = {
            id: this.config.clientId,
            path: this.config.devicePath,
            timestamp: Date.now(),
            status: status,
            version: '1.0.0',
            ...status
        };
        
        // 只发布到设备级状态主题：设备/ad_001/状态
        return this.publish(this.parseTopicTemplate(this.topics.deviceStatus), statusMessage);
    }
    
    // 发布播放统计
    publishPlaybackStats(stats) {
        const statsMessage = {
            clientId: this.config.clientId,
            region: this.config.region,
            area: this.config.area,
            group: this.config.group,
            timestamp: Date.now(),
            type: 'playback_stats',
            ...stats
        };
        
        // 发布到设备级数据主题：设备/ad_001/数据
        return this.publish(this.parseTopicTemplate(this.topics.deviceData), statsMessage);
    }
    
    // 发布心跳信息
    publishHeartbeat(heartbeatData = {}) {
        const heartbeatMessage = {
            id: this.config.clientId,
            path: this.config.devicePath,
            type: 'heartbeat',
            timestamp: Date.now(),
            status: 'online',
            memory: performance.memory ? performance.memory.usedJSHeapSize : 0,
            ...heartbeatData
        };
        
        // 发布到设备级心跳主题：设备/ad_001/心跳
        return this.publish(this.parseTopicTemplate(this.topics.deviceHeartbeat), heartbeatMessage);
    }
    
    // 发布告警信息
    publishAlert(alertData) {
        const alertMessage = {
            id: this.config.clientId,
            path: this.config.devicePath,
            type: 'alert',
            timestamp: Date.now(),
            level: alertData.level || 'warning',
            message: alertData.message || '',
            ...alertData
        };
        
        // 发布到设备级告警主题：设备/ad_001/告警
        return this.publish(this.parseTopicTemplate(this.topics.deviceAlert), alertMessage);
    }
    
    // 发布响应信息
    publishResponse(responseData) {
        const responseMessage = {
            id: this.config.clientId,
            path: this.config.devicePath,
            type: 'response',
            timestamp: Date.now(),
            requestId: responseData.requestId || '',
            result: responseData.result || 'success',
            ...responseData
        };
        
        // 发布到设备级响应主题：设备/ad_001/响应
        return this.publish(this.parseTopicTemplate(this.topics.deviceResponse), responseMessage);
    }
    
    // 发布设备注册信息
    publishDeviceRegister() {
        const registerMessage = {
            id: this.config.clientId,
            path: this.config.devicePath,
            type: 'register',
            value: '',
            timestamp: Date.now(),
            version: '1.0.0',
            ip: this.getLocalIP() || 'unknown'
        };
        
        // 发布到设备注册主题
        return this.publish(this.parseTopicTemplate(this.topics.deviceRegister), registerMessage);
    }
    
    // 发布设备上线通知
    publishDeviceOnline() {
        const onlineMessage = {
            id: this.config.clientId,
            path: this.config.devicePath,
            type: 'online',
            value: '',
            timestamp: Date.now(),
            status: 'online',
            version: '1.0.0',
            ip: this.getLocalIP() || 'unknown'
        };
        
        // 只发布到设备级状态主题：设备/ad_001/状态
        return this.publish(this.parseTopicTemplate(this.topics.deviceStatus), onlineMessage);
    }
    
    // 发布设备离线通知
    publishDeviceOffline() {
        const offlineMessage = {
            id: this.config.clientId,
            path: this.config.devicePath,
            type: 'offline',
            value: '',
            timestamp: Date.now(),
            status: 'offline',
            reason: 'disconnected'
        };
        
        // 只发布到设备级状态主题：设备/ad_001/状态
        this.publish(this.parseTopicTemplate(this.topics.deviceStatus), offlineMessage);
    }
    
    // 获取本地IP（简化实现）
    getLocalIP() {
        // 在实际环境中，可以通过WebRTC或其他方式获取真实IP
        // 这里返回一个占位符
        return '192.168.1.100';
    }
    
    // 注册消息处理器
    on(topic, handler) {
        if (!this.messageHandlers.has(topic)) {
            this.messageHandlers.set(topic, []);
        }
        this.messageHandlers.get(topic).push(handler);
        console.log(`处理器已注册 for ${topic}`); // 添加注册确认日志
    }
    
    // 移除消息处理器
    off(topic, handler) {
        if (this.messageHandlers.has(topic)) {
            const handlers = this.messageHandlers.get(topic);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }
    
    // 触发自定义事件
    triggerEvent(eventName, data) {
        const event = new CustomEvent(`mqtt:${eventName}`, { detail: data });
        window.dispatchEvent(event);
    }
    
    // 连接状态管理
    updateConnectionStatus(status) {
        const statusElement = document.getElementById('network-status');
        const dotElement = document.getElementById('status-dot');
        const textElement = document.getElementById('status-text');
        
        if (statusElement && dotElement && textElement) {
            const statusConfig = {
                connected: { 
                    dotClass: 'connected', 
                    text: '已连接',
                    bgColor: '#4CAF50'
                },
                connecting: { 
                    dotClass: 'connecting', 
                    text: '连接中...',
                    bgColor: '#FFC107'
                },
                disconnected: { 
                    dotClass: 'disconnected', 
                    text: '连接断开',
                    bgColor: '#F44336'
                }
            };
            
            const config = statusConfig[status] || statusConfig.disconnected;
            
            dotElement.className = 'status-dot ' + config.dotClass;
            textElement.textContent = config.text;
            statusElement.style.backgroundColor = config.bgColor;
        }
        
        // 发布连接状态
        this.publishStatus({ connection: status });
    }
    
    // 处理连接错误
    handleConnectionError(error) {
        console.error('MQTT连接错误:', error);
        this.isConnected = false;
        this.updateConnectionStatus('disconnected');
        this.handleReconnection();
    }
    
    // 重连逻辑
    handleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('达到最大重连次数，停止重连');
            
            // 60秒后重置重连计数器
            setTimeout(() => {
                this.reconnectAttempts = 0;
                console.log('重置重连计数器');
            }, 60000);
            return;
        }
        
        this.reconnectAttempts++;
        
        // 使用指数退避算法，增加重连间隔
        const delay = Math.min(
            this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
            30000 // 最大重连间隔30秒
        );
        
        console.log(`${delay/1000}秒后尝试第${this.reconnectAttempts}次重连...`);
        
        setTimeout(() => {
            if (!this.isConnected && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.connect();
            }
        }, delay);
    }
    
    // 心跳机制
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected) {
                this.publishHeartbeat({ 
                    memory: performance.memory ? performance.memory.usedJSHeapSize : 0
                });
            }
        }, this.config.keepalive * 1000);
    }
    
    // 停止心跳
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    // 断开连接
    disconnect() {
        if (this.client) {
            this.stopHeartbeat();
            this.client.end();
            this.client = null;
            this.isConnected = false;
            this.updateConnectionStatus('disconnected');
        }
    }
    
    // 重新连接
    reconnect() {
        this.disconnect();
        this.reconnectAttempts = 0;
        this.connect();
    }
    
    // 获取连接状态
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            config: this.config
        };
    }
    
    // 设置事件监听器
    setupEventListeners() {
        // 网络状态变化监听
        window.addEventListener('online', () => {
            console.log('网络恢复，尝试重连');
            this.reconnect();
        });
        
        window.addEventListener('offline', () => {
            console.log('网络断开');
            this.updateConnectionStatus('disconnected');
        });
        
        // 页面可见性变化
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !this.isConnected) {
                this.reconnect();
            }
        });
    }
    
    // 销毁资源
    destroy() {
        this.disconnect();
        this.messageHandlers.clear();
    }
}

// 导出单例
window.MQTTClient = MQTTClient;