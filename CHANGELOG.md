# 鸿蒙广告屏播放器 - 版本更新记录

## v1.2.0 (2024-01-XX)

### 新增功能
- ✅ **HBuilderX项目结构优化**：添加完整的uni-app项目配置文件
- ✅ **打包错误修复**：修复PNG文件签名错误和缓存冲突问题
- ✅ **权限配置优化**：简化Android权限配置，提升打包成功率

### 技术改进
- ✅ **项目配置**：添加main.js、vue.config.js、babel.config.js等配置文件
- ✅ **缓存清理**：创建HBuilderX缓存清理脚本
- ✅ **appid更新**：将appid更新为`__UNI__ADSCREENPLAYER001`避免冲突

### 文件变更
- 新增：`.hbuilderx/`目录（HBuilderX项目配置）
- 新增：`App.vue`、`main.js`、`vue.config.js`、`babel.config.js`
- 新增：`manifest.json`、`pages.json`、`uni.scss`
- 新增：`pages/index/index.vue`页面文件
- 新增：`clean-hbuilder-cache.bat`缓存清理脚本
- 修改：`package.json`依赖配置
- 删除：`test.mp4`测试文件

---

## v1.1.0 (2024-01-XX)

### 功能优化
- ✅ 图片显示优化和稳定性增强

---

## v1.0.0 (2024-01-XX)

### 初始版本
- ✅ 实现OpenHarmony设备管理平台基础功能