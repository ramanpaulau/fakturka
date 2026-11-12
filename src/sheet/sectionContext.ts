import { createContext } from 'preact'

/** Field paths (e.g. 'customer.street') that differ from the linked saved entry; `Editable` marks them `data-changed`. */
export const ChangedFields = createContext<ReadonlySet<string>>(new Set())
