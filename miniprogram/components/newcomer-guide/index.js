const { spotlightLayout, rectStyle } = require('../../utils/newcomer-geometry');

Component({
    properties: {
        visible: { type: Boolean, value: false },
        userKey: { type: String, value: '' },
        step: { type: Object, value: null },
        target: { type: Object, value: null },
        progress: { type: String, value: '' },
        canPrevious: { type: Boolean, value: false },
        lastStep: { type: Boolean, value: false },
    },
    data: { layout: null, masks: [], targetStyle: '', bubbleStyle: '', bodyHeight: 108 },
    observers: {
        'visible, userKey, step, target, progress': function () {
            const identity = JSON.stringify([this.data.visible, this.data.userKey, this.data.step, this.data.progress]);
            if (identity !== this.presentationIdentity) {
                this.presentationIdentity = identity;
                this.actionPending = false;
            }
            this.updateLayout();
        },
    },
    lifetimes: {
        attached() { this.detached = false; },
        ready() { this.updateLayout(); },
        detached() { this.detached = true; this.layoutRevision = (this.layoutRevision || 0) + 1; },
    },
    pageLifetimes: {
        resize() { this.updateLayout(); },
    },
    methods: {
        preventTouchMove() {},
        updateLayout() {
            const revision = this.layoutRevision = (this.layoutRevision || 0) + 1;
            if (this.detached) return;
            if (!this.data.visible) {
                this.setData({ layout: null });
                return;
            }
            let windowInfo;
            try {
                windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
            } catch (error) {
                this.setData({ layout: null });
                this.triggerEvent('targetmissing', { reason: 'viewport' });
                return;
            }
            const viewport = { width: windowInfo.windowWidth, height: windowInfo.windowHeight };
            const layout = spotlightLayout(this.data.target, viewport);
            if (!layout) {
                this.setData({ layout: null });
                this.triggerEvent('targetmissing', { reason: 'target' });
                return;
            }
            this.applyLayout(layout, () => {
                if (this.detached || revision !== this.layoutRevision || !this.data.visible) return;
                const query = this.createSelectorQuery();
                query.select('.guide-body').boundingClientRect();
                query.exec((results) => {
                    if (this.detached || revision !== this.layoutRevision || !this.data.visible) return;
                    const body = results && results[0];
                    if (!body || !Number.isFinite(body.height)) return;
                    const measured = spotlightLayout(this.data.target, viewport, Math.max(188, body.height + 120));
                    if (measured) this.applyLayout(measured);
                });
            });
        },
        applyLayout(layout, callback) {
            this.setData({
                layout,
                masks: layout.masks.map(rectStyle),
                targetStyle: rectStyle(layout.target),
                bubbleStyle: rectStyle(layout.bubble),
                bodyHeight: layout.bodyHeight,
            }, callback);
        },
        dispatchAction(name, detail = {}) {
            if (!this.data.visible || !this.data.layout || this.actionPending || this.detached) return;
            this.actionPending = true;
            this.triggerEvent(name, detail);
        },
        close() { this.dispatchAction('dismiss', { action: 'close' }); },
        previousStep() {
            if (this.data.canPrevious) this.dispatchAction('previous');
        },
        nextStep() {
            if (this.data.lastStep) this.dispatchAction('dismiss', { action: 'complete' });
            else this.dispatchAction('next');
        },
    },
});
