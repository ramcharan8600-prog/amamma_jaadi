/**
 * Emit a structured-data block. Server component — the JSON is rendered into
 * the HTML at build time, so crawlers see it without running any JavaScript.
 */
export default function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
