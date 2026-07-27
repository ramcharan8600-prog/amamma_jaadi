'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ShoppingBag, Eye, CreditCard, Minus, Plus } from 'lucide-react';
import { Product } from '@/types';
import { useCartStore } from '@/store/cart';
import { useStock } from '@/hooks/useStock';
import { formatCurrency } from '@/lib/utils';

interface PickleCardProps {
  product: Product;
}

export default function PickleCard({ product }: PickleCardProps) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const addItem = useCartStore((s) => s.addItem);

  // `count === null` = untracked product (no stock limit).
  const { count, loaded } = useStock(product.id);
  const soldOut = !product.inStock || (loaded && count !== null && count <= 0);
  const maxQty = count === null ? Infinity : count;
  const lowStock = !soldOut && count !== null && count > 0 && count <= 5;

  const handleAdd = () => {
    if (soldOut) return;
    addItem(product, Math.min(quantity, maxQty === Infinity ? quantity : maxQty));
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="card group">
      <div className="relative aspect-square overflow-hidden bg-brand-cream">
        <Image
          src={product.image}
          alt={product.name}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
        {product.sizeLabel && (
          <span className="absolute top-3 left-3 bg-brand-maroon/90 text-white text-xs font-medium px-2.5 py-1 rounded-full">
            {product.sizeLabel}
          </span>
        )}
        {soldOut && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <span className="bg-brand-charcoal text-white text-xs font-semibold px-3 py-1.5 rounded-full uppercase tracking-wide">
              Out of Stock
            </span>
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        <div>
          <h3 className="font-display text-xl font-semibold text-brand-charcoal">
            {product.name}
          </h3>
          <p className="font-body text-sm text-brand-charcoal/60 mt-1.5 leading-relaxed line-clamp-2">
            {product.description}
          </p>
        </div>

        <p className="font-display text-2xl font-bold text-brand-maroon">
          {formatCurrency(product.unitPrice)}
        </p>

        {/* Quantity */}
        <div className="flex items-center gap-3">
          <span className="label-text mb-0">Qty</span>
          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="p-2 hover:bg-brand-cream transition-colors"
              aria-label="Decrease"
            >
              <Minus size={14} />
            </button>
            <span className="px-4 py-2 text-sm font-medium min-w-[2.5rem] text-center">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => (q + 1 > maxQty ? q : q + 1))}
              disabled={soldOut || quantity >= maxQty}
              className="p-2 hover:bg-brand-cream transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Increase"
            >
              <Plus size={14} />
            </button>
          </div>
          {lowStock && (
            <span className="font-body text-xs font-medium text-amber-600">
              Only {count} left
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button onClick={handleAdd} disabled={soldOut} className="btn-primary w-full gap-2">
            <ShoppingBag size={16} />
            {soldOut ? 'Out of Stock' : added ? 'Added!' : 'Add to Cart'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/checkout" className="btn-secondary text-center text-xs py-2">
              <Eye size={14} className="inline mr-1" />
              View Cart
            </Link>
            <Link href="/checkout" className="btn-gold text-center text-xs py-2">
              <CreditCard size={14} className="inline mr-1" />
              Checkout
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
