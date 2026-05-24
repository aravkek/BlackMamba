/**
 * Hand-rolled monogram marks for each subscription. Inline SVG so they always
 * render — no CDN risk on demo day.
 */
type Props = { id: string; size?: number; color?: string };

export function BrandMark({ id, size = 28, color }: Props) {
  const s = size;
  switch (id) {
    case "netflix":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill="#000" />
          <path
            d="M11 8h2.4l5.2 11V8H21v16h-2.4l-5.2-11v11H11V8z"
            fill={color ?? "#E50914"}
          />
        </svg>
      );
    case "spotify":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" fill={color ?? "#1DB954"} />
          <path
            d="M9 13.5c4.5-1.4 10-1 14 1.2M10 17.5c3.5-1 8-.6 11.5 1.2M11 21c2.8-.7 6.2-.4 8.8 1"
            stroke="#000"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    case "disney":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill={color ?? "#113CCF"} />
          <text
            x="16"
            y="21"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontWeight="700"
            fontSize="14"
            fill="#fff"
          >
            D+
          </text>
        </svg>
      );
    case "notion":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill="#0a0a0a" stroke="#3a3a3a" />
          <path
            d="M10 9h8l5 6v8c0 .8-.7 1.5-1.5 1.5h-11c-.8 0-1.5-.7-1.5-1.5V10.5C9 9.7 9.7 9 10 9z"
            stroke="#fff"
            strokeWidth="1.4"
            fill="none"
          />
          <path
            d="M12 13.5l8 9v-9"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    case "goodlife":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill="#0a0a0a" />
          <path
            d="M16 23s-7-4.2-7-9.3a3.7 3.7 0 0 1 7-1.5 3.7 3.7 0 0 1 7 1.5C23 18.8 16 23 16 23z"
            fill={color ?? "#ED1C24"}
          />
        </svg>
      );
    case "crave":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill={color ?? "#1D2C56"} />
          <text
            x="16"
            y="21"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontWeight="800"
            fontSize="14"
            fill="#fff"
            letterSpacing="-0.5"
          >
            cr
          </text>
        </svg>
      );
    case "tubi":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill={color ?? "#FA382F"} />
          <text
            x="16"
            y="21"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontWeight="800"
            fontSize="13"
            fill="#fff"
            letterSpacing="-0.5"
          >
            tubi
          </text>
        </svg>
      );
    case "appletv":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill="#0a0a0a" stroke="#3a3a3a" />
          <path
            d="M17.5 11.2c.6-.8.5-2 .1-2.6-.8.1-1.7.7-2.2 1.4-.5.6-.8 1.7-.4 2.4.9.1 1.8-.4 2.5-1.2zM20 23.4c.7-1 .9-1.6 1.4-2.8-2.6-1-3-4.7-.5-6.2-.7-.9-1.7-1.4-2.7-1.4-1.2 0-1.8.7-2.7.7-1 0-1.7-.7-2.8-.7-1.4 0-2.9.9-3.7 2.4-1.6 2.8-.4 6.9 1.1 9.2.7 1.1 1.6 2.4 2.7 2.4 1.1 0 1.5-.7 2.8-.7 1.3 0 1.7.7 2.8.7 1.2 0 2-1.1 2.7-2.2z"
            fill="#fff"
          />
        </svg>
      );
    case "tangerine":
      return (
        <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="13" fill={color ?? "#F38B00"} />
          <text
            x="16"
            y="21"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontWeight="800"
            fontSize="14"
            fill="#fff"
          >
            T
          </text>
        </svg>
      );
    default:
      return (
        <div
          className="rounded-md flex items-center justify-center text-xs font-bold text-white"
          style={{ width: s, height: s, background: color ?? "#262626" }}
        >
          {id.slice(0, 1).toUpperCase()}
        </div>
      );
  }
}
