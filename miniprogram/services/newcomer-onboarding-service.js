const {
  ONBOARDING_STATE_VERSION,
  ONBOARDING_STORAGE_PREFIX,
  ONBOARDING_STEPS,
  ORDER_STATUSES,
  ORDER_STATUS_ALIASES,
  STEP_STATUS,
} = require('../constants/newcomer-onboarding');

const ACTION = {
  COMPLETE: 'complete',
  CLOSE: 'close',
};

function normalizeUserId(user) {
  if (!user || typeof user !== 'object') return '';
  const id = user.id || user.userId || user.accountId;
  if (typeof id === 'number' && !Number.isFinite(id)) return '';
  if (typeof id !== 'string' && typeof id !== 'number') return '';
  const normalized = String(id).trim();
  if (!normalized) return '';
  try {
    encodeURIComponent(normalized);
    return normalized;
  } catch (error) {
    return '';
  }
}

function isEligibleCustomer(user) {
  if (!user || typeof user !== 'object' || !normalizeUserId(user)) return false;
  if (Object.prototype.hasOwnProperty.call(user, 'onboardingAccountType')) {
    return user.onboardingAccountType === 'CUSTOMER';
  }
  return user.accountType === 'CUSTOMER';
}

function getStorageKey(user) {
  const userId = normalizeUserId(user);
  return userId ? `${ONBOARDING_STORAGE_PREFIX}:v${ONBOARDING_STATE_VERSION}:${encodeURIComponent(userId)}` : '';
}

function createDefaultState() {
  return {
    version: ONBOARDING_STATE_VERSION,
    completed: false,
  };
}

function parseState(value) {
  if (typeof value === 'string') {
    try {
      return parseState(JSON.parse(value));
    } catch (error) {
      return createDefaultState();
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createDefaultState();
  if (value.version !== ONBOARDING_STATE_VERSION) return createDefaultState();
  if (typeof value.completed !== 'boolean') {
    return createDefaultState();
  }
  return {
    version: ONBOARDING_STATE_VERSION,
    completed: value.completed,
  };
}

function readStorage(storage, key) {
  if (typeof storage.getStorageSync === 'function') return storage.getStorageSync(key);
  if (typeof storage.get === 'function') return storage.get(key, null);
  return undefined;
}

function writeStorage(storage, key, value) {
  if (typeof storage.setStorageSync === 'function') {
    storage.setStorageSync(key, value);
    return;
  }
  if (typeof storage.set === 'function') {
    storage.set(key, value);
  }
}

function loadState(user, storage) {
  return readState(user, storage).state;
}

function readState(user, storage) {
  const key = getStorageKey(user);
  if (!key || !isEligibleCustomer(user) || !storage
    || (typeof storage.getStorageSync !== 'function' && typeof storage.get !== 'function')) {
    return { state: createDefaultState(), storageAvailable: false };
  }
  try {
    return { state: parseState(readStorage(storage, key)), storageAvailable: true };
  } catch (error) {
    return { state: createDefaultState(), storageAvailable: false };
  }
}

function saveState(user, state, storage) {
  const key = getStorageKey(user);
  if (!key || !isEligibleCustomer(user) || !storage
    || (typeof storage.setStorageSync !== 'function' && typeof storage.set !== 'function')) {
    return false;
  }
  try {
    writeStorage(storage, key, parseState(state));
    return true;
  } catch (error) {
    return false;
  }
}

function applyAction(user, action, storage) {
  const state = loadState(user, storage);
  if (action === ACTION.CLOSE) {
    return { state, dismissedThisSession: true, persisted: false };
  }
  if (action !== ACTION.COMPLETE) {
    return { state, dismissedThisSession: false, persisted: false };
  }
  if (!isEligibleCustomer(user)) {
    return { state, dismissedThisSession: false, persisted: false };
  }
  const nextState = {
    ...state,
    completed: action === ACTION.COMPLETE ? true : state.completed,
  };
  const persisted = saveState(user, nextState, storage);
  return { state: nextState, dismissedThisSession: false, persisted };
}

function getStatus(user, session = {}, storage) {
  const eligible = isEligibleCustomer(user);
  const loaded = readState(user, storage);
  const state = loaded.state;
  const dismissedThisSession = Boolean(session) && session.dismissedThisSession === true;
  return {
    eligible,
    state,
    dismissedThisSession,
    storageAvailable: loaded.storageAvailable,
    shouldShow: eligible && loaded.storageAvailable && !state.completed && !dismissedThisSession,
  };
}

function getStepModels(currentStep = 0) {
  const activeIndex = Number.isInteger(currentStep)
    ? Math.min(Math.max(currentStep, 0), ONBOARDING_STEPS.length - 1)
    : 0;
  return ONBOARDING_STEPS.map((step, index) => ({
    ...step,
    status: index < activeIndex ? STEP_STATUS.COMPLETED
      : index === activeIndex ? STEP_STATUS.CURRENT : STEP_STATUS.UPCOMING,
    action: { ...step.action },
  }));
}

function normalizeOrderStatus(value) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  const key = ORDER_STATUS_ALIASES[upper] || upper;
  return ORDER_STATUSES.find((status) => status.key === key) || {
    key: 'UNKNOWN',
    label: '状态未知',
    description: '订单状态已更新，请查看订单详情。',
  };
}

module.exports = {
  ACTION,
  ONBOARDING_STEPS,
  ORDER_STATUSES,
  ORDER_STATUS_ALIASES,
  applyAction,
  createDefaultState,
  getStatus,
  getStepModels,
  getStorageKey,
  isEligibleCustomer,
  loadState,
  normalizeUserId,
  normalizeOrderStatus,
  saveState,
};
