const MARGIN = 12;
const GAP = 12;

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function spotlightLayout(target, viewport, contentHeight = 280) {
    const { width, height } = viewport;
    if (!target || ![width, height, target.left, target.top, target.width, target.height].every(Number.isFinite)
        || width <= 0 || height <= 0 || target.width <= 0 || target.height <= 0) return null;
    const left = Math.max(0, target.left);
    const top = Math.max(0, target.top);
    const right = Math.min(width, target.left + target.width);
    const bottom = Math.min(height, target.top + target.height);
    if (right <= left || bottom <= top) return null;
    const above = top - GAP - MARGIN;
    const below = height - bottom - GAP - MARGIN;
    const placement = below >= Math.min(contentHeight, 280) || below >= above ? 'below' : 'above';
    const available = Math.max(0, placement === 'below' ? below : above);
    if (available < 188) return null;
    const bubbleWidth = Math.min(360, width - MARGIN * 2);
    const bubbleHeight = Math.min(contentHeight, available);
    const center = (left + right) / 2;
    const bubbleLeft = clamp(center - bubbleWidth / 2, MARGIN, width - MARGIN - bubbleWidth);
    return {
        target: { left, top, width: right - left, height: bottom - top },
        masks: [
            { left: 0, top: 0, width, height: top },
            { left: 0, top, width: left, height: bottom - top },
            { left: right, top, width: width - right, height: bottom - top },
            { left: 0, top: bottom, width, height: height - bottom },
        ],
        bubble: { left: bubbleLeft, top: placement === 'below' ? bottom + GAP : top - GAP - bubbleHeight, width: bubbleWidth, height: bubbleHeight },
        bodyHeight: Math.max(16, bubbleHeight - 120),
        arrowLeft: clamp(center - bubbleLeft, 8, bubbleWidth - 8),
        placement,
    };
}

function rectStyle(rect) {
    return `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
}

module.exports = { spotlightLayout, rectStyle };
