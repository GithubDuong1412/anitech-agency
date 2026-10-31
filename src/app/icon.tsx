import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// Same 2×2 mark as .brand-mark: lime #b5f36f, opacities 1 / .74 / .48 / .9 on #0b1915.
const squares = ["#b5f36f", "#89ba58", "#5d8240", "#a4dd66"];

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b1915",
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            transform: "rotate(-8deg)",
          }}
        >
          {squares.map((color) => (
            <div
              key={color}
              style={{
                width: 20,
                height: 20,
                borderRadius: 5,
                background: color,
              }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
