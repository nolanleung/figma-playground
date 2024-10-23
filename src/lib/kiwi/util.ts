export function quote(text: string): string {
  return JSON.stringify(text);
}

export function error(text: string, line: number, column: number): never {
  const error = new Error(text);
  (error as any).line = line;
  (error as any).column = column;
  throw error;
}
