/** Truncates a string to a maximum length, trimming trailing whitespace and appending an ellipsis when clipped. */
export const truncate = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1).trimEnd()}…`;
};
