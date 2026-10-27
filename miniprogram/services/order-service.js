const catalogApi = require('../api/catalog');

const TONES = ['tone-blue', 'tone-sand', 'tone-lilac', 'tone-green', 'tone-coral'];
const GROUP_ICONS = [
  '/assets/icons/shirt.svg',
  '/assets/icons/footprints.svg',
  '/assets/icons/bed-double.svg',
  '/assets/icons/footprints.svg',
];

function summarizeClothing(groups, activeGroupKey) {
  let selectedCount = 0;
  let total = 0;
  const selectedItems = [];
  const clothingGroups = groups.map((group) => {
    let groupSelectedCount = 0;
    const items = group.items.map((item) => {
      const count = Math.max(0, Number(item.count) || 0);
      groupSelectedCount += count;
      selectedCount += count;
      total += Number(item.price) * count;
      if (count > 0) {
        selectedItems.push({ ...item, count, tone: group.tone, icon: group.icon, categoryName: group.name });
      }
      return { ...item, count };
    });
    return {
      ...group,
      items,
      selectedCount: groupSelectedCount,
      selectedLabel: groupSelectedCount > 0 ? `${groupSelectedCount} 件` : '',
    };
  });
  const resolvedActive = clothingGroups.length && clothingGroups.some((group) => group.key === activeGroupKey)
    ? activeGroupKey
    : (clothingGroups[0] ? clothingGroups[0].key : '');
  const activeGroup = resolvedActive ? clothingGroups.find((group) => group.key === resolvedActive) : null;
  return {
    clothingGroups,
    activeGroupKey: resolvedActive,
    activeGroup,
    selectedItems,
    selectedCount,
    estimate: total.toFixed(2),
  };
}

function discountLabel(rate) {
  if (!rate || Number(rate) >= 1) return '';
  const d = Number(rate) * 10;
  return d % 1 === 0 ? String(Math.round(d)) : String(d);
}

function adaptItem(raw) {
  const basePrice = raw.basePrice === null || raw.basePrice === undefined ? 0 : Number(raw.basePrice);
  const memberPrice = raw.memberPrice === null || raw.memberPrice === undefined ? null : Number(raw.memberPrice);
  const rawImages = Array.isArray(raw.imageUrl)
    ? raw.imageUrl
    : (Array.isArray(raw.imageUrls) ? raw.imageUrls : [raw.imageUrl]);
  const imageUrls = rawImages.filter(Boolean).slice(0, 3);
  return {
    id: String(raw.id),
    name: raw.categoryName || '',
    imageUrl: imageUrls[0] || '',
    imageUrls,
    hasThreeImages: imageUrls.length === 3,
    comment: raw.comment || '',
    unitName: raw.unitName || '件',
    price: Number.isFinite(basePrice) ? basePrice : 0,
    memberPrice: Number.isFinite(memberPrice) ? memberPrice : null,
    hasMemberPrice: Number.isFinite(memberPrice),
    discount: discountLabel(raw.memberDiscountRate),
    count: 0,
  };
}

function adaptGroups(rawList) {
  return rawList.map((group, i) => ({
    key: group.categoryCode || String(group.id),
    name: group.categoryName || '',
    icon: GROUP_ICONS[i % GROUP_ICONS.length],
    tone: TONES[i % TONES.length],
    description: (group.children || []).map((c) => c.categoryName).join('、'),
    items: (group.children || []).map(adaptItem),
  }));
}

async function loadClothingGroups() {
  const rawList = await catalogApi.getCategories();
  return adaptGroups(Array.isArray(rawList) ? rawList : []);
}

function changeItemCount(groups, id, delta) {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => (
      item.id === id ? { ...item, count: Math.max(0, (Number(item.count) || 0) + delta) } : { ...item }
    )),
  }));
}

function removeItem(groups, id) {
  return changeItemCount(groups, id, -9999);
}

module.exports = {
  changeItemCount,
  loadClothingGroups,
  removeItem,
  summarizeClothing,
};
