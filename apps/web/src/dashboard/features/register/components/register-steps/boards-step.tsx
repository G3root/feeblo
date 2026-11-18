import { Button } from "@feeblo/ui/button";
import { Checkbox } from "@feeblo/ui/checkbox";
import { withForm } from "@feeblo/ui/hooks/form";
import { Input } from "@feeblo/ui/input";
import { Cancel01Icon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-store";
import { useRef } from "react";

import {
  maxBoardNameLength,
  maxBoards,
  type RegisterBoardDraft,
} from "../../lib/register-draft";
import { registerFormOpts } from "../../shared-form";

/**
 * Step three: which boards the workspace starts with.
 *
 * The two defaults are a reasonable guess, not a decision, so they arrive
 * checked and named. Unchecking one leaves it out; renaming one keeps it.
 *
 * The sample posts follow these. A post whose own board was not kept falls back
 * to the first board in the list, so a workspace called "Ideas" still opens with
 * something to read.
 */
export const BoardsStep = withForm({
  ...registerFormOpts,
  render: function BoardsStepRender({ form }) {
    const boards = useStore(form.store, (state) => state.values.boards);
    const nextId = useRef(boards.length);
    const atLimit = boards.length >= maxBoards;

    const update = (index: number, patch: Partial<RegisterBoardDraft>) => {
      form.setFieldValue(
        "boards",
        boards.map((board, position) =>
          position === index ? { ...board, ...patch } : board
        )
      );
    };

    const addBoard = () => {
      nextId.current += 1;
      form.setFieldValue("boards", [
        ...boards,
        { enabled: true, id: `board-custom-${nextId.current}`, name: "" },
      ]);
    };

    const removeBoard = (index: number) => {
      form.setFieldValue(
        "boards",
        boards.filter((_, position) => position !== index)
      );
    };

    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Feedback is collected on boards. Keep both, rename them, or start with
          one.
        </p>

        <div className="flex flex-col gap-2">
          {boards.map((board, index) => (
            <div
              className="flex items-center gap-2"
              // Board ids are created with the row and never change, so they
              // are the one stable key here; the name is what the reader edits.
              key={board.id}
            >
              <Checkbox
                aria-label={`Include ${board.name || "this board"}`}
                checked={board.enabled}
                onCheckedChange={(checked) =>
                  update(index, { enabled: checked })
                }
              />
              <Input
                aria-label="Board name"
                maxLength={maxBoardNameLength}
                onChange={(event) =>
                  update(index, { name: event.target.value })
                }
                placeholder="Board name"
                value={board.name}
              />
              {boards.length > 1 ? (
                <Button
                  aria-label={`Remove ${board.name || "this board"}`}
                  onClick={() => removeBoard(index)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <HugeiconsIcon icon={Cancel01Icon} />
                </Button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <Button
            className="self-start"
            disabled={atLimit}
            onClick={addBoard}
            size="sm"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon icon={Plus} />
            Add a board
          </Button>
          {atLimit ? (
            <p className="text-muted-foreground text-xs">
              {maxBoards} is the free plan&apos;s limit. Remove one to add
              another, or add more after upgrading.
            </p>
          ) : null}
        </div>
      </div>
    );
  },
});
