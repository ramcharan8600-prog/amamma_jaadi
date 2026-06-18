'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CartItem, Product, FulfillmentDetails } from '@/types';
import { calculateSweetPrice, getTotalPieces } from '@/data/products';

interface CartState {
  items: CartItem[];
  fulfillment: FulfillmentDetails | null;

  // Actions
  addItem: (product: Product, quantity: number, selectedTier?: number) => void;
  removeItem: (productId: string, selectedTier?: number) => void;
  updateQuantity: (productId: string, quantity: number, selectedTier?: number) => void;
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

/** Unique key for a cart line (product + tier combo) */
function lineKey(productId: string, selectedTier?: number): string {
  return selectedTier ? `${productId}__${selectedTier}` : productId;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      fulfillment: null,

      addItem: (product, quantity, selectedTier) => {
        set((state) => {
          const key = lineKey(product.id, selectedTier);
          const existing = state.items.find(
            (i) => lineKey(i.productId, i.selectedTier) === key
          );

          if (existing) {
            return {
              items: state.items.map((i) =>
                lineKey(i.productId, i.selectedTier) === key
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
                lineTotal: computeLineTotal(product, quantity, selectedTier),
              },
            ],
          };
        });
      },

      removeItem: (productId, selectedTier) => {
        set((state) => ({
          items: state.items.filter(
            (i) => lineKey(i.productId, i.selectedTier) !== lineKey(productId, selectedTier)
          ),
        }));
      },

      updateQuantity: (productId, quantity, selectedTier) => {
        if (quantity <= 0) {
          get().removeItem(productId, selectedTier);
          return;
        }
        set((state) => ({
          items: state.items.map((i) =>
            lineKey(i.productId, i.selectedTier) === lineKey(productId, selectedTier)
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
