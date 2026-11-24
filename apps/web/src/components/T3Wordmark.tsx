import type { SVGProps } from "react";

/** Three-triangle brand mark (matches the Vexo / T3 app icon). */
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
      <path d="M64 22 90.5 68H37.5Z" />
      <path d="M35.5 72 62 118H9Z" />
      <path d="M92.5 72 119 118H66Z" />
    </svg>
  );
}
