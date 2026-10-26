import { DisplaySettings } from "../../../interface/player_settings";

export type DisplaySettingsTransform = (
  displaySettings: DisplaySettings,
) => DisplaySettings;

export interface ChatPacingSettings {
  intervalMs: number;
  maxPendingChats: number;
}

export interface DanmakuProfile {
  transformDisplaySettings: DisplaySettingsTransform;
  followPlaybackRate: boolean;
  chatPacing?: ChatPacingSettings;
  // Height of a dedicated danmaku overlay, as a percentage of the player.
  canvasHeightPercent?: number;
}

export function keepDisplaySettings(
  displaySettings: DisplaySettings,
): DisplaySettings {
  return displaySettings;
}

export function createKickDisplaySettings(
  displaySettings: DisplaySettings,
): DisplaySettings {
  return {
    ...displaySettings,
    fontSize: displaySettings.fontSize * 1.2,
    opacity: 80,
    // Kick's dedicated canvas is already the top region of the player.
    topMargin: 0,
    bottomMargin: 0,
  };
}

export let DEFAULT_DANMAKU_PROFILE: DanmakuProfile = {
  transformDisplaySettings: keepDisplaySettings,
  followPlaybackRate: false,
};

export let KICK_DANMAKU_PROFILE: DanmakuProfile = {
  transformDisplaySettings: createKickDisplaySettings,
  followPlaybackRate: true,
  chatPacing: {
    intervalMs: 80,
    maxPendingChats: 30,
  },
  canvasHeightPercent: 30,
};
