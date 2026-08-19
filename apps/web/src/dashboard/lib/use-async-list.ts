import * as Option from "effect/Option";
import * as Result from "effect/unstable/reactivity/AsyncResult";

export type AsyncListState<T> = {
  readonly list: readonly T[];
  readonly isLoading: boolean;
  readonly loadFailed: boolean;
};

/**
 * Collapses an atom AsyncResult into the loading/loaded/error trio the
 * settings frames render. Preserves the last successful value across a
 * background failure so a stale list stays on screen instead of flashing.
 */
export function useAsyncList<T>(
  result: Result.AsyncResult<readonly T[], unknown>
): AsyncListState<T> {
  return Result.builder(result)
    .onInitial(() => ({ list: [], isLoading: true, loadFailed: false }))
    .onFailure((_, { previousSuccess }) =>
      Option.match(previousSuccess, {
        onNone: () => ({ list: [], isLoading: false, loadFailed: true }),
        onSome: ({ value }) => ({
          list: value,
          isLoading: false,
          loadFailed: false,
        }),
      })
    )
    .onSuccess((value) => ({
      list: value,
      isLoading: false,
      loadFailed: false,
    }))
    .exhaustive();
}
