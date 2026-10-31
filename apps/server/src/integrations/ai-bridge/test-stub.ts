export function stub<T>(members: object): T {
  return members as T; // tests supply only the members the unit under test reads
}
