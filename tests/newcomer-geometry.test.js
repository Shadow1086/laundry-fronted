const assert = require('node:assert/strict');
const test = require('node:test');
const { spotlightLayout } = require('../miniprogram/utils/newcomer-geometry');
const viewport = { width: 320, height: 640 };

test('目标透明孔面积与四片遮罩恰好覆盖视口，无整屏拦截层', () => {
    const result = spotlightLayout({ left: 20, top: 100, width: 100, height: 48 }, viewport);
    assert.equal(result.placement, 'below');
    const maskArea = result.masks.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    assert.equal(maskArea + result.target.width * result.target.height, viewport.width * viewport.height);
    assert.equal(result.bubble.top, 160);
});

test('下方空间不足自动向上，超长说明仅正文滚动，按钮留在视口', () => {
    const result = spotlightLayout({ left: 250, top: 500, width: 70, height: 44 }, viewport, 3000);
    assert.equal(result.placement, 'above');
    assert.equal(result.bubble.top, 12);
    assert.equal(result.bubble.left, 12);
    assert.ok(result.bubble.left + result.bubble.width <= 308);
    assert.equal(result.bodyHeight + 120, result.bubble.height);
    assert.equal(result.arrowLeft + result.bubble.left, 285);
});

test('越界部分裁切，缺失、零尺寸、非数字、完全离屏目标绝不生成假框', () => {
    for (const target of [null, {}, { left: 0, top: 0, width: 0, height: 50 }, { left: NaN, top: 0, width: 30, height: 30 }, { left: 321, top: 20, width: 30, height: 30 }, { left: 20, top: -100, width: 30, height: 30 }]) {
        assert.equal(spotlightLayout(target, viewport), null);
    }
    const result = spotlightLayout({ left: -10, top: 20, width: 50, height: 44 }, viewport);
    assert.deepEqual(result.target, { left: 0, top: 20, width: 40, height: 44 });
    assert.equal(result.bubble.left, 12);
    assert.ok(result.arrowLeft >= 8);
});

test('无足够空间显示必要控件时拒绝错误布局', () => {
    assert.equal(spotlightLayout({ left: 10, top: 10, width: 300, height: 620 }, viewport), null);
});
