import { describe, expect, it } from "vitest";
import imageLoader from "./image-loader";

describe("imageLoader", () => {
  it("asks Cloudinary for the rendered width and best format", () => {
    expect(imageLoader({ src: "https://res.cloudinary.com/demo/image/upload/v1/spots/a.jpg", width: 640 })).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_640/v1/spots/a.jpg",
    );
  });

  it("passes local and other images through", () => {
    expect(imageLoader({ src: "/hero-1.png", width: 1080 })).toBe("/hero-1.png?w=1080");
    expect(imageLoader({ src: "https://pbs.twimg.com/a.jpg", width: 96 })).toBe("https://pbs.twimg.com/a.jpg");
  });
});
