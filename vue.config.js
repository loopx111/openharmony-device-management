const path = require('path')

module.exports = {
  configureWebpack: {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
        'static': path.resolve(__dirname, './static')
      }
    }
  },
  transpileDependencies: ['@dcloudio/uni-ui']
}