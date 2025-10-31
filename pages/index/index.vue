<template>
	<view>
		<web-view :src="webViewUrl" @message="onWebViewMessage"></web-view>
	</view>
</template>

<script>
export default {
	data() {
		return {
			webViewUrl: '../../static/index.html'
		}
	},
	
	onLoad() {
		// 设置全屏显示
		uni.setNavigationBarTitle({
			title: '广告屏播放器'
		});
		
		// 隐藏导航栏
		uni.hideNavigationBarLoading();
	},
	
	methods: {
		onWebViewMessage(e) {
			console.log('收到WebView消息:', e.detail.data);
		}
	}
}
</script>

<style>
/* 页面样式 */
page {
	width: 100vw;
	height: 100vh;
	background: #000000;
}

web-view {
	width: 100%;
	height: 100%;
}
</style>