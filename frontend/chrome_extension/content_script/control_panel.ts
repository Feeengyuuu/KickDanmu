import EventEmitter = require("events");
import { PlayerSettings } from "../../../interface/player_settings";
import { ColorScheme } from "../../color_scheme";
import { FONT_M } from "../../font_sizes";
import { BlockSettingsTab } from "./block_settings_tab/block_settings_tab";
import { GlobalDocuments } from "./common/global_documents";
import {
  PLAYER_SETTINGS_STORAGE,
  PlayerSettingsStorage,
} from "./common/player_settings_storage";
import { DisplaySettingsTab } from "./display_settings_tab/display_settings_tab";
import { E } from "@selfage/element/factory";
import { Ref, assign } from "@selfage/ref";
import { TabNavigator } from "@selfage/tabs/navigator";

enum Tab {
  DISPLAY_SETTINGS = 1,
  BLOCK_SETTINGS = 2,
}

export interface ControlPanel {
  on(event: "updateDisplaySettings", listener: () => void): this;
  on(event: "updateBlockSettings", listener: () => void): this;
}

export class ControlPanel extends EventEmitter {
  public static createYouTubeChat(
    globalDocuments: GlobalDocuments,
    playerSettings: PlayerSettings,
  ): ControlPanel {
    return new ControlPanel(
      window,
      PLAYER_SETTINGS_STORAGE,
      `height: 100%; aspect-ratio: 1/1;`,
      "currentColor",
      globalDocuments,
      playerSettings,
    );
  }

  public static createTwitch(
    globalDocuments: GlobalDocuments,
    playerSettings: PlayerSettings,
  ): ControlPanel {
    return new ControlPanel(
      window,
      PLAYER_SETTINGS_STORAGE,
      `height: 100%; aspect-ratio: 1/1;`,
      "white",
      globalDocuments,
      playerSettings,
    );
  }

  public static createKick(
    globalDocuments: GlobalDocuments,
    playerSettings: PlayerSettings,
  ): ControlPanel {
    return new ControlPanel(
      window,
      PLAYER_SETTINGS_STORAGE,
      `height: 44px; width: 44px;`,
      "white",
      globalDocuments,
      playerSettings,
    );
  }

  private static TAB_BUTTON_WIDTH = 24; // px
  private static WIDTH_TRANSITION_STYLE = "width .3s";

  public button: HTMLDivElement;
  public panel: HTMLDivElement;
  private tabHeadLine = new Ref<HTMLDivElement>();
  private displaySettingsTabHead = new Ref<HTMLDivElement>();
  private displaySettingsTabButton = new Ref<HTMLDivElement>();
  private blockSettingsTabHead = new Ref<HTMLDivElement>();
  private blockSettingsTabButton = new Ref<HTMLDivElement>();
  private displaySettingsTab = new Ref<DisplaySettingsTab>();
  private blockSettingsTab = new Ref<BlockSettingsTab>();
  private tabNavigator: TabNavigator<Tab>;

  public constructor(
    private window: Window,
    private playerSettingsStorage: PlayerSettingsStorage,
    buttonStyle: string,
    buttonColor: string,
    private globalDocuments: GlobalDocuments,
    private playerSettings: PlayerSettings,
  ) {
    super();
    let tabHeads = new Array<HTMLDivElement>();
    tabHeads.push(
      assign(
        this.displaySettingsTabHead,
        ControlPanel.createTabHead(
          this.displaySettingsTabButton,
          chrome.i18n.getMessage("displaySettingsTitle"),
          `M83 0 L117 0 L117 29 A73 73 0 0 1 138 38 L159 17 L183 41 L162 62 A73 73 0 0 1 171 83 L200 83 L200 117 L171 117 A73 73 0 0 1 162 138 L183 158 L159 183 L138 162 A73 73 0 0 1 117 171 L117 200 L83 200 L83 171 A73 73 0 0 1 62 162 L41 183 L17 159 L38 138 A73 73 0 0 1 29 117 L0 117 L0 83 L29 83 A73 73 0 0 1 38 62 L17 41 L41 17 L63 38 A73 73 0 0 1 83 29 z  M100 60 A40 40 0 0 0 100 140 A40 40 0 0 0 100 60 z`,
        ),
      ),
      assign(
        this.blockSettingsTabHead,
        ControlPanel.createTabHead(
          this.blockSettingsTabButton,
          chrome.i18n.getMessage("blockSettingsTitle"),
          `M100 0 A100 100 0 0 1 100 200 A100 100 0 0 1 100 0 z  M159 138 A70 70 0 0 0 62 41 z  M41 62 A70 70 0 0 0 138 159 z`,
        ),
      ),
    );

    let tabs = new Array<HTMLDivElement>();
    tabs.push(
      assign(
        this.displaySettingsTab,
        DisplaySettingsTab.create(this.playerSettings.displaySettings).hide(),
      ).body,
      assign(
        this.blockSettingsTab,
        BlockSettingsTab.create(this.playerSettings.blockSettings).hide(),
      ).body,
    );

    this.button = E.div(
      {
        class: "control-panel-button-container",
        style: `font-size: 0; line-height: 0; display: inline-block; text-align: left; text-shadow: none; vertical-align: top; cursor: pointer; ${buttonStyle}`,
      },
      E.div(
        {
          class: "control-panel-button",
          style: `width: 100%; height: 100%; padding: 22%; box-sizing: border-box;`,
        },
        E.svg(
          {
            class: "control-panel-svg",
            style: `display: block; height: 100%; fill: ${buttonColor};`,
            viewBox: "0 0 200 200",
          },
          E.path({
            class: "control-panel-control-panel-path",
            d: "M99 0 L99 97 L49 49 z  M120 17 L149 17 L149 80 L120 80 z  M171 17 L200 17 L200 80 L171 80 z  M50 103 L50 200 L0 152 z  M71 120 L100 120 L100 183 L71 183 z  M122 120 L151 120 L151 183 L122 183 z",
          }),
        ),
      ),
    );
    this.panel = E.div(
      {
        class: "control-panel-control-panel-popup",
        style: `font-size: 0; line-height: 0; position: absolute; display: flex; flex-flow: column nowrap; width: 320px; height: 384px; padding: 4px; box-sizing: border-box; background-color: ${ColorScheme.getBackground()}; box-shadow: 1px 1px 4px ${ColorScheme.getPopupShadow()}; z-index: 10000;`,
      },
      E.div(
        {
          ref: this.tabHeadLine,
          class: "control-panel-tab-head-line",
          style: `width: 100%;`,
        },
        ...tabHeads,
      ),
      E.div(
        {
          class: "control-panel-tabs",
          style: `flex-grow: 1; box-sizing: border-box; width: 100%; min-height: 0;`,
        },
        ...tabs,
      ),
    );
    this.hidePopup();
    this.tabNavigator = new TabNavigator(
      (tab) => this.addTab(tab),
      (tab) => this.removeTab(tab),
    );

    this.tabNavigator.goTo(Tab.DISPLAY_SETTINGS);
    this.displaySettingsTabButton.val.addEventListener("click", () =>
      this.tabNavigator.goTo(Tab.DISPLAY_SETTINGS),
    );
    this.blockSettingsTabButton.val.addEventListener("click", () =>
      this.tabNavigator.goTo(Tab.BLOCK_SETTINGS),
    );
    this.displaySettingsTab.val.on("update", () =>
      this.updateDisplaySettings(),
    );
    this.blockSettingsTab.val.on("update", () => this.updateBlockSettings());

    this.button.addEventListener("click", (event) => {
      this.togglePopup();
    });
    this.button.addEventListener("mousedown", (event) =>
      event.stopPropagation(),
    );
    this.panel.addEventListener("mousedown", (event) =>
      event.stopPropagation(),
    );
    this.globalDocuments.hideWhenMousedown(() => this.hidePopup());
  }

  private static createTabHead(
    tabButton: Ref<HTMLDivElement>,
    titleText: string,
    svgPath: string,
  ): HTMLDivElement {
    let head = E.div(
      {
        class: "control-panel-tab-head",
        style: `display: inline-flex; align-items: center; border-radius: 4px 4px 0 0; transition: ${ControlPanel.WIDTH_TRANSITION_STYLE}; overflow: hidden;`,
      },
      E.div(
        {
          ref: tabButton,
          class: "control-panel-tab-button",
          style: `flex-shrink: 0; height: ${ControlPanel.TAB_BUTTON_WIDTH}px; padding: 2px; box-sizing: border-box; cursor: pointer;`,
        },
        E.svg(
          {
            class: "control-panel-tab-button-svg",
            style: `display: block; height: 100%; fill: ${ColorScheme.getSvgContent()};`,
            viewBox: "0 0 200 200",
          },
          E.path({ class: "control-panel-tab-button-path", d: svgPath }),
        ),
      ),
      E.div(
        {
          class: "control-panel-title",
          style: `flex-grow: 1; font-size: ${FONT_M}px; line-height: 100%; font-family: initial !important; text-align: center; white-space: nowrap; color: ${ColorScheme.getContent()};`,
        },
        E.text(titleText),
      ),
    );
    ControlPanel.lowlightTabHead(head);
    return head;
  }

  private hidePopup(): void {
    this.panel.style.display = "none";
  }

  private togglePopup(): void {
    if (this.panel.style.display === "none") {
      this.panel.style.display = "flex";
      let rect = this.button.getBoundingClientRect();
      let panelRect = this.panel.getBoundingClientRect();
      let viewportWidth = this.window.innerWidth;
      let viewportHeight = this.window.innerHeight;

      let top = rect.top - panelRect.height;
      if (top < 0) {
        top = rect.bottom;
        if (top + panelRect.height > viewportHeight) {
          top = viewportHeight - panelRect.height;
        }
      }

      let left = rect.right - panelRect.width;
      if (left < 0) {
        left = rect.left;
        if (left + panelRect.width > viewportWidth) {
          left = viewportWidth - panelRect.width;
        }
      }

      this.panel.style.top = `${top}px`;
      this.panel.style.left = `${left}px`;
    } else {
      this.panel.style.display = "none";
    }
  }

  private addTab(tab: Tab): void {
    switch (tab) {
      case Tab.DISPLAY_SETTINGS:
        this.highlightTabHead(this.displaySettingsTabHead.val);
        this.displaySettingsTab.val.show();
        break;
      case Tab.BLOCK_SETTINGS:
        this.highlightTabHead(this.blockSettingsTabHead.val);
        this.blockSettingsTab.val.show();
        break;
    }
  }

  private removeTab(tab: Tab): void {
    switch (tab) {
      case Tab.DISPLAY_SETTINGS:
        ControlPanel.lowlightTabHead(this.displaySettingsTabHead.val);
        this.displaySettingsTab.val.hide();
        break;
      case Tab.BLOCK_SETTINGS:
        ControlPanel.lowlightTabHead(this.blockSettingsTabHead.val);
        this.blockSettingsTab.val.hide();
        break;
    }
  }

  private highlightTabHead(tabHead: HTMLDivElement): void {
    tabHead.style.width = `calc(100% - ${
      ControlPanel.TAB_BUTTON_WIDTH *
      (this.tabHeadLine.val.childElementCount - 1)
    }px)`;
    tabHead.style.backgroundColor = ColorScheme.getBackground();
  }

  private static lowlightTabHead(tabHead: HTMLDivElement): void {
    tabHead.style.width = `${ControlPanel.TAB_BUTTON_WIDTH}px`;
    tabHead.style.backgroundColor = ColorScheme.getAlternativeBackground();
  }

  private updateDisplaySettings(): void {
    this.emit("updateDisplaySettings");
    this.playerSettingsStorage.save(this.playerSettings);
  }

  private updateBlockSettings(): void {
    this.emit("updateBlockSettings");
    this.playerSettingsStorage.save(this.playerSettings);
  }

  public remove(): void {
    this.button.remove();
    this.panel.remove();
  }
}
