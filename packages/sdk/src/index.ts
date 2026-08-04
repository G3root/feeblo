import "./auto-init";
import { subscribe, unsubscribe } from "./events";
import { destroyInstance, getCurrentEmbed, init } from "./instance";
import type { UserIdentity, WidgetModule } from "./types";
import { organizationId } from "./types";
import { VERSION } from "./version";

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export type { EmbedErrorDetails } from "./errors";
export { EmbedError } from "./errors";
export { init } from "./instance";
export type {
  EmbedOptions,
  FeebloEventDetail,
  FeebloEventListener,
  FeebloEventMap,
  FeebloEventName,
  FeebloOff,
  FeebloOn,
  FeebloWidget,
  InitConfig,
  OrganizationId,
  PublicUserIdentity,
  SubmittedFeedback,
  UserIdentity,
  WidgetCompany,
  WidgetMode,
  WidgetModule,
  WidgetPlacement,
} from "./types";
export { organizationId } from "./types";
export { VERSION } from "./version";

// ---------------------------------------------------------------------------
// Static Feeblo namespace
// ---------------------------------------------------------------------------

export interface Feeblo {
  close(): Feeblo;
  destroy(): void;
  identify(user: UserIdentity): Feeblo;
  init: typeof init;
  isOpen(): boolean;
  metadata(patch: Record<string, string | null>): Feeblo;
  off: typeof unsubscribe;
  on: typeof subscribe;
  open(): Feeblo;
  openModule(module: WidgetModule): Feeblo;
  organizationId: typeof organizationId;
  setBoard(board: string): Feeblo;
  readonly version: string;
}

export const Feeblo = {
  version: VERSION,
  init,
  organizationId,
  identify(user: UserIdentity): Feeblo {
    getCurrentEmbed()?.identify(user);
    return Feeblo;
  },
  open(): Feeblo {
    getCurrentEmbed()?.open();
    return Feeblo;
  },
  openModule(module: WidgetModule): Feeblo {
    getCurrentEmbed()?.openModule(module);
    return Feeblo;
  },
  close(): Feeblo {
    getCurrentEmbed()?.close();
    return Feeblo;
  },
  metadata(patch: Record<string, string | null>): Feeblo {
    getCurrentEmbed()?.metadata(patch);
    return Feeblo;
  },
  isOpen(): boolean {
    return getCurrentEmbed()?.isOpenState() ?? false;
  },
  setBoard(board: string): Feeblo {
    getCurrentEmbed()?.setBoard(board);
    return Feeblo;
  },
  destroy(): void {
    destroyInstance(getCurrentEmbed());
  },
  on: subscribe,
  off: unsubscribe,
};
