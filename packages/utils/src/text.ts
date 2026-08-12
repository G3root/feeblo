/** Truncates a string to a maximum length, trimming trailing whitespace and appending an ellipsis when clipped. */
export const truncate = (value: string, max: number): string => {
  if (max < 0) {
    throw new RangeError(`truncate max must be non-negative, received ${max}`);
  }
  if (max === 0) {
    return "";
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1).trimEnd()}…`;
};
