function textObject(content, x, y, width, height, fontSize, fontStyle = 0) {
  return { AntiColor: false, X: x, Y: y, Width: width, Height: height,
    Content: String(content || ''), FontName: '黑体', FontStyle: fontStyle,
    Align: 1, FontSize: fontSize, AutoReturn: false, Format: 'TEXT',
    X1: x, Y1: y, Orientation: 0 };
}

export function buildTemplate(data, deviceName) {
  const remark = printableRemark(data.remark);
  if (Array.isArray(data.template) && data.template.length) {
    return data.template.map((item) => ({
      ...item,
      DeviceSn: deviceName,
      DrawObjects: Array.isArray(item.DrawObjects)
        ? item.DrawObjects.map((object) => {
          if (object.Content === '订单编号：') return { ...object, Content: '订单备注：' };
          if (object.Content === data.orderNo) return { ...object, Content: remark };
          return object;
        })
        : item.DrawObjects,
    }));
  }
  return [{ Width: 60, Height: 40, Rotate: 2, Copies: Number(data.copies || 1),
    Density: 4, HorizontalNum: 0, VerticalNum: 0, PaperType: 1, Gap: 3,
    DeviceSn: deviceName, CutType: 2, SavePaper: false, FirstCut: 0, Margin: 1,
    Speed: 30, Direction: 1, DrawObjects: [
      textObject('用户手机号', 2, 1, 22, 4, 3, 2), textObject(data.userPhone || '-', 2, 5, 22, 3, 3),
      { ...textObject(data.miniProgramCodeUrl || '', 2, 9, 26, 26, 2), Format: 'IMAGE' },
      textObject(data.barcodeValue || '', 2, 35, 26, 3, 2),
      textObject('门店名称：', 30, 1, 28, 4, 3, 2),
      textObject(data.storeName || '-', 30, 5, 28, 3, 3), textObject('柜机名称：', 30, 11, 28, 4, 3, 2),
      textObject(data.cabinetName || '-', 30, 15, 28, 3, 3), textObject('订单备注：', 30, 21, 28, 4, 3, 2),
      textObject(remark, 30, 25, 28, 3, 2), textObject('洗护衣类：', 30, 30, 28, 4, 3, 2),
      textObject(data.itemSummary || '-', 30, 34, 28, 3, 2),
    ] }];
}

export function printableRemark(value) {
  const remark = String(value || '').trim();
  if (!remark) return '-';
  return remark.length > 14 ? `${remark.slice(0, 13)}…` : remark;
}
