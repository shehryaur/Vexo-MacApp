interface MarkTriangle {
  readonly d: string;
  readonly fill: string;
}

function roundedPolygon(points: readonly (readonly [number, number])[], radius: number): string {
  const commands: string[] = [];
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const previous = points[(index + count - 1) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    if (previous === undefined || current === undefined || next === undefined) continue;
    const inboundX = current[0] - previous[0];
    const inboundY = current[1] - previous[1];
    const outboundX = next[0] - current[0];
    const outboundY = next[1] - current[1];
    const inboundLength = Math.hypot(inboundX, inboundY);
    const outboundLength = Math.hypot(outboundX, outboundY);
    if (inboundLength === 0 || outboundLength === 0) continue;
    const used = Math.min(radius, inboundLength / 2.5, outboundLength / 2.5);
    const startX = current[0] - (inboundX / inboundLength) * used;
    const startY = current[1] - (inboundY / inboundLength) * used;
    const endX = current[0] + (outboundX / outboundLength) * used;
    const endY = current[1] + (outboundY / outboundLength) * used;
    const start = `${startX.toFixed(2)} ${startY.toFixed(2)}`;
    const corner = `${current[0].toFixed(2)} ${current[1].toFixed(2)}`;
    const end = `${endX.toFixed(2)} ${endY.toFixed(2)}`;
    commands.push(index === 0 ? `M ${start}` : `L ${start}`, `Q ${corner} ${end}`);
  }
  commands.push("Z");
  return commands.join(" ");
}

function roundedTriangle(cx: number, top: number, side: number, radius: number): string {
  const height = (side * Math.sqrt(3)) / 2;
  return roundedPolygon(
    [
      [cx, top],
      [cx - side / 2, top + height],
      [cx + side / 2, top + height],
    ],
    radius,
  );
}

function buildMark(): readonly MarkTriangle[] {
  const side = 18;
  const pitchX = 21;
  const gapY = 2.6;
  const height = (side * Math.sqrt(3)) / 2;
  const center = 36;
  const rows: ReadonlyArray<{
    readonly top: number;
    readonly centers: readonly number[];
    readonly fill: string;
  }> = [
    { top: 3, centers: [center], fill: "#f7f9fb" },
    {
      top: 3 + height + gapY,
      centers: [center - pitchX / 2, center + pitchX / 2],
      fill: "#d7e1ec",
    },
    {
      top: 3 + (height + gapY) * 2,
      centers: [center - pitchX, center, center + pitchX],
      fill: "#b5c6d6",
    },
  ];
  return rows.flatMap((row) =>
    row.centers.map((cx) => ({
      d: roundedTriangle(cx, row.top, side, 2.35),
      fill: row.fill,
    })),
  );
}

const MARK_TRIANGLES = buildMark();

export function VexoMark({ label }: { readonly label?: string }) {
  return (
    <svg
      viewBox="0 0 72 62"
      className="h-full w-full"
      {...(label
        ? { role: "img" as const, "aria-label": label }
        : { "aria-hidden": true as const })}
    >
      {MARK_TRIANGLES.map((triangle) => (
        <path key={triangle.d} d={triangle.d} fill={triangle.fill} />
      ))}
    </svg>
  );
}
