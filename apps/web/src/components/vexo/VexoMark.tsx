/** Vexo brand mark: three rounded triangles (matches the Mac app icon). */
export function VexoMark({ label }: { readonly label?: string }) {
  return (
    <svg
      viewBox="0 0 128 128"
      className="h-full w-full"
      fill="currentColor"
      {...(label
        ? { role: "img" as const, "aria-label": label }
        : { "aria-hidden": true as const })}
    >
      {/* Soft corner radii match AppIcon / the in-app mark — not sharp geometric tips. */}
      <path d="M59.01 30.66Q64.00 22.00 68.99 30.66L85.51 59.34Q90.50 68.00 80.50 68.00L47.50 68.00Q37.50 68.00 42.49 59.34Z" />
      <path d="M30.51 80.66Q35.50 72.00 40.49 80.66L57.01 109.34Q62.00 118.00 52.00 118.00L19.00 118.00Q9.00 118.00 13.99 109.34Z" />
      <path d="M87.51 80.66Q92.50 72.00 97.49 80.66L114.01 109.34Q119.00 118.00 109.00 118.00L76.00 118.00Q66.00 118.00 70.99 109.34Z" />
    </svg>
  );
}
