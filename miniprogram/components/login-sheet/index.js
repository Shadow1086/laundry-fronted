const authService = require('../../services/auth-service');
const errorUtil = require('../../utils/error');

Component({
    properties: {
        visible: {
            type: Boolean,
            value: false,
            observer(visible) {
                if (visible) this.setData({ agreementAccepted: false, loginMessage: '', nickname: '' });
            },
        },
    },
    data: {
        agreementAccepted: false,
        loginLoading: false,
        loginMessage: '',
        nickname: '',
    },
    methods: {
        preventTouchMove() {},
        dismiss() {
            if (this.data.loginLoading) return;
            this.setData({ agreementAccepted: false, loginMessage: '', nickname: '' });
            this.triggerEvent('dismiss');
        },
        changeAgreement(e) {
            const agreementAccepted = e.detail.value.includes('agree');
            this.setData({ agreementAccepted, nickname: agreementAccepted ? this.data.nickname : '' });
        },
        openAgreement(e) {
            wx.navigateTo({ url: `/pages/legal/index?type=${e.currentTarget.dataset.type}` });
        },
        requestAgreement() {
            this.setData({ loginMessage: '请阅读并自行勾选同意用户服务协议和隐私政策' });
        },
        handlePhoneNumber(e) {
            if (!this.data.agreementAccepted) return this.requestAgreement();
            if (this.data.loginLoading) return;
            const detail = e.detail || {};
            if (!detail.code) {
                this.setData({ loginMessage: '未完成手机号授权，你可以继续浏览或重新登录' });
                return;
            }
            this.setData({ loginLoading: true, loginMessage: '' });
            wx.login({
                success: async (result) => {
                    try {
                        if (!result.code) throw new Error('微信登录失败，请重试');
                        const loginResult = await authService.login({
                            loginCode: result.code,
                            phoneCode: detail.code,
                            ...(this.data.nickname ? { nickname: this.data.nickname } : {}),
                        });
                        if (loginResult.nicknameSaved === false) {
                            wx.showToast({ title: '昵称暂未保存，可稍后在账号信息中修改', icon: 'none' });
                        }
                        this.setData({ loginLoading: false, agreementAccepted: false, nickname: '' });
                        this.triggerEvent('success', { user: loginResult.user, onboarding: loginResult.onboarding });
                    } catch (error) {
                        this.setData({ loginLoading: false, loginMessage: errorUtil.getMessage(error, '登录失败，请稍后再试') });
                    }
                },
                fail: () => this.setData({ loginLoading: false, loginMessage: '微信登录失败，请重试' }),
            });
        },
        handleNicknameInput(e) {
            this.setData({ nickname: String(e.detail.value || '').trim() });
        },
    },
});
