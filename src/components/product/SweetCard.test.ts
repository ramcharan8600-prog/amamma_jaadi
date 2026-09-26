// @vitest-environment jsdom
import {act,createElement,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {getProductById} from '@/data/products';
import {invalidateStock} from '@/hooks/useStock';
import {useCartStore} from '@/store/cart';
import SweetCard from './SweetCard';
vi.mock('next/image',()=>({default:({alt,src}:{alt:string;src:string})=>createElement('img',{alt,src})}));
vi.mock('next/link',()=>({default:({children,href}:{children:ReactNode;href:string})=>createElement('a',{href},children)}));
it.each(['sweet-bobbatlu', 'sweet-kova-bobbatlu'].flatMap(productId => [0, 15, 25].map(count => ({ productId, count }))))('shows $productId preparation according to stock $count and selected box size',async ({ productId, count })=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({stock:{[productId]:count}})));
  invalidateStock();
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);
  try{
    await act(async()=>root.render(createElement(SweetCard,{product:getProductById(productId)!})));
    expect(host.textContent?.includes('1 day for preparation')).toBe(count<16);
    expect(host.textContent?.includes('Freshly made and in stock')).toBe(count>=16);
    expect(host.querySelector('button')?.disabled).toBe(false);
    expect(host.textContent).not.toContain('2 days');
    const select=host.querySelector('select')!;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,'50');
      select.dispatchEvent(new Event('change',{bubbles:true}));
    });
    expect(host.textContent).toContain('1 day for preparation');
    expect(host.querySelector('button')?.disabled).toBe(false);
  }finally{
    await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();invalidateStock();
  }
});
async function renderAssorted(stock: Record<string, number>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({stock})));
  invalidateStock();
  useCartStore.getState().clearCart();
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);
  await act(async()=>root.render(createElement(SweetCard,{product:getProductById('sweet-assorted-box')!})));
  const cleanup=async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();invalidateStock();useCartStore.getState().clearCart();};
  return {host,cleanup};
}

it('offers the Assorted Box as a single 22-piece, $55 box with a bold 11:11 line and the gift-box photo',async()=>{
  const {host,cleanup}=await renderAssorted({});
  try{
    expect(Array.from(host.querySelectorAll('option')).map(o=>o.textContent)).toEqual(['22 pcs — $55.00']);
    expect(host.textContent).toContain('11 pcs Guntur Malpuri and 11 pcs Nellore Malai Khaja');
    expect(host.querySelector('strong')?.textContent).toBe('your 11:11 sweet cravings');
    expect(host.textContent).not.toContain('**');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/images/products/texas-limited-gift-box-closed.jpg');
    expect(host.querySelector('button')?.disabled).toBe(false);
  }finally{await cleanup();}
});

it('shows the Assorted Box out of stock when its box count is 0',async()=>{
  const {host,cleanup}=await renderAssorted({'sweet-assorted-box':0});
  try{
    expect(host.querySelector('button')?.textContent).toContain('Out of Stock');
    expect(host.querySelector('button')?.disabled).toBe(true);
  }finally{await cleanup();}
});

it('limits Assorted Boxes in the cart to the box count',async()=>{
  const {host,cleanup}=await renderAssorted({'sweet-assorted-box':2});
  try{
    expect(host.textContent).toContain('Only 2 boxes left');
    const add=()=>host.querySelector('button')!;
    await act(async()=>add().click());
    await act(async()=>add().click());
    expect(useCartStore.getState().items).toEqual([expect.objectContaining({productId:'sweet-assorted-box',quantity:2,selectedTier:22,lineTotal:110})]);
    expect(add().disabled).toBe(true);
    expect(add().textContent).toContain('All available boxes in cart');
  }finally{await cleanup();}
});
