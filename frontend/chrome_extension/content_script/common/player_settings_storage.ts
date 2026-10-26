import {
  PLAYER_SETTINGS,
  PlayerSettings,
} from "../../../../interface/player_settings";
import {
  BOTTOM_MARGIN_RANGE,
  DENSITY_RANGE,
  DISTRIBUTION_STYLE_DEFAULT,
  ENABLE_CHAT_INTERACTION_DEFAULT,
  ENABLE_CHAT_SCROLLING_DEFAULT,
  FONT_FAMILY_DEFAULT,
  FONT_SIZE_RANGE,
  FONT_WEIGHT_RANGE,
  LEGACY_FONT_FAMILY_DEFAULT,
  LEGACY_FONT_WEIGHT_DEFAULT,
  OPACITY_RANGE,
  SHOW_CHAT_WINDOW_DEFAULT,
  SHOW_USER_NAME_DEFAULT,
  SPEED_RANGE,
  TOP_MARGIN_RANGE,
} from "./defaults";
import { parseMessage } from "@selfage/message/parser";

/**
 * Settings live only in the site's localStorage, so each site keeps its own
 * settings and nothing leaves the browser.
 */
export class PlayerSettingsStorage {
  public static create(): PlayerSettingsStorage {
    return new PlayerSettingsStorage();
  }

  private static NAME = "PlayerSettings";

  public async read(): Promise<PlayerSettings> {
    let savedPlayerSettings = parseMessage(
      JSON.parse(localStorage.getItem(PlayerSettingsStorage.NAME)),
      PLAYER_SETTINGS,
    );
    return PlayerSettingsStorage.normalizePlayerSettings(savedPlayerSettings);
  }

  private static normalizePlayerSettings(
    savedPlayerSettings?: PlayerSettings,
  ): PlayerSettings {
    let playerSettings: PlayerSettings = {
      displaySettings: {},
      blockSettings: {},
    };

    let saved = savedPlayerSettings?.displaySettings;
    let displaySettings = playerSettings.displaySettings;
    displaySettings.speed = SPEED_RANGE.getValidValue(saved?.speed);
    displaySettings.opacity = OPACITY_RANGE.getValidValue(saved?.opacity);
    displaySettings.fontSize = FONT_SIZE_RANGE.getValidValue(saved?.fontSize);
    displaySettings.density = DENSITY_RANGE.getValidValue(saved?.density);
    displaySettings.topMargin = TOP_MARGIN_RANGE.getValidValue(
      saved?.topMargin,
    );
    displaySettings.bottomMargin = BOTTOM_MARGIN_RANGE.getValidValue(
      saved?.bottomMargin,
    );
    let savedFontWeight = saved?.fontWeight;
    let savedFontFamily = saved?.fontFamily;
    if (savedFontFamily === LEGACY_FONT_FAMILY_DEFAULT) {
      savedFontFamily = undefined;
      if (savedFontWeight === LEGACY_FONT_WEIGHT_DEFAULT) {
        savedFontWeight = undefined;
      }
    }
    displaySettings.fontWeight = FONT_WEIGHT_RANGE.getValidValue(
      savedFontWeight,
    );
    displaySettings.fontFamily = savedFontFamily ?? FONT_FAMILY_DEFAULT;
    displaySettings.showUserName =
      saved?.showUserName ?? SHOW_USER_NAME_DEFAULT;
    displaySettings.enable = saved?.enable ?? ENABLE_CHAT_SCROLLING_DEFAULT;
    displaySettings.distributionStyle =
      saved?.distributionStyle ?? DISTRIBUTION_STYLE_DEFAULT;
    displaySettings.enableInteraction =
      saved?.enableInteraction ?? ENABLE_CHAT_INTERACTION_DEFAULT;
    displaySettings.showChatWindow =
      saved?.showChatWindow ?? SHOW_CHAT_WINDOW_DEFAULT;

    // Older versions merged synced and local patterns, which could save
    // duplicates.
    let seen = new Set<string>();
    playerSettings.blockSettings.blockPatterns = (
      savedPlayerSettings?.blockSettings?.blockPatterns ?? []
    ).filter((pattern) => {
      let key = `${pattern.kind}:${pattern.content}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    return playerSettings;
  }

  public async save(playerSettings: PlayerSettings): Promise<void> {
    localStorage.setItem(
      PlayerSettingsStorage.NAME,
      JSON.stringify(playerSettings),
    );
  }
}

export let PLAYER_SETTINGS_STORAGE = PlayerSettingsStorage.create();
