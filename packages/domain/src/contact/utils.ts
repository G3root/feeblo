export function buildAttributeValueColumns(
  value: string | number | boolean | Date | null | undefined
): {
  valueText?: string | null;
  valueInteger?: number | null;
  valueDecimal?: number | null;
  valueBoolean?: boolean | null;
  valueDate?: Date | null;
} {
  if (value === null || value === undefined) {
    return {
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    };
  }

  if (typeof value === "string") {
    return {
      valueText: value,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: null,
      valueDate: null,
    };
  }

  if (typeof value === "boolean") {
    return {
      valueText: null,
      valueInteger: null,
      valueDecimal: null,
      valueBoolean: value,
      valueDate: null,
    };
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return {
        valueText: null,
        valueInteger: value,
        valueDecimal: null,
        valueBoolean: null,
        valueDate: null,
      };
    }
    return {
      valueText: null,
      valueInteger: null,
      valueDecimal: value,
      valueBoolean: null,
      valueDate: null,
    };
  }

  return {
    valueText: null,
    valueInteger: null,
    valueDecimal: null,
    valueBoolean: null,
    valueDate: value,
  };
}

export function toMutableConfig(
  config: Record<string, unknown> | undefined | null
): { min?: number; max?: number; pattern?: string } | null {
  if (!config) {
    return null;
  }
  const result: { min?: number; max?: number; pattern?: string } = {};
  const c = config as Record<string, unknown>;
  if (c.min !== undefined) {
    result.min = c.min as number;
  }
  if (c.max !== undefined) {
    result.max = c.max as number;
  }
  if (c.pattern !== undefined) {
    result.pattern = c.pattern as string;
  }
  return result;
}
