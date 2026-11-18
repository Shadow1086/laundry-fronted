// 百度地图微信小程序 AK 示例配置。
// 复制为 baidu-map.js 后，填入绑定当前小程序 AppID 的微信小程序 AK。
const ak = 'YOUR_BAIDU_MAP_WECHAT_AK';

module.exports = {
  ak: ak.indexOf('YOUR_') === 0 ? '' : ak,
  requestDomain: 'https://api.map.baidu.com',
};
