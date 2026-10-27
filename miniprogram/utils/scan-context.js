function decode(value) {
  try { return decodeURIComponent(value || ''); } catch (error) { return value || ''; }
}

function parseQuery(value) {
  const params = {};
  String(value || '').replace(/^[^?]*\?/, '').split(/[&#]/).forEach((part) => {
    if (!part) return;
    const pair = part.split('=');
    if (pair.length > 1) params[decode(pair[0])] = decode(pair.slice(1).join('='));
  });
  return params;
}

function parse(options) {
  const launch = options || {};
  // App 的 scene 是启动场景编号，码内参数位于 query.scene；Page 则直接接收 scene。
  const input = launch.query ? { ...launch.query } : launch;
  const source = decode(input.scene || input.q || '');
  const params = parseQuery(source);
  if (!input.scene && params.scene) return parse({ ...params, scene: params.scene });
  const cabinetSceneKey = input.cabinetSceneKey || params.cabinetSceneKey;
  if (cabinetSceneKey) return { type: 'cabinet-scene', value: String(cabinetSceneKey), params };
  const legacyCabinet = source.match(/^cabinet:\/\/scan\/([0-9A-Za-z_-]+)$/);
  if (legacyCabinet) return { type: 'cabinet-scene', value: legacyCabinet[1], params };
  if (source.startsWith('cabinet:')) {
    return { type: 'cabinet-scene', value: source.slice('cabinet:'.length), params };
  }
  const orderId = input.orderId || input.order_id || params.orderId || params.order_id
    || (params.type === 'order' ? params.id : '');
  const cabinetId = input.cabinetId || input.cabinets || input.cabinet_id || input.cabinet || params.cabinetId
    || params.cabinets || params.cabinet_id || params.cabinet || (params.type === 'cabinet' ? params.id : '');
  if (orderId) return { type: 'order', value: String(orderId), params };
  const explicitSceneKey = input.scanSceneKey || input.scan_scene_key || params.scanSceneKey || params.scan_scene_key;
  // 微信普通启动也可能带有数字 scene（例如 1001、1047），不能把它当成订单小程序码。
  // 订单小程序码使用后端生成的 24 位场景键，只有明确参数或足够长度的扫码场景才进入订单详情。
  if (cabinetId) return { type: 'cabinet', value: String(cabinetId), name: input.cabinetName || params.name || '', params };
  const scanSceneKey = explicitSceneKey || source;
  const looksLikeOrderScene = Boolean(explicitSceneKey)
    || (Boolean(input.q) && /^[0-9A-Za-z_-]{16,32}$/.test(String(source)) && !/^\d+$/.test(String(source)))
    || (Boolean(input.scene) && /^[0-9A-Za-z_-]{16,}$/.test(String(source)));
  if (looksLikeOrderScene) return { type: 'order-scene', value: String(scanSceneKey), params };
  return { type: '', value: '', params };
}

function parseScanResult(result) {
  const scan = result || {};
  // 小程序码的参数在 path 中，result 可能为空或是无法直接使用的原始内容。
  if (scan.path) {
    const context = parse(parseQuery(scan.path));
    if (context.type) return context;
  }
  return parse({ q: scan.result || '' });
}

function buildLaunchUrl(options) {
  const input = options || {};
  const path = String(input.path || '').replace(/^\//, '');
  if (!path) return '';
  const query = input.query || {};
  const pairs = Object.keys(query).filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`);
  if (input.scene) pairs.push(`scene=${encodeURIComponent(input.scene)}`);
  return `/${path}${pairs.length ? `?${pairs.join('&')}` : ''}`;
}

function resolvePendingLaunch(url, role) {
  const context = parse(parseQuery(url));
  if (context.type === 'order-scene' && !['manager', 'staff'].includes(role)) {
    return '/pages/home/index';
  }
  return url;
}

module.exports = { buildLaunchUrl, parse, parseScanResult, resolvePendingLaunch };
