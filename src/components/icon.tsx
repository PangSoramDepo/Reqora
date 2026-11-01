import type { CSSProperties } from "react";

type IconProps = {
  name: string;
  className?: string;
  style?: CSSProperties;
};

/** Material Symbols Outlined glyph, as used throughout the Stitch designs. */
export function Icon({ name, className, style }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={className ? `icon ${className}` : "icon"}
      style={style}
    >
      {name}
    </span>
  );
}
