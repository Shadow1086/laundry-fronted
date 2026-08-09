// 订单领域服务：维护衣物分类、数量计算和下单视图模型。
// 页面只消费这里的结果，不直接拼装价格或筛选已选衣物。
const CLOTHING_GROUPS = [
  {
    key: 'tops', name: '上装', icon: '衣', tone: 'tone-blue', description: 'T恤、衬衫、外套',
    items: [
      {
        id: 'daily-top',
        name: '日常上衣',
        serviceCategory: '单衣小件类',
        scope: 'T恤、衬衣、背心、卫衣（不含绒）、马甲、围巾及小配饰',
        description: '同意水洗、机洗，无内衬垫肩，轻柔洗护',
        images: [],
        price: 18,
        discount: '9',
        count: 0,
      },
      {
        id: 'shirt',
        name: '衬衫',
        serviceCategory: '衬衫精洗类',
        scope: '棉质衬衫、商务衬衫、休闲衬衫及长短袖衬衣',
        description: '领口、袖口重点去渍，清洗后整形熨烫',
        images: [],
        price: 20,
        discount: '9',
        count: 0,
      },
      {
        id: 'coat',
        name: '外套',
        serviceCategory: '日常外套类',
        scope: '夹克、风衣、休闲外套、薄棉服及常规短款外衣',
        description: '根据面料分类洗护，减少缩水并保持版型',
        images: [],
        price: 32,
        discount: '9',
        count: 0,
      },
    ],
  },
  {
    key: 'bottoms', name: '下装', icon: '裤', tone: 'tone-sand', description: '裤装、裙装、牛仔',
    items: [
      {
        id: 'trousers',
        name: '裤装',
        serviceCategory: '日常裤装类',
        scope: '休闲裤、西裤、运动裤、短裤及无特殊装饰裤装',
        description: '分类清洗，清爽去味，洗后整理裤线',
        images: [],
        price: 22,
        discount: '9',
        count: 0,
      },
      {
        id: 'skirt',
        name: '半身裙',
        serviceCategory: '裙装类',
        scope: '半身裙、短裙、百褶裙及常规无复杂装饰裙装',
        description: '按面料选用洗护方式，保护纹理与裙型',
        images: [],
        price: 24,
        discount: '9',
        count: 0,
      },
      {
        id: 'jeans',
        name: '牛仔裤',
        serviceCategory: '牛仔类',
        scope: '长短款牛仔裤、牛仔背带裤及常规牛仔下装',
        description: '单独分类洗涤并进行锁色护理，降低褪色风险',
        images: [],
        price: 26,
        discount: '9',
        count: 0,
      },
    ],
  },
  {
    key: 'home-textile', name: '家居 / 床品', icon: '家', tone: 'tone-lilac', description: '床单、被套、家居用品',
    items: [
      {
        id: 'bedding',
        name: '床品 / 家居',
        serviceCategory: '家居织物类',
        scope: '床单、被套、毛毯、沙发巾及可水洗家居织物',
        description: '大件分类清洁，充分漂洗并进行蓬松护理',
        images: [],
        price: 36,
        discount: '85',
        count: 0,
      },
      {
        id: 'four-piece',
        name: '四件套',
        serviceCategory: '床品套件类',
        scope: '床单、被套及两个枕套组成的标准四件套',
        description: '整套分类洗护，洁净除味，洗后平整收纳',
        images: [],
        price: 58,
        discount: '85',
        count: 0,
      },
    ],
  },
  {
    key: 'shoes', name: '鞋类护理', icon: '鞋', tone: 'tone-green', description: '运动鞋、皮鞋、靴子',
    items: [
      {
        id: 'sneakers',
        name: '运动鞋',
        serviceCategory: '运动休闲鞋类',
        scope: '运动鞋、帆布鞋、休闲鞋及常规织物鞋面鞋款',
        description: '鞋面、鞋底分区清洁，除菌去味并自然整形',
        images: [],
        price: 29,
        discount: '9',
        count: 0,
      },
      {
        id: 'leather-shoes',
        name: '皮鞋',
        serviceCategory: '皮鞋护理类',
        scope: '常规光面皮鞋、商务皮鞋及低帮皮质休闲鞋',
        description: '清洁皮面污渍，进行基础养护并恢复光泽',
        images: [],
        price: 35,
        discount: '9',
        count: 0,
      },
      {
        id: 'boots',
        name: '靴子',
        serviceCategory: '长短靴类',
        scope: '短靴、中筒靴、长筒靴及常规皮质或织物靴款',
        description: '分材质专业护理，清洁后进行筒身定型',
        images: [],
        price: 45,
        discount: '9',
        count: 0,
      },
    ],
  },
];

function cloneGroups() {
  return CLOTHING_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, images: [...(item.images || [])] })),
  }));
}

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
  const resolvedActive = clothingGroups.some((group) => group.key === activeGroupKey)
    ? activeGroupKey
    : clothingGroups[0].key;
  const activeGroup = clothingGroups.find((group) => group.key === resolvedActive);
  return {
    clothingGroups,
    activeGroupKey: resolvedActive,
    activeGroup,
    selectedItems,
    selectedCount,
    estimate: total.toFixed(2),
  };
}

function getInitialOrderState() {
  return summarizeClothing(cloneGroups(), CLOTHING_GROUPS[0].key);
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
  getInitialOrderState,
  removeItem,
  summarizeClothing,
};
