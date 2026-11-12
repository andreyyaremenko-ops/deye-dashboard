/**
 * Крейдяна рамка меню (оформлення «дошка», props.frame): лінії від руки, що заходять за кути, як на справжній дошці.
 * Рамка — inline SVG на весь віджет (розтягується, товщина лінії стала через non-scaling-stroke), завитки в кутах —
 * окремі квадратні SVG, щоб не сплющувались. Зернистість дає та сама маска з шуму, що й тексту (.look-chalk .cf).
 */
const SIDES = [
  "M6 16C250 4 640 26 994 12", "M986 5C996 300 978 720 990 995",
  "M995 986C700 996 280 976 4 988", "M14 996C4 700 22 280 11 4",
];
// друга лінія трохи всередині й з іншим «тремтінням» руки
const INNER = [
  "M30 40C300 34 650 44 968 37", "M962 30C968 300 959 700 965 970",
  "M970 962C650 967 300 957 32 964", "M38 970C33 650 41 300 36 32",
];
// завиток лівого верхнього кута (100×100); інші кути — дзеркала через CSS
const CURL = "M8 62C8 32 32 8 62 8M8 62C8 74 20 76 24 68C28 60 18 54 14 60M62 8C74 8 76 20 68 24C60 28 54 18 60 14M20 46C20 32 32 20 46 20M30 30L38 38M41 41A3 3 0 1 0 41.1 41";

export function ChalkFrame({ kind, color, accent }: { kind: string; color: string | null; accent: string | null }) {
  const lines = kind === "double" ? [...SIDES, ...INNER] : SIDES;
  return <div class={`cf cf-${kind}`} style={color ? { color } : undefined} aria-hidden="true">
    <svg class="cf-box" viewBox="0 0 1000 1000" preserveAspectRatio="none">
      {lines.map((d, i) => <path key={i} d={d} vector-effect="non-scaling-stroke" />)}
    </svg>
    {kind === "ornate" && ["tl", "tr", "br", "bl"].map((c) => <svg key={c} class={`cf-c cf-${c}`} viewBox="0 0 100 100" style={accent ? { color: accent } : undefined}>
      <path d={CURL} />
    </svg>)}
  </div>;
}
