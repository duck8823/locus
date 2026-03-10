export function readRequiredString(formData: FormData, key: string): string {
  const value = formData.get(key);
  const normalizedValue = typeof value === "string" ? value.trim() : value;

  if (typeof normalizedValue !== "string" || normalizedValue.length === 0) {
    throw new Error(`${key} is required.`);
  }

  return normalizedValue;
}
