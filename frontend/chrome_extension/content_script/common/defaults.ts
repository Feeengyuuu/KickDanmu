import { DistributionStyle } from "../../../../interface/player_settings";
import { NumberRange } from "./number_range";

export let SPEED_RANGE = new NumberRange(500, 100, 200);
export let OPACITY_RANGE = new NumberRange(100, 0, 80);
export let FONT_SIZE_RANGE = new NumberRange(100, 10, 25);
export let DENSITY_RANGE = new NumberRange(100, 0, 100);
export let TOP_MARGIN_RANGE = new NumberRange(100, 0, 1);
export let BOTTOM_MARGIN_RANGE = new NumberRange(100, 0, 10);
export let FONT_WEIGHT_RANGE = new NumberRange(900, 100, 600);;
// Same font stack and weight as Douyu's scrolling danmaku.
export let FONT_FAMILY_DEFAULT =
  '"Segoe UI Emoji", SimHei, "Microsoft JhengHei", Arial, Helvetica, sans-serif';
// Defaults before switching to Douyu's font. Saved settings still holding them
// were never customized, so they are upgraded when read.
export let LEGACY_FONT_FAMILY_DEFAULT = "Arial";
export let LEGACY_FONT_WEIGHT_DEFAULT = 400;
export let ENABLE_CHAT_SCROLLING_DEFAULT = true;
export let SHOW_USER_NAME_DEFAULT = false;
export let DISTRIBUTION_STYLE_DEFAULT =
  DistributionStyle.RandomDistributionStyle;
export let ENABLE_CHAT_INTERACTION_DEFAULT = false;
export let SHOW_CHAT_WINDOW_DEFAULT = true;
