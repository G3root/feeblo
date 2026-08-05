import { type ComponentProps, splitProps, type ValidComponent } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "../../lib/utils";

export type CardRender = ValidComponent;

export type CardPartProps = ComponentProps<"div"> & {
  /** Overrides the rendered element (tag name or component). */
  render?: CardRender;
  /** Allows rendering a card as a link (e.g. `render="a"`). */
  href?: string;
};

export type CardProps = CardPartProps & {
  size?: "sm" | "default";
};

// function renderCardPart(props: CardPartProps, baseClass: string, slot: string) {
//   const [local, others] = splitProps(props, ["class", "render"]);

//   return (
//     <Dynamic
//       class={cn(baseClass, local.class)}
//       component={local.render ?? "div"}
//       data-slot={slot}
//       {...others}
//     />
//   );
// }

export function Card(props: CardProps) {
  const [local, others] = splitProps(props, ["class", "render", "size"]);

  return (
    <Dynamic
      class={cn(
        "relative flex flex-col rounded-2xl border bg-card not-dark:bg-clip-padding text-card-foreground shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
        local.size === "sm" &&
          "rounded-xl before:rounded-[calc(var(--radius-xl)-1px)]",
        local.class
      )}
      component={local.render ?? "div"}
      data-slot="card"
      {...others}
    />
  );
}

// export function CardFrame(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "relative flex flex-col rounded-2xl border bg-card not-dark:bg-clip-padding text-card-foreground shadow-xs/5 [--clip-bottom:-1rem] [--clip-top:-1rem] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:bg-muted/72 before:shadow-[0_1px_--theme(--color-black/4%)] has-data-[slot=table-container]:overflow-hidden *:data-[slot=card]:-m-px *:data-[slot=table-container]:-m-px *:data-[slot=table-container]:w-[calc(100%+2px)] *:not-first:data-[slot=card]:rounded-t-xl *:not-last:data-[slot=card]:rounded-b-xl *:data-[slot=card]:bg-clip-padding *:data-[slot=card]:shadow-none *:data-[slot=card]:before:hidden *:not-first:data-[slot=card]:before:rounded-t-[calc(var(--radius-xl)-1px)] *:not-last:data-[slot=card]:before:rounded-b-[calc(var(--radius-xl)-1px)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)] *:data-[slot=card]:[clip-path:inset(var(--clip-top)_1px_var(--clip-bottom)_1px_round_calc(var(--radius-2xl)-1px))] *:data-[slot=card]:last:[--clip-bottom:1px] *:data-[slot=card]:first:[--clip-top:1px]",
//     "card-frame"
//   );
// }

// export function CardFrameHeader(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "relative flex grid auto-rows-min grid-rows-[auto_auto] flex-col items-start gap-x-4 px-6 py-4 has-data-[slot=card-frame-action]:grid-cols-[1fr_auto]",
//     "card-frame-header"
//   );
// }

// export function CardFrameTitle(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "self-center font-semibold text-sm",
//     "card-frame-title"
//   );
// }

// export function CardFrameDescription(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "self-center text-muted-foreground text-sm",
//     "card-frame-description"
//   );
// }

// export function CardFrameAction(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "col-start-2 nth-3:row-span-2 nth-3:row-start-1 inline-flex self-center justify-self-end",
//     "card-frame-action"
//   );
// }

// export function CardFrameFooter(props: CardPartProps) {
//   return renderCardPart(props, "px-6 py-4", "card-frame-footer");
// }

// export function CardHeader(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 p-6 in-[[data-slot=card]:has(>[data-slot=card-panel])]:pb-4 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
//     "card-header"
//   );
// }

// export function CardTitle(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "font-heading font-semibold text-lg leading-none",
//     "card-title"
//   );
// }

// export function CardDescription(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "text-muted-foreground text-sm",
//     "card-description"
//   );
// }

// export function CardAction(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "col-start-2 row-span-2 row-start-1 inline-flex self-start justify-self-end",
//     "card-action"
//   );
// }

// export function CardPanel(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "flex-1 p-6 in-[[data-slot=card]:has(>[data-slot=card-header]:not(.border-b))]:pt-0 in-[[data-slot=card]:has(>[data-slot=card-footer]:not(.border-t))]:pb-0",
//     "card-panel"
//   );
// }

// export function CardFooter(props: CardPartProps) {
//   return renderCardPart(
//     props,
//     "flex items-center p-6 in-[[data-slot=card]:has(>[data-slot=card-panel])]:pt-4",
//     "card-footer"
//   );
// }
