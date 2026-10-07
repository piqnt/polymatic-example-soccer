import preact from "@preact/preset-vite";

export default {
  // relative, so the same build works on github pages and from the game server
  base: "./",
  plugins: [preact()],
};
