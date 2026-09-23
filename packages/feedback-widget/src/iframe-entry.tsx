import { render } from "solid-js/web";

import sprite from "./icons/sprite.svg?raw";
import { WidgetApp } from "./main";

import "./styles/widget.css";

/**
 * The production iframe entry.
 *
 * The widget's Astro shell used to assemble the sprite and mount the app
 * inline; with the shell now served by a Start server route, this entry owns
 * both. It is the `input` of `vite.config.iframe.ts`, so the build emits
 * `widget.js` (plus `widget.css` and the font assets) with no HTML file.
 */
const svg = sprite.slice(sprite.indexOf("<svg"));
const holder = document.createElement("div");
holder.setAttribute("aria-hidden", "true");
holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
holder.innerHTML = svg;

const spriteElement = holder.firstElementChild;
if (spriteElement) {
  document.body.appendChild(spriteElement);
}

const root = document.getElementById("root");
if (root) {
  render(() => <WidgetApp />, root);
}
