import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Events & Bulk Orders',
  description: 'Order South Indian sweets in bulk for weddings, festivals, corporate events & celebrations in Dallas-Fort Worth. Minimum 100 pieces. Bobbatlu, Kaju Katli, Malai Khaja & more.',
  keywords: ['Indian wedding sweets Dallas', 'bulk Indian sweets order Texas', 'Telugu event catering Dallas', 'South Indian festival sweets DFW'],
  openGraph: {
    title: 'Events & Bulk Orders | Amamma Jaadi',
    description: 'Premium South Indian sweets for your special occasions. Minimum 100 pieces.',
  },
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
