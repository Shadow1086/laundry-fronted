// 百度地图微信小程序 AK。
// 请填入百度地图控制台中绑定当前小程序 AppID 的“微信小程序”类型 AK。
// 不要把后端 Web 服务 AK 放在这里，也不要把真实 AK 提交到公共仓库。
const ak = 'YOUR_BAIDU_MAP_WECHAT_AK';

module.exports = {
  ak: ak.indexOf('YOUR_') === 0 ? '' : ak,
  requestDomain: 'https://api.map.baidu.com',
};
