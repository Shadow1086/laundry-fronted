const authService = require('../../services/auth-service');
const orderApi = require('../../api/order');
const deviceCommandApi = require('../../api/device-command');
const cabinetService = require('../../services/cabinet-service');
const errorUtil = require('../../utils/error');
const locationService = require('../../services/location-service');
const doorConfirmation = require('../../services/door-confirmation');

const PICKUP_ORDER_STATUSES = new Set(['WAITING_PAYMENT_PICKUP']);
const DELIVERY_CODE_PATTERN = /^[A-Z0-9]{4}$/;

function normalizeStage(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function isRewashDepositOrder(item) {
  const status = String(item.orderStatus || item.status || '').toUpperCase();
  const internalStage = normalizeStage(item.internalStage);
  const rewashStatus = String(item.rewashStatus || item.rewashApprovalStatus || '').toUpperCase();
  const hasRewashMarker = item.isRewash === true
    || item.rewash === true
    || item.rewashApproved === true
    || rewashStatus === 'APPROVED'
    || Number(item.rewashRound) >= 1
    || item.rewashRequest !== null && item.rewashRequest !== undefined;
  return (status === 'REWASHING' && internalStage === 'REWASHAPPROVED')
    || (status === 'PENDING_DEPOSIT' && internalStage === 'CREATED' && hasRewashMarker);
}

function isPickupOrder(item, preferredOrderId) {
  const status = String(item.orderStatus || item.status || '').toUpperCase();
  const internalStage = normalizeStage(item.internalStage);
  if (isRewashDepositOrder(item)) return true;
  if (PICKUP_ORDER_STATUSES.has(status)) return true;
  // 取消订单只能从对应订单详情进入，不能通过主页的通用取衣入口操作。
  const orderId = String(item.orderId ?? item.id ?? '');
  return status === 'CANCELLED'
    && orderId === String(preferredOrderId || '')
    && internalStage === 'CANCELLEDWAITINGUSERPICKUP';
}

function normalizePaymentStatus(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function isPaidStatus(value) {
  return [
    'PAID',
    'SUCCESS',
    'SUCCEEDED',
    'SUCCESSFUL',
    'COMPLETED',
    'PAYMENTSUCCESS',
    'TRADESUCCESS',
  ].includes(normalizePaymentStatus(value));
}

function getDirectPaidState(item) {
  const payment = item && (item.payment || item.latestPayment);
  const status = item && (
    item.paymentStatus
    || item.payStatus
    || item.payment_state
    || item.payment_state_name
    || (payment && (payment.paymentStatus || payment.transactionStatus || payment.status))
  );
  if (status !== undefined && status !== null && status !== '') return isPaidStatus(status);
  if (item && typeof item.paid === 'boolean') return item.paid;
  if (item && typeof item.isPaid === 'boolean') return item.isPaid;
  return undefined;
}

function getCabinetOperationId(result) {
  let value = result;
  for (let depth = 0; depth < 3 && value && typeof value === 'object'; depth += 1) {
    const operationId = value.cabinetOperationId
      || value.cabinetOperationID
      || value.operationId
      || value.operationID
      || value.operation_id
      || value.id;
    if (operationId !== undefined && operationId !== null && operationId !== '') return String(operationId);
    value = value.data || value.result || value.operation || value.operationInfo;
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

Page({
  data: {
    preferredOrderId: '',
    pickupOrders: [],
    allPickupOrders: [],
    cabinetOptions: [{ id: '', name: '全部柜机', displayName: '全部柜机' }],
    selectedCabinetIndex: 0,
    selectedCabinetId: '',
    ordersLoading: true,
    deliveryCode: '',
    submittingKey: '',
    stage: 'ready',
    openedMode: 'pickup',
  },

  onLoad(options) {
    if (!authService.requireLogin()) return;
    const preferredOrderId = options.orderId && !['undefined', 'null'].includes(options.orderId)
      ? String(options.orderId)
      : '';
    this.setData({ preferredOrderId });
    this.loadPickupOrders();
  },

  async loadPickupOrders() {
    this.setData({ ordersLoading: true });
    try {
      const [result, cabinets] = await Promise.all([
        orderApi.getOrders({
          page: 1,
          pageSize: 100,
        }),
        cabinetService.loadStores().catch((error) => {
          console.warn('[scan-cabinet] cabinet locations unavailable', error);
          return [];
        }),
      ]);
      const records = Array.isArray(result) ? result : (result && (result.records || result.orders)) || [];
      const cabinetById = new Map((Array.isArray(cabinets) ? cabinets : [])
        .filter((cabinet) => cabinet && cabinet.id !== undefined && cabinet.id !== null)
        .map((cabinet) => [String(cabinet.id), cabinet]));
      const mappedOrders = await Promise.all(records
        .filter((item) => isPickupOrder(item, this.data.preferredOrderId))
        .map(async (item) => {
          const status = String(item.orderStatus || item.status || '').toUpperCase();
          const resolvedPaid = status === 'REWASHING'
            ? true
            : await this.resolvePaidStatus(item);
          const cabinetId = item.cabinetId ?? item.returnCabinetId ?? item.depositCabinetId;
          const cabinet = cabinetById.get(String(cabinetId));
          return this.adaptPickupOrder(
            cabinet ? { ...item, cabinet } : item,
            resolvedPaid,
          );
        }));
      const pickupOrders = mappedOrders
        .filter((item) => item.orderId)
        .sort((left, right) => (
          left.orderId === this.data.preferredOrderId ? -1 : right.orderId === this.data.preferredOrderId ? 1 : 0
        ));
      const cabinetOptions = this.buildCabinetOptions(pickupOrders);
      this.setData({
        allPickupOrders: pickupOrders,
        pickupOrders,
        cabinetOptions,
        selectedCabinetIndex: 0,
        selectedCabinetId: '',
      });
    } catch (error) {
      wx.showToast({ title: errorUtil.getMessage(error, '待取订单加载失败'), icon: 'none' });
    } finally {
      this.setData({ ordersLoading: false });
    }
  },

  buildCabinetOptions(orders) {
    const options = [{ id: '', name: '全部柜机', displayName: '全部柜机' }];
    const seen = new Set();
    (orders || []).forEach((order) => {
      const id = order.cabinetId ? String(order.cabinetId) : '';
      const name = String(order.cabinetName || '').trim();
      if (!id && !name) return;
      const key = id || `name:${name}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({ id, name: name || id, displayName: name || id });
    });
    return options;
  },

  selectCabinet(e) {
    const selectedCabinetIndex = Number(e.detail.value) || 0;
    const option = this.data.cabinetOptions[selectedCabinetIndex] || this.data.cabinetOptions[0];
    const pickupOrders = option.name === '全部柜机'
      ? this.data.allPickupOrders
      : this.data.allPickupOrders.filter((order) => (
        option.id
          ? String(order.cabinetId || '') === option.id
          : order.cabinetName === option.name
      ));
    this.setData({
      selectedCabinetIndex,
      selectedCabinetId: option.id,
      pickupOrders,
    });
  },

  async resolvePaidStatus(item) {
    const directPaidState = getDirectPaidState(item);
    if (directPaidState !== undefined) return directPaidState;

    const orderId = item && (item.orderId ?? item.id);
    if (orderId === undefined || orderId === null || orderId === '') return false;
    try {
      const payment = await orderApi.getLatestPayment(orderId);
      return getDirectPaidState(payment) === true
        || isPaidStatus(payment && (payment.transactionStatus || payment.paymentStatus || payment.status));
    } catch {
      return false;
    }
  },

  adaptPickupOrder(item, resolvedPaid) {
    const orderId = item.orderId ?? item.id;
    const deliveryCode = String(item.deliveryCode || '').trim().toUpperCase();
    const orderStatus = String(item.orderStatus || item.status || '').toUpperCase();
    const rewashDeposit = isRewashDepositOrder(item);
    const paymentStatus = normalizePaymentStatus(
      item.paymentStatus
      || item.payStatus
      || (item.payment && (item.payment.paymentStatus || item.payment.transactionStatus || item.payment.status)),
    );
    // 取消订单允许直接取回衣物，不应再要求支付。
    const paid = orderStatus === 'CANCELLED'
      || resolvedPaid === true
      || isPaidStatus(paymentStatus)
      || item.paid === true
      || item.isPaid === true;
    // `canOpen` 可能只是后端根据取货码生成结果计算出的展示字段，不能阻断本人已付款取衣。
    // 只有明确的取衣资格字段才参与流程判断。
    const pickupAvailable = item.canPickup ?? item.pickupAvailable;
    const canOpen = rewashDeposit || (
      paid
      && (pickupAvailable === undefined || (orderStatus === 'CANCELLED' ? paid : pickupAvailable === true))
    );
    return {
      orderId: orderId === undefined || orderId === null ? '' : String(orderId),
      orderNo: String(item.orderNo || ''),
      categoryDetail: String(item.categoryDetail || '').trim(),
      deliveryCode,
      cabinetName: item.cabinetName || item.storeName || '取衣柜机',
      cabinetId: item.cabinetId || '',
      requestedDepositSize: item.requestedDepositSize || item.cabinetType || 'small',
      cabinetType: item.cabinetType || item.requestedDepositSize || 'small',
      latitude: item.latitude ?? item.cabinetLatitude ?? (item.cabinet && item.cabinet.latitude),
      longitude: item.longitude ?? item.cabinetLongitude ?? (item.cabinet && item.cabinet.longitude),
      compartmentNo: item.returnCompartmentNo || item.compartmentNo || '',
      paymentStatus,
      orderStatus,
      paid,
      payableAmount: item.finalPayableAmount ?? item.payableAmount ?? item.amount ?? '',
      canOpen,
      isRewashDeposit: rewashDeposit,
      stateLabel: rewashDeposit ? '选择柜机并存衣' : (canOpen ? '可开门' : (paid ? '取货码生成中' : '需先付款')),
    };
  },

  inputDeliveryCode(e) {
    const deliveryCode = String(e.detail.value || '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 4)
      .toUpperCase();
    this.setData({ deliveryCode });
    return deliveryCode;
  },

  openOwnOrder(e) {
    const orderId = String(e.currentTarget.dataset.orderId || '');
    const order = this.data.pickupOrders.find((item) => item.orderId === orderId);
    this.handleOrderAction(order);
  },

  handleOrderAction(order) {
    if (!order || this.data.submittingKey) return;
    if (order.isRewashDeposit) {
      this.openRewashDeposit(order);
      return;
    }
    if (!order.paid) {
      this.payOrder(order);
      return;
    }
    this.openPaidOrder(order);
  },

  async openRewashDeposit(order) {
    if (!order || this.data.submittingKey) return;
    this.setData({ submittingKey: `rewash-${order.orderId}` });
    try {
      const stores = await cabinetService.loadStores();
      const availableStores = stores.filter((store) => store.id !== null && store.id !== undefined);
      if (!availableStores.length) throw new Error('暂无可用柜机，请稍后重试');
      const cabinetIndex = await new Promise((resolve, reject) => {
        wx.showActionSheet({
          itemList: availableStores.map((store) => `${store.name}${store.available ? `（空闲 ${store.available} 格）` : ''}`),
          success: ({ tapIndex }) => resolve(tapIndex),
          fail: reject,
        });
      });
      const cabinet = availableStores[cabinetIndex];
      const size = await new Promise((resolve, reject) => {
        wx.showActionSheet({
          itemList: ['小格口', '大格口'],
          success: ({ tapIndex }) => resolve(tapIndex === 1 ? 'LARGE' : 'SMALL'),
          fail: reject,
        });
      });
      const idempotencyKey = `rewash-deposit-${order.orderId}-${Date.now()}`;
      const result = await orderApi.prepareRewashDeposit(order.orderId, cabinet.id, size, idempotencyKey);
      const cabinetOperationId = getCabinetOperationId(result);
      if (!cabinetOperationId) {
        throw new Error('反洗开柜操作创建失败，请稍后重试');
      }
      await this.submitPickup(
        (location) => deviceCommandApi.sendDeviceCommand({
          orderId: order.orderId,
          ...location,
        }),
        `rewash-${order.orderId}`,
        { ...order, latitude: cabinet.latitude, longitude: cabinet.longitude },
        'deposit',
      );
    } catch (error) {
      wx.showToast({ title: errorUtil.getMessage(error, '反洗开柜失败，请稍后重试'), icon: 'none' });
      this.setData({ submittingKey: '' });
    }
  },

  openPaidOrder(order) {
    this.submitPickup(
      (location) => orderApi.pickUpOrder(order.orderId, order.deliveryCode, this.createIdempotencyKey(order.orderId), location),
      `order-${order.orderId}`,
      order,
    );
  },

  async payOrder(order) {
    if (!order || this.data.submittingKey) return;
    const submittingKey = `pay-${order.orderId}`;
    this.setData({ submittingKey });
    try {
      const payment = await orderApi.prepayOrder(order.orderId, this.createIdempotencyKey(order.orderId));
      if (!payment || !payment.timeStamp || !payment.nonceStr || !payment.package || !payment.paySign) {
        throw new Error('支付参数不完整，请稍后重试');
      }
      await new Promise((resolve, reject) => {
        wx.requestPayment({
          timeStamp: String(payment.timeStamp),
          nonceStr: payment.nonceStr,
          package: payment.package,
          signType: payment.signType || 'RSA',
          paySign: payment.paySign,
          success: resolve,
          fail: reject,
        });
      });
      let paymentConfirmed = false;
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const latestPayment = await orderApi.getLatestPayment(order.orderId);
          paymentConfirmed = getDirectPaidState(latestPayment) === true
            || isPaidStatus(latestPayment && (latestPayment.transactionStatus || latestPayment.paymentStatus || latestPayment.status));
          if (paymentConfirmed) break;
          await wait(500);
        }
      } catch (verificationError) {
        console.warn('[scan-cabinet] payment verification pending', verificationError);
      }
      if (!paymentConfirmed) {
        await this.loadPickupOrders();
        wx.showToast({ title: '支付成功，订单状态同步中，请稍后刷新', icon: 'none', duration: 2500 });
        return;
      }
      const paidOrder = {
        ...order,
        paid: true,
        paymentStatus: 'PAID',
        canOpen: true,
        stateLabel: '可开门',
      };
      this.setData({
        pickupOrders: this.data.pickupOrders.map((item) => item.orderId === order.orderId ? paidOrder : item),
      });
      wx.showModal({
        title: '支付成功',
        content: '是否现在前往开柜？',
        confirmText: '去开柜',
        cancelText: '稍后再说',
        success: ({ confirm }) => {
          if (confirm) this.openPaidOrder(paidOrder);
        },
      });
    } catch (error) {
      const message = error && /cancel/i.test(error.errMsg || '')
        ? '已取消支付'
        : errorUtil.getMessage(error, '支付失败，请重试');
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      this.setData({ submittingKey: '' });
    }
  },

  openWithDeliveryCode() {
    const deliveryCode = this.data.deliveryCode;
    if (this.data.submittingKey) return;
    if (!DELIVERY_CODE_PATTERN.test(deliveryCode)) {
      wx.showToast({ title: '请输入4位英数字取货码', icon: 'none' });
      return;
    }
    const order = this.data.pickupOrders.find((item) => item.deliveryCode === deliveryCode);
    if (!order) {
      wx.showToast({ title: '未找到对应订单，请刷新后重试', icon: 'none' });
      return;
    }
    if (!order.paid) return this.payOrder(order);
    if (!order.canOpen) {
      wx.showToast({ title: '取货码尚未生成', icon: 'none' });
      return;
    }
    this.submitPickup(
      (location) => orderApi.pickUpByDeliveryCode(
        order.orderId,
        deliveryCode,
        this.createIdempotencyKey(`code-${order.orderId}`),
        location,
      ),
      'delivery-code',
      order,
    );
  },

  createIdempotencyKey(target) {
    return `pickup-${target}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  },

  async submitPickup(requestPickup, submittingKey, order, openedMode = 'pickup') {
    this.setData({ submittingKey });
    try {
      let target = order;
      if (!cabinetService.isValidCoordinate(target.latitude, target.longitude) && target.cabinetId) {
        const cabinets = await cabinetService.loadStores();
        const cabinet = cabinets.find((item) => String(item.id) === String(target.cabinetId));
        if (cabinet) target = { ...target, latitude: cabinet.latitude, longitude: cabinet.longitude };
      }
      const locationCheck = await locationService.checkCurrentDistance(target);
      if (!locationCheck.allowed) {
        if (locationCheck.reason !== 'too-far') {
          throw new Error('柜机位置暂不可用，无法确认距离');
        }
        const shouldOpen = await new Promise((resolve) => {
          wx.showModal({
            title: '距离提示',
            content: `当前距离柜机约 ${Math.round(Number(locationCheck.distanceMeters))} 米，距离过远，请检查附近柜机并确认是否开柜。`,
            confirmText: '确认开柜',
            cancelText: '返回',
            success: ({ confirm }) => resolve(confirm),
            fail: () => resolve(false),
          });
        });
        if (!shouldOpen) return;
      }
      const outcome = await doorConfirmation.runDoorConfirmation({
        send: () => requestPickup({
          latitude: locationCheck.userLocation.latitude,
          longitude: locationCheck.userLocation.longitude,
        }),
        confirmOpened: (result) => openedMode === 'deposit'
          ? deviceCommandApi.confirmDepositOpened(order.orderId, result.cabinetOperationId)
          : orderApi.confirmPickupOpened(order.orderId, result.cabinetOperationId),
      });
      if (outcome === 'support') return;
      this.setData({ stage: 'opened', openedMode });
    } catch (error) {
      wx.showToast({ title: errorUtil.getMessage(error, '开柜失败，请稍后重试'), icon: 'none' });
    } finally {
      this.setData({ submittingKey: '' });
    }
  },

  goOrders() {
    wx.navigateTo({ url: '/pages/order-list/order-list?filter=active' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },
});
