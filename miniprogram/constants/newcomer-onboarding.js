const ONBOARDING_STATE_VERSION = 1;
const ONBOARDING_STORAGE_PREFIX = 'easy-clean-newcomer-onboarding';
const STEP_STATUS = {
  UPCOMING: 'upcoming',
  CURRENT: 'current',
  COMPLETED: 'completed',
};

const ORDER_STATUSES = [
  { key: 'PENDING_DEPOSIT', label: '待存衣', description: '可在订单详情开柜存衣；订单尚未投放时可取消。' },
  { key: 'WAITING_PICKUP', label: '待取件', description: '衣物已存入，等待工作人员取件；订单详情提供取消操作。' },
  { key: 'WASHING', label: '洗护中', description: '衣物正在洗护；订单详情提供取消操作，也可查看进度和费用信息。' },
  { key: 'WAITING_RETURN', label: '待返柜', description: '洗护已完成，等待衣物返柜；请查看订单详情。' },
  { key: 'WAITING_PAYMENT_PICKUP', label: '待付款取衣', description: '衣物已返柜，先在详情完成付款，再按取衣操作扫码开柜。' },
  { key: 'COMPLETED', label: '已完成', description: '订单已完成；符合页面条件时可在详情申请返洗。' },
  { key: 'CANCELLED', label: '已取消', description: '订单已取消；是否还能取出衣物以详情页显示的取出操作为准。' },
  { key: 'REWASHING', label: '返洗中', description: '返洗申请已进入返洗流程；按订单详情查看后续存衣操作。' },
  { key: 'EXCEPTION', label: '异常待处理', description: '订单存在异常，请查看详情中的提示或联系客服。' },
];

const ORDER_STATUS_ALIASES = {
  CREATED: 'PENDING_DEPOSIT',
  CLEANING: 'WASHING',
  PENDING_PICKUP: 'WAITING_PICKUP',
  READY: 'WAITING_PAYMENT_PICKUP',
  COMPLETED: 'COMPLETED',
};

const ONBOARDING_STEPS = [
  {
    key: 'place-order',
    status: STEP_STATUS.UPCOMING,
    title: '下单',
    description: '选择衣物和洗护服务，确认订单后再前往柜机存衣。',
    paragraphs: ['在首页进入下单，选择衣物、服务项目和投放柜机；在确认订单页核对内容并提交，随后按订单详情开柜存衣。'],
    action: { type: 'navigate', label: '开始下单', route: '/pages/order-create/index' },
  },
  {
    key: 'order-status',
    status: STEP_STATUS.UPCOMING,
    title: '查看订单',
    description: '通过一份静态演示订单了解订单详情，不会读取真实订单。',
    paragraphs: ['演示页展示订单编号、门店、柜机、备注、取衣凭证、费用和时间。页面中的订单数据均为虚构内容。'],
    action: { type: 'navigate', label: '查看演示订单', route: '/pages/newcomer-order-demo/index' },
  },
  {
    key: 'order-statuses',
    status: STEP_STATUS.UPCOMING,
    title: '看懂订单状态',
    description: '订单状态会随履约进度更新，以下内容用于了解状态名称。',
    paragraphs: ['此处仅介绍状态含义，不会请求或修改真实订单。'],
    items: ORDER_STATUSES.map(({ key, label, description }) => ({ key, label, description })),
    action: { type: 'navigate', label: '查看状态', route: '/pages/newcomer-order-demo/index' },
  },
  {
    key: 'pickup',
    status: STEP_STATUS.UPCOMING,
    title: '取衣',
    description: '未付款时先完成支付；付款后使用取衣码或订单详情的扫码取衣操作。',
    paragraphs: ['订单详情会显示取衣码（如有）和“取衣开柜”按钮；扫码后按提示确认开柜并取衣。取消订单后的取出操作仅在详情明确显示时可用。'],
    action: { type: 'navigate', label: '查看取衣演示', route: '/pages/newcomer-order-demo/index' },
  },
  {
    key: 'rewash',
    status: STEP_STATUS.UPCOMING,
    title: '返洗',
    description: '仅订单详情显示“申请返洗”且尚未提交返洗时可申请。',
    paragraphs: ['从订单列表进入订单详情后提交返洗申请，填写原因、选择有效柜机并上传1至3张问题照片。提交申请不等于已批准；批准后按订单详情提示重新存衣并返洗，已提交的申请不能重复提交。'],
    action: { type: 'navigate', label: '查看订单演示', route: '/pages/newcomer-order-demo/index' },
  },
];

module.exports = {
  ONBOARDING_STATE_VERSION,
  ONBOARDING_STORAGE_PREFIX,
  ONBOARDING_STEPS,
  ORDER_STATUSES,
  ORDER_STATUS_ALIASES,
  STEP_STATUS,
};
