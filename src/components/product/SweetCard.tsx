'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ShoppingBag, Eye, CreditCard, Clock, Sparkles } from 'lucide-react';
import { Product } from '@/types';
import { useCartStore } from '@/store/cart';
import { ASSORTED_BOX_PRODUCT_ID, calculateSweetPrice, isBobbatluProduct } from '@/data/products';
import { useStock } from '@/hooks/useStock';
import { formatCurrency } from '@/lib/utils';
import { renderDescription } from '@/lib/description';

interface SweetCardProps {
  product: Product;
}

export default function SweetCard({ product }: SweetCardProps) {
  const tiers = product.quantityOptions || [16, 25, 50];
  const [selectedTier, setSelectedTier] = useState(tiers[0]);
  const [added, setAdded] = useState(false);
  const addItem = useCartStore((s) => s.addItem);
  const isBobbatlu = isBobbatluProduct(product.id);
  // The Assorted Box has a hard limit in whole boxes; Bobbatlu stock only
  // changes the preparation notice. `count === null` means untracked.
  const isAssortedBox = product.id === ASSORTED_BOX_PRODUCT_ID;
  const { count, loaded } = useStock(isBobbatlu || isAssortedBox ? product.id : null);
  const boxesInCart = useCartStore((s) => s.items
    .filter((item) => item.productId === product.id)
    .reduce((sum, item) => sum + item.quantity, 0));
  const readyFromStock = isBobbatlu && (count ?? 0) >= selectedTier;
  const prepNotice = readyFromStock ? 'Freshly made and in stock.' : product.prepNotice;
  const freshNotice = readyFromStock || product.prepNoticeTone === 'fresh';

  const currentPrice = calculateSweetPrice(product.unitPrice, selectedTier);

  const boxLimit = isAssortedBox && loaded && count !== null ? count : null;
  const soldOut = !product.inStock || (boxLimit !== null && boxLimit <= 0);
  const limitReached = !soldOut && boxLimit !== null && boxesInCart >= boxLimit;
  const lowStock = !soldOut && boxLimit !== null && boxLimit <= 5;

  const handleAdd = () => {
    if (soldOut || limitReached) return;
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
            {renderDescription(product.description)}
          </p>
        </div>

        {prepNotice &&
          (freshNotice ? (
            // Reassurance (baked daily) — reads as good news, not a caution.
            <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <Sparkles size={14} className="text-green-600 shrink-0 mt-0.5" />
              <p className="font-body text-xs text-green-800">{prepNotice}</p>
            </div>
          ) : (
            // Lead time required — the customer needs to plan ahead.
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Clock size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="font-body text-xs text-amber-800">{prepNotice}</p>
            </div>
          ))}

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
          <button onClick={handleAdd} disabled={soldOut || limitReached} className="btn-primary w-full gap-2">
            <ShoppingBag size={16} />
            {soldOut ? 'Out of Stock' : limitReached ? 'All available boxes in cart' : added ? 'Added!' : 'Add to Cart'}
          </button>
          {lowStock && (
            <p className="font-body text-xs font-medium text-amber-600 text-center">
              Only {boxLimit} {boxLimit === 1 ? 'box' : 'boxes'} left
            </p>
          )}
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
