import { entityLabel, type EntityKind } from '../domain/entities'
import { choiceDialog } from './Dialog'

const title = 'Už existuje'
const body = (kind: EntityKind, existing: object) => `${entityLabel(kind, existing)} už je uložen.`

/**
 * "Už existuje": asked before saving an entry that looks like one already saved.
 * 'use' = take the saved one, 'save' = save anyway, null = cancelled.
 */
export function confirmDuplicate(kind: EntityKind, existing: object): Promise<'use' | 'save' | null> {
  return choiceDialog({
    title,
    body: body(kind, existing),
    choices: [
      { value: 'use', label: 'Použít ten', primary: true },
      { value: 'save', label: 'Přesto uložit' },
    ],
  })
}

/**
 * "Už existuje" for an edit of a saved entry that now looks like another saved one.
 * Resolves true for "Přesto uložit", false for "Zrušit" or a dismissed dialog.
 */
export async function confirmDuplicateEdit(kind: EntityKind, existing: object): Promise<boolean> {
  const choice = await choiceDialog({
    title,
    body: body(kind, existing),
    choices: [
      { value: 'cancel', label: 'Zrušit' },
      { value: 'save', label: 'Přesto uložit', primary: true },
    ],
  })
  return choice === 'save'
}
