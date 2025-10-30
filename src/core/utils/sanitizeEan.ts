export default function sanitizeEan(input: string): string {
  if (!input) return input;
  if (input.startsWith("0") && input.length === 14) {
    return input.slice(1, input.length);
  }

  return input;
}
