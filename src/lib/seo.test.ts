import { describe, expect, it } from 'vitest';
import { getLocalBusinessSchema, pageShareMetadata, SHARE_IMAGE, to24Hour } from '@/lib/seo';
import { ACTIVE_PICKUP_LOCATIONS } from '@/data/products';

describe('to24Hour', () => {
  it('converts pickup times to 24-hour clock', () => {
    expect(to24Hour('6:30 PM')).toBe('18:30');
    expect(to24Hour('10:25 PM')).toBe('22:25');
    expect(to24Hour('12:50 AM')).toBe('00:50');
    expect(to24Hour('1:30 AM')).toBe('01:30');
    expect(to24Hour('12:00 PM')).toBe('12:00');
    expect(() => to24Hour('6.30pm')).toThrow();
  });
});

describe('getLocalBusinessSchema opening hours', () => {
  const schema = getLocalBusinessSchema();

  it('is closed on Tuesdays and open the other six days', () => {
    expect(schema.openingHoursSpecification.dayOfWeek).toEqual(
      ['Sunday', 'Monday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    );
  });

  it('runs from the earliest pickup opening to the latest closing past midnight', () => {
    expect(schema.openingHoursSpecification).toMatchObject({ opens: '18:30', closes: '01:30' });
  });

  it("gives each pickup location its own window", () => {
    const hours = Object.fromEntries(schema.hasPOS.map((p) => [p.name, p.openingHoursSpecification]));
    expect(Object.keys(hours)).toHaveLength(ACTIVE_PICKUP_LOCATIONS.length);
    expect(hours['Biryanify - Plano']).toMatchObject({ opens: '18:30', closes: '00:50' });
    expect(hours['Ravi Babu Biryani - Frisco']).toMatchObject({ opens: '18:30', closes: '22:25' });
    expect(hours['Ravi Babu Biryani - Irving']).toMatchObject({ opens: '18:30', closes: '01:30' });
  });
});

describe('pageShareMetadata', () => {
  it('shares the page with the logo on Open Graph and X', () => {
    const meta = pageShareMetadata({ path: '/sweets', title: 'Sweets', description: 'Fresh sweets' });
    expect(meta.openGraph).toMatchObject({
      url: 'https://amammajaadi.com/sweets', siteName: 'Amamma Jaadi', type: 'website',
      title: 'Sweets', description: 'Fresh sweets', images: [SHARE_IMAGE],
    });
    expect(meta.twitter).toMatchObject({ card: 'summary', images: [SHARE_IMAGE.url] });
  });
});
