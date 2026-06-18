'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ShoppingBag, Eye, CreditCard } from 'lucide-react';
import { Product } from '@/types';
import { useCartStore } from '@/store/cart';
import { calculateSweetPrice } from '@/data/products';
import { formatCurrency } from '@/lib/utils';

interface SweetCardProps {
  product: Product;
}

export default function SweetCard({ product }: SweetCardProps) {
  const tiers = product.quantityOptions || [16, 25, 50];
  const [selectedTier, setSelectedTier] = useState(tiers[0]);
  const [added, setAdded] = useState(false);
  const addItem = useCartStore((s) => s.addItem);

  const currentPrice = calculateSweetPrice(product.unitPrice, selectedTier);

  const handleAdd = () => {
    addItem(product, 1, selectedTier);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="card group">
      <div className="relative aspect-[4/3] overflow-hidden bg-brand-cream">
        <Image
          src={product.image}
          alt={product.name}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className={`${product.imageFit === 'contain' ? 'object-contain' : 'object-cover'} group-hover:scale-105 transition-transform duration-500`}
        />
        <span className="absolute top-3 right-3 bg-brand-gold text-white text-xs font-medium px-2.5 py-1 rounded-full">
          {formatCurrency(product.unitPrice)}/pc
        </span>
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

        {/* Tier Selection */}
        <div>
          <label className="label-text">Quantity</label>
          <select
            value={selectedTier}
            onChange={(e) => setSelectedTier(Number(e.target.value))}
            className="input-field"
          >
            {tiers.map((tier) => (
              <option key={tier} value={tier}>
                {tier} pcs — {formatCurrency(calculateSweetPrice(product.unitPrice, tier))}
              </option>
            ))}
          </select>
        </div>

        {/* Dynamic Price */}
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-bold text-brand-maroon">
            {formatCurrency(currentPrice)}
          </span>
          <span className="font-body text-xs text-brand-charcoal/50">
            for {selectedTier} pieces
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button onClick={handleAdd} className="btn-primary w-full gap-2">
            <ShoppingBag size={16} />
            {added ? 'Added!' : 'Add to Cart'}
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
