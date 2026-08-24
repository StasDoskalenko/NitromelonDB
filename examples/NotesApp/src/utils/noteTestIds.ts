/** Maestro Android `id` maps to resource-id, which cannot contain spaces. */
export function notePinTestID(title: string): string {
  return `pin-button-${title.replace(/\s+/g, '-')}`
}

export function noteDeleteTestID(title: string): string {
  return `delete-button-${title.replace(/\s+/g, '-')}`
}
