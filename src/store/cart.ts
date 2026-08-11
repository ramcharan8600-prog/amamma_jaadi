'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CartItem, Product, FulfillmentDetails } from '@/types';
import { calculateSweetPrice, getTotalPieces } from '@/data/products';

interface CartState {
  items: CartItem[];
  fulfillment: FulfillmentDetails | null;

  // Actions
  addItem: (
    product: Product,
    quantity: number,
    selectedTier?: number,
    selectedVariant?: string
  ) => void;
  removeItem: (productId: string, selectedTier?: number, selectedVariant?: string) => void;
  updateQuantity: (
    productId: string,
    quantity: number,
    selectedTier?: number,
    selectedVariant?: string
  ) => void;
  clearCart: () => void;
  setFulfillment: (details: FulfillmentDetails) => void;

  // Computed
  getItemCount: () => number;
  getSubtotal: () => number;
  getTotalPieces: () => number;
  isLargeOrder: () => boolean;
}

function computeLineTotal(product: Product, quantity: number, selectedTier?: number): number {
  if (product.category === 'sweets' && selectedTier) {
    return calculateSweetPrice(product.unitPrice, selectedTier) * quantity;
  }
  return product.unitPrice * quantity;
}

/**
 * Unique key for a cart line: product + tier + variant.
 * Two gift boxes with different contents are separate lines, not merged.
 */
function lineKey(productId: string, selectedTier?: number, selectedVariant?: string): string {
  return [productId, selectedTier ?? '', selectedVariant ?? ''].join('__');
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      fulfillment: null,

      addItem: (product, quantity, selectedTier, selectedVariant) => {
        set((state) => {
          const key = lineKey(product.id, selectedTier, selectedVariant);
          const existing = state.items.find(
            (i) => lineKey(i.productId, i.selectedTier, i.selectedVariant) === key
          );

          if (existing) {
            return {
              items: state.items.map((i) =>
                lineKey(i.productId, i.selectedTier, i.selectedVariant) === key
                  ? {
                      ...i,
                      quantity: i.quantity + quantity,
                      lineTotal: computeLineTotal(product, i.quantity + quantity, selectedTier),
                    }
                  : i
              ),
            };
          }

          return {
            items: [
              ...state.items,
              {
                productId: product.id,
                product,
                quantity,
                selectedTier,
                selectedVariant,
                lineTotal: computeLineTotal(product, quantity, selectedTier),
              },
            ],
          };
        });
      },

      removeItem: (productId, selectedTier, selectedVariant) => {
        set((state) => ({
          items: state.items.filter(
            (i) =>
              lineKey(i.productId, i.selectedTier, i.selectedVariant) !==
              lineKey(productId, selectedTier, selectedVariant)
          ),
        }));
      },

      updateQuantity: (productId, quantity, selectedTier, selectedVariant) => {
        if (quantity <= 0) {
          get().removeItem(productId, selectedTier, selectedVariant);
          return;
        }
        set((state) => ({
          items: state.items.map((i) =>
            lineKey(i.productId, i.selectedTier, i.selectedVariant) ===
            lineKey(productId, selectedTier, selectedVariant)
              ? {
                  ...i,
                  quantity,
                  lineTotal: computeLineTotal(i.product, quantity, selectedTier),
                }
              : i
          ),
        }));
      },

      clearCart: () => set({ items: [], fulfillment: null }),

      setFulfillment: (details) => set({ fulfillment: details }),

      getItemCount: () =>
        get().items.reduce((sum, i) => sum + i.quantity, 0),

      getSubtotal: () =>
        get().items.reduce((sum, i) => sum + i.lineTotal, 0),

      getTotalPieces: () => getTotalPieces(get().items),

      isLargeOrder: () => getTotalPieces(get().items) > 150,
    }),
    {
      name: 'amamma-jaadi-cart',
      partialize: (state) => ({ items: state.items }),
    }
  )
);
