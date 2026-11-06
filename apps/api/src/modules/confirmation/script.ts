/**
 * The store's confirmation script (M2, E6-5, E6-16a): its own wording for every message the buyer
 * reads in the chat after the template, and for the team's call, with variables from the order.
 * A pack gives the starting wording (Egyptian, formal or Gulf Arabic); the owner's text wins.
 */
export * from "./script/catalogue.js";
export * from "./script/packs.js";
export * from "./script/validate.js";
export { fit, render, say, scriptText, templateParam } from "./script/render.js";
