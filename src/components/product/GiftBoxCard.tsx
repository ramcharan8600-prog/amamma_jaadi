'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Gift, ShoppingBag, Eye, CreditCard, Minus, Plus } from 'lucide-react';
import { Product } from '@/types';
import { useCartStore } from '@/store/cart';
import { formatCurrency } from '@/lib/utils';

interface GiftBoxCardProps {
  product: Product;
}

export default function GiftBoxCard({ product }: GiftBoxCardProps) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const addItem = useCartStore((s) => s.addItem);

  const handleAdd = () => {
    addItem(product, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="card border-brand-gold/30 group">
      <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-brand-gold/10 to-brand-cream">
        <Image
          src={product.image}
          alt={product.name}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        <span className="absolute bottom-4 left-4 flex items-center gap-1.5 bg-brand-gold text-white text-sm font-semibold px-3 py-1.5 rounded-full">
          <Gift size={14} />
          Premium Gift
        </span>
      </div>

      <div className="p-6 space-y-4">
        <div>
          <h3 className="font-display text-2xl font-semibold text-brand-charcoal">
            {product.name}
          </h3>
          <p className="font-body text-sm text-brand-charcoal/60 mt-2 leading-relaxed">
            {product.description}
          </p>
        </div>

        <div className="bg-brand-cream rounded-lg p-3 space-y-1.5">
          <p className="font-body text-xs font-medium text-brand-charcoal/70">Available packaging:</p>
          <p className="font-body text-xs text-brand-charcoal/60">• Small aluminium tin — 16 pieces</p>
          <p className="font-body text-xs text-brand-charcoal/60">• Large aluminium tin — 50 Malai Khaja or 40 Malpuri</p>
        </div>

        <p className="font-display text-3xl font-bold text-brand-gold">
          {formatCurrency(product.unitPrice)}
        </p>

        <div className="flex items-center gap-3">
          <span className="label-text mb-0">Qty</span>
          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="p-2 hover:bg-brand-cream transition-colors"
            >
              <Minus size={14} />
            </button>
            <span className="px-4 py-2 text-sm font-medium min-w-[2.5rem] text-center">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="p-2 hover:bg-brand-cream transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button onClick={handleAdd} className="btn-gold w-full gap-2">
            <ShoppingBag size={16} />
            {added ? 'Added!' : 'Add to Cart'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/checkout" className="btn-secondary text-center text-xs py-2">
              <Eye size={14} className="inline mr-1" />
              View Cart
            </Link>
            <Link href="/checkout" className="btn-primary text-center text-xs py-2">
              <CreditCard size={14} className="inline mr-1" />
              Checkout
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
