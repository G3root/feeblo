import "../../tailwind.css";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

// The member tick is a `@feeblo/ui` primitive, but that package has no browser
// test host; post-ui renders the shared avatar in browser mode, so the tick's
// scaling contract is pinned here.
//
// Tailwind has to be loaded for the percentage utilities to resolve. Without
// it the avatars and the tick fall back to intrinsic text sizes and the ratios
// below are meaningless.
function tickParts(root: Element) {
  const avatar = root.querySelector('[data-slot="avatar"]');
  const tick = root.querySelector('[data-slot="member-tick"]');
  const icon = tick?.querySelector("svg");
  if (!avatar || !tick || !icon) {
    throw new Error("expected an avatar with a member tick and its icon");
  }
  return {
    avatar: avatar.getBoundingClientRect().width,
    icon: icon.getBoundingClientRect().width,
    tick: tick.getBoundingClientRect().width,
  };
}

describe("UserAvatar member tick", () => {
  it("scales with the rendered avatar size, including a className override", async () => {
    const screen = await render(
      <div>
        <div data-testid="sm">
          <UserAvatar isMember memberLabel="member" name="Ada" size="sm" />
        </div>
        {/* The `size` prop says 24px but the class renders 20px: the tick
            must follow the rendered box, not the prop. */}
        <div data-testid="overridden">
          <UserAvatar
            className="size-5"
            isMember
            memberLabel="member"
            name="Ada"
            size="sm"
          />
        </div>
        <div data-testid="default">
          <UserAvatar isMember memberLabel="member" name="Ada" />
        </div>
        <div data-testid="lg">
          <UserAvatar isMember memberLabel="member" name="Ada" size="lg" />
        </div>
      </div>
    );

    for (const id of ["sm", "overridden", "default", "lg"]) {
      const { avatar, icon, tick } = tickParts(
        screen.getByTestId(id).element()
      );
      // The tick keeps one proportion of the avatar at every size...
      expect(tick / avatar).toBeCloseTo(0.44, 2);
      // ...and the check inside keeps one proportion of the tick.
      expect(icon / tick).toBeCloseTo(0.64, 2);
    }
  });
});
