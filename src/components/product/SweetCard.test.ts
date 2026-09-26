// @vitest-environment jsdom
import {act,createElement,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {getProductById} from '@/data/products';
import {invalidateStock} from '@/hooks/useStock';
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
it('offers the Assorted Box as a single 20-piece, $50 box with the gift-box photo',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({stock:{}})));
  invalidateStock();
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);
  try{
    await act(async()=>root.render(createElement(SweetCard,{product:getProductById('sweet-assorted-box')!})));
    expect(Array.from(host.querySelectorAll('option')).map(o=>o.textContent)).toEqual(['20 pcs — $50.00']);
    expect(host.textContent).toContain('10 pcs Guntur Malpuri and 10 pcs Nellore Malai Khaja');
    expect(host.textContent).toContain('Baked fresh every day.');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/images/products/texas-limited-gift-box-closed.jpg');
  }finally{
    await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();invalidateStock();
  }
});
