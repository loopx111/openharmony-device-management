# 鸿蒙广告屏播放器

基于HTML5开发的商用广告屏播放器，专为鸿蒙系统优化，支持硬件解码、MQTT远程控制和智能缓存管理。

## 功能特性

### 🎬 播放器核心
- **硬件解码支持**：优化视频播放性能
- **无缝切换**：双video标签实现零黑屏切换
- **预加载机制**：提前加载接下来3个视频
- **LRU缓存策略**：智能内存管理

### 📡 MQTT通信
- **自动重连**：网络异常自动恢复
- **心跳保持**：实时连接状态监控
- **远程控制**：播放列表、音量、播放状态控制
- **JSON协议**：标准化消息格式

### 💾 缓存系统
- **三级缓存架构**：内存 → 磁盘 → 网络
- **智能缓存策略**：基于热度、大小、频率
- **IndexedDB存储**：播放列表和元数据持久化

### 📊 监控运维
- **性能监控**：帧率、卡顿率、内存使用
- **业务统计**：播放次数、完成率、停留时间
- **远程诊断**：日志收集、屏幕截图
- **自动更新**：静默升级机制

### 🎨 UI/UX设计
- **全屏Kiosk模式**：无控制UI干扰
- **网络状态指示**：实时连接状态显示
- **优雅加载动画**：流畅的用户体验
- **错误友好提示**：智能错误处理

## 快速开始

### 环境要求
- 现代浏览器（Chrome 70+、Firefox 65+、Safari 12+）
- 支持HTML5 Video和IndexedDB
- 网络连接（用于MQTT和视频加载）

### 安装部署

1. **直接部署**
   ```bash
   # 克隆或下载项目文件
   # 部署到Web服务器
   ```

2. **配置MQTT服务器**
   ```javascript
   // 修改 config.json 中的MQTT配置
   {
     "mqtt": {
       "host": "your-mqtt-server.com",
       "port": 8083,
       "username": "your-username",
       "password": "your-password"
     }
   }
   ```

3. **设置播放列表**
   - 通过MQTT消息动态更新
   - 修改 `main.js` 中的默认播放列表
   - 使用管理后台配置

### 开发模式

在浏览器中打开 `index.html`，支持以下快捷键：

- `Ctrl+P`：显示/隐藏性能面板
- `Ctrl+L`：导出日志文件
- `Ctrl+D`：生成诊断报告
- `空格键`：播放/暂停
- `方向键`：切换视频

## 技术架构

### 核心模块

```
AdScreenPlayer
├── VideoPlayer（视频播放）
├── CacheManager（缓存管理）
├── MQTTClient（通信模块）
└── PerformanceMonitor（监控系统）
```

### 缓存策略

1. **L1内存缓存**：当前和预加载视频
2. **L2磁盘缓存**：IndexedDB持久化存储
3. **L3网络缓存**：CDN源站回源

### MQTT主题

- `ad-screen/control`：播放控制命令
- `ad-screen/playlist`：播放列表更新
- `ad-screen/status`：设备状态上报
- `ad-screen/config`：配置更新

## API文档

### MQTT消息格式

#### 播放列表更新
```json
{
  "type": "playlist_update",
  "playlist": [
    {
      "id": "video1",
      "url": "https://example.com/video1.mp4",
      "title": "广告视频1",
      "duration": 30,
      "thumbnail": "https://example.com/thumb1.jpg"
    }
  ]
}
```

#### 控制命令
```json
{
  "command": "play|pause|stop|next|previous|volume",
  "value": 0.8  // 音量命令时使用
}
```

### JavaScript API

```javascript
// 获取播放器实例
const player = window.adScreenPlayer;

// 获取状态信息
const status = player.getStatus();

// 手动设置播放列表
player.modules.videoPlayer.setPlaylist(videos);

// 导出诊断报告
player.generateDiagnosticReport();
```

## 性能优化

### 视频优化
- 使用H.264编码，兼容性最佳
- 推荐分辨率：1080p或更低
- 文件大小控制在100MB以内

### 缓存优化
- 合理设置缓存大小限制
- 定期清理过期缓存
- 预加载策略根据网络状况调整

### 网络优化
- CDN加速视频分发
- MQTT连接使用WebSocket
- 支持断线重连和心跳检测

## 故障排除

### 常见问题

1. **视频无法播放**
   - 检查视频格式和编码
   - 验证网络连接
   - 查看浏览器控制台错误

2. **MQTT连接失败**
   - 检查服务器地址和端口
   - 验证用户名密码
   - 检查防火墙设置

3. **缓存不生效**
   - 检查浏览器IndexedDB支持
   - 验证缓存大小设置
   - 查看缓存统计信息

### 日志分析

使用性能面板或导出日志分析问题：

```javascript
// 在浏览器控制台中查看日志
console.log(window.adScreenPlayer.modules.monitor.getLogs());

// 导出详细报告
window.adScreenPlayer.generateDiagnosticReport();
```

## 部署建议

### 生产环境
- 使用HTTPS确保安全
- 配置CDN加速视频加载
- 设置合适的缓存策略
- 监控系统性能和稳定性

### 安全考虑
- MQTT使用TLS加密
- 视频内容进行权限控制
- 定期更新系统和依赖

## 版本信息

- **v1.1.0**：图片显示优化和稳定性增强
  - ✅ 修复图片重复加载和重新下载问题
  - ✅ 解决页面刷新后图片加载失败问题
  - ✅ 修复视频到图片切换时的格式检测错误
  - ✅ 增强Blob URL验证和缓存管理
  - ✅ 添加自动重试机制和错误处理

- **v1.0.0**：OpenHarmony设备管理平台
  - ✅ MQTT客户端连接和设备通信
  - ✅ 视频播放器支持多种格式
  - ✅ 文件分发系统(支持图片和视频)
  - ✅ 响应式UI设计
  - ✅ 设备状态监控
  - ✅ 修复视频加载动画持续显示问题
  - ✅ 修复图片文件分发失败问题
  - ✅ 优化消息去重机制
  - ✅ 增强文件格式检测

## 技术支持

如有问题或建议，请联系开发团队或提交Issue。

---

**注意**：本项目为演示版本，生产环境请进行充分测试和优化。