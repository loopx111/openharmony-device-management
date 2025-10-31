<template>
	<view class="container">
		<!-- 视频播放器区域 -->
		<view class="video-container" v-if="currentVideo">
			<video 
				:id="videoId"
				:src="currentVideo.url" 
				:autoplay="config.player.autoPlay"
				:muted="config.player.muted"
				:loop="config.player.loopPlaylist"
				controls
				@play="onVideoPlay"
				@pause="onVideoPause"
				@ended="onVideoEnded"
				@error="onVideoError"
				class="video-player">
			</video>
			
			<!-- 加载动画 -->
			<view class="loading" v-if="isLoading">
				<text>加载中...</text>
			</view>
		</view>
		
		<!-- 网络状态显示 -->
		<view class="network-status" v-if="config.ui.showNetworkStatus">
			<text :class="networkStatusClass">{{ networkStatusText }}</text>
		</view>
	</view>
</template>

<script>
import config from '../config.json'

export default {
	data() {
		return {
			config: config,
			currentVideo: null,
			videoList: [],
			isLoading: false,
			networkStatus: 'online',
			videoId: 'mainVideo'
		}
	},
	
	computed: {
		networkStatusText() {
			return this.networkStatus === 'online' ? '在线' : '离线'
		},
		networkStatusClass() {
			return this.networkStatus === 'online' ? 'status-online' : 'status-offline'
		}
	},
	
	onLoad() {
		this.initApp()
	},
	
	methods: {
		initApp() {
			// 设置全屏
			uni.setNavigationBarTitle({
				title: '广告屏播放器'
			})
			
			// 初始化视频列表
			this.loadVideoList()
			
			// 监听网络状态
			this.setupNetworkListener()
		},
		
		loadVideoList() {
			// 这里可以加载远程视频列表或本地视频
			this.videoList = [
				{ url: '../../static/test.mp4', title: '测试视频' }
			]
			
			if (this.videoList.length > 0) {
				this.currentVideo = this.videoList[0]
				this.playCurrentVideo()
			}
		},
		
		playCurrentVideo() {
			this.isLoading = true
			const videoContext = uni.createVideoContext(this.videoId)
			
			setTimeout(() => {
				videoContext.play()
				this.isLoading = false
			}, 1000)
		},
		
		onVideoPlay() {
			console.log('视频开始播放')
			this.isLoading = false
		},
		
		onVideoPause() {
			console.log('视频暂停')
		},
		
		onVideoEnded() {
			console.log('视频播放结束')
			// 播放下一视频或循环播放
			if (this.config.player.loopPlaylist) {
				setTimeout(() => {
					this.playCurrentVideo()
				}, 2000)
			}
		},
		
		onVideoError(e) {
			console.error('视频播放错误:', e)
			this.isLoading = false
		},
		
		setupNetworkListener() {
			uni.onNetworkStatusChange((res) => {
				this.networkStatus = res.isConnected ? 'online' : 'offline'
			})
		}
	}
}
</script>

<style>
.container {
	width: 100vw;
	height: 100vh;
	background: #000000;
	position: relative;
}

.video-container {
	width: 100%;
	height: 100%;
	position: relative;
}

.video-player {
	width: 100%;
	height: 100%;
}

.loading {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	color: #ffffff;
	font-size: 16px;
}

.network-status {
	position: absolute;
	top: 10px;
	right: 10px;
	padding: 5px 10px;
	border-radius: 4px;
	font-size: 12px;
}

.status-online {
	background: rgba(76, 175, 80, 0.8);
	color: #ffffff;
}

.status-offline {
	background: rgba(244, 67, 54, 0.8);
	color: #ffffff;
}
</style>