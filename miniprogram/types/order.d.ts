export interface ClothingItem {
  id: string;
  name: string;
  serviceCategory: string;
  scope: string;
  description: string;
  images: string[];
  price: number;
  discount?: string;
  count: number;
}

export interface ClothingGroup {
  key: string;
  name: string;
  icon: string;
  tone: string;
  description: string;
  items: ClothingItem[];
  selectedCount?: number;
}

export interface OrderSummary {
  selectedCount: number;
  estimate: string;
}
