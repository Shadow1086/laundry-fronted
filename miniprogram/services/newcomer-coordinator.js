const onboarding = require('./newcomer-onboarding-service');

// 保存在模块内，跨首页重建与账号切换生效，应用重新启动后自然清空。
const dismissedUsers = new Set();
const manualUserIds = new Map();
let manualUserSequence = 0;

function getManualUserId(token) {
    if (!manualUserIds.has(token)) {
        manualUserSequence += 1;
        manualUserIds.set(token, `manual-session-${Date.now()}-${manualUserSequence}`);
    }
    return manualUserIds.get(token);
}

function getGuideUser(user, token) {
    if (typeof token !== 'string' || !token.trim() || !user) return null;
    const accountType = Object.prototype.hasOwnProperty.call(user, 'onboardingAccountType')
        ? user.onboardingAccountType : user.accountType;
    if (accountType !== 'CUSTOMER') return null;
    return user;
}

function getManualGuideUser(user, token) {
    if (typeof token !== 'string' || !token.trim()) return null;
    const source = user && typeof user === 'object' ? user : {};
    const id = source.id || source.userId || source.accountId || getManualUserId(token);
    return { ...source, id, onboardingAccountType: 'CUSTOMER' };
}

function getStatus(user, token) {
    const guideUser = getGuideUser(user, token);
    return onboarding.getStatus(guideUser, {
        dismissedThisSession: dismissedUsers.has(onboarding.normalizeUserId(guideUser)),
    }, wx);
}

function dismiss(user, token, action, isManual) {
    const guideUser = isManual
        ? getManualGuideUser(user, token)
        : getGuideUser(user, token);
    if (!guideUser || !['skip', 'close', 'complete'].includes(action)) return null;
    const normalizedAction = action === 'skip' ? onboarding.ACTION.CLOSE : action;
    const result = onboarding.applyAction(guideUser, normalizedAction, wx);
    dismissedUsers.add(onboarding.normalizeUserId(guideUser));
    return result;
}

function getManualStatus(user, token) {
    const guideUser = getManualGuideUser(user, token);
    return onboarding.getStatus(guideUser, {
        dismissedThisSession: dismissedUsers.has(onboarding.normalizeUserId(guideUser)),
    }, wx);
}

module.exports = { getStatus, getManualStatus, getManualUserId, dismiss };
